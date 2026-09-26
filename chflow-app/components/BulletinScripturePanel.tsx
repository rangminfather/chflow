"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Settings, X } from "lucide-react";
import { useRouter } from "next/navigation";
import ModalBackdrop from "@/components/ModalBackdrop";
import { supabase } from "@/lib/supabase";
import { BULLETIN_SERVICE_TYPES, type BulletinServiceType } from "@/lib/bulletin/scripture-parser";
import { getRecommendedBulletinService } from "@/lib/bulletin/scripture-recommendation";
import ScripturePassageSheet from "./ScripturePassageSheet";

type Reading = {
  id: string;
  service_type: BulletinServiceType;
  raw_reference: string;
  normalized_label: string | null;
  sort_order: number;
};

const MANAGER_ROLES = new Set(["admin", "office", "pastor"]);
const SUNDAY_PARTS: BulletinServiceType[] = ["sunday_1", "sunday_2", "sunday_3"];
const PART_NUMBER: Partial<Record<BulletinServiceType, string>> = { sunday_1: "1", sunday_2: "2", sunday_3: "3" };
const OTHER_LABELS: Partial<Record<BulletinServiceType, string>> = {
  sunday_afternoon: "주일 오후예배",
  wednesday_morning: "수요 오전예배",
  wednesday_evening: "수요 저녁예배",
};

type ReadingGroup = { key: string; label: string; services: BulletinServiceType[]; readings: Reading[] };

/** 주일 1·2·3부는 대개 같은 본문이라 같은 것끼리 한 장으로 묶는다(부마다 다른 주만 나뉜다). */
function groupReadings(readings: Reading[]): ReadingGroup[] {
  const bySlot = new Map<BulletinServiceType, Reading[]>();
  for (const reading of [...readings].sort((a, b) => a.sort_order - b.sort_order)) {
    bySlot.set(reading.service_type, [...(bySlot.get(reading.service_type) || []), reading]);
  }
  const text = (slot: BulletinServiceType) => (bySlot.get(slot) || []).map((row) => row.normalized_label || row.raw_reference).join(", ");
  const groups: ReadingGroup[] = [];
  for (const slot of BULLETIN_SERVICE_TYPES) {
    const rows = bySlot.get(slot);
    if (!rows?.length) continue;
    const previous = groups.at(-1);
    if (PART_NUMBER[slot] && previous && PART_NUMBER[previous.services[0]] && previous.services.at(-1) === SUNDAY_PARTS[SUNDAY_PARTS.indexOf(slot) - 1] && text(previous.services[0]) === text(slot)) {
      previous.services.push(slot);
      continue;
    }
    groups.push({ key: slot, label: "", services: [slot], readings: rows });
  }
  for (const group of groups) {
    if (!PART_NUMBER[group.services[0]]) { group.label = OTHER_LABELS[group.services[0]] || ""; continue; }
    const parts = group.services.map((slot) => PART_NUMBER[slot]).join("·");
    group.label = group.services.length === SUNDAY_PARTS.length ? "주일 오전예배 (1·2·3부)" : `주일 ${parts}부예배`;
  }
  return groups;
}

export default function BulletinScripturePanel({ bulletinId }: { bulletinId: string }) {
  const router = useRouter();
  const [readings, setReadings] = useState<Reading[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [opened, setOpened] = useState<Reading | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [{ data: { session } }, { data: status }] = await Promise.all([
          supabase.auth.getSession(),
          supabase.rpc("get_my_status"),
        ]);
        if (cancelled) return;
        setCanManage(MANAGER_ROLES.has(status?.[0]?.role || ""));
        if (!session) return;

        const response = await fetch(`/api/bulletin/${bulletinId}/scripture-readings`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await response.json();
        if (!cancelled && response.ok && json.ok) setReadings(json.readings || []);
      } catch {
        if (!cancelled) setReadings([]);
      }
    })();

    return () => { cancelled = true; };
  }, [bulletinId]);

  const recommended = getRecommendedBulletinService();
  const ordered = useMemo(() => groupReadings(readings), [readings]);

  if (!ordered.length && !canManage) return null;

  return (
    <>
      <style>{responsiveCss}</style>
      <div className="bulletin-scripture-trigger-row" style={triggerRowStyle}>
        <button type="button" className="bulletin-scripture-trigger" onClick={() => setSheetOpen(true)} style={triggerStyle}>
          <BookOpen size={17} strokeWidth={2} />
          <span>성경봉독{ordered.length ? ` ${ordered.length}` : ""}</span>
        </button>
      </div>

      {sheetOpen && (
        <ModalBackdrop onClose={() => setSheetOpen(false)} style={backdropStyle}>
          <section className="bulletin-scripture-sheet" onClick={(event) => event.stopPropagation()} style={sheetStyle}>
            <header style={sheetHeaderStyle}>
              <div>
                <strong style={{ fontSize: 17 }}>성경봉독</strong>
                <div style={sheetSubtitleStyle}>이 주보에 연결된 예배 본문</div>
              </div>
              <button type="button" onClick={() => setSheetOpen(false)} aria-label="닫기" style={iconButtonStyle}><X size={18} /></button>
            </header>

            <div style={readingListStyle}>
              {ordered.length ? ordered.map((group) => {
                const isRecommended = recommended != null && group.services.includes(recommended);
                return (
                  <article key={group.key} style={{ ...readingStyle, ...(isRecommended ? recommendedReadingStyle : null) }}>
                    <div style={readingMetaStyle}>
                      {isRecommended && <span style={recommendBadgeStyle}>추천</span>}
                      <span>{group.label}</span>
                    </div>
                    {group.readings.map((reading) => (
                      <div key={reading.id}>
                        <div style={referenceStyle}>{reading.normalized_label || reading.raw_reference}</div>
                        <button type="button" onClick={() => setOpened(reading)} style={passageButtonStyle}>
                          <BookOpen size={15} /> 본문 보기
                        </button>
                      </div>
                    ))}
                  </article>
                );
              }) : <div style={emptyStyle}>아직 저장된 성경봉독이 없습니다.</div>}
            </div>

            {canManage && (
              <footer style={footerStyle}>
                <button
                  type="button"
                  onClick={() => router.push(`/admin/bulletin-scripture-readings?bulletin_id=${encodeURIComponent(bulletinId)}`)}
                  style={manageButtonStyle}
                >
                  <Settings size={16} /> 이 주보 성경봉독 관리
                </button>
              </footer>
            )}
          </section>
        </ModalBackdrop>
      )}

      {opened && <ScripturePassageSheet reference={opened.normalized_label || opened.raw_reference} onClose={() => setOpened(null)} />}
    </>
  );
}

const responsiveCss = `
@media(max-width:720px){
  .bulletin-scripture-trigger-row{order:-1;margin-top:0!important;margin-bottom:10px!important}
  .bulletin-scripture-sheet{width:100%!important;max-width:none!important;border-radius:18px 18px 0 0!important;max-height:82dvh!important}
}
@media(min-width:721px){
  .bulletin-scripture-sheet{width:min(520px,calc(100vw - 48px))!important;border-radius:16px!important;max-height:min(760px,calc(100vh - 64px))!important}
}
`;
const triggerRowStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", width: "100%", marginTop: 2, marginBottom: 12 };
const triggerStyle: React.CSSProperties = { minHeight: 42, padding: "0 15px", border: "1px solid color-mix(in srgb, var(--accent) 55%, transparent)", borderRadius: 999, background: "var(--accent)", color: "#fff", boxShadow: "0 6px 18px rgba(20,26,22,.18)", display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "inherit", fontWeight: 800, cursor: "pointer" };
const backdropStyle: React.CSSProperties = { zIndex: 180, alignItems: "flex-end", padding: 0 };
const sheetStyle: React.CSSProperties = { width: "100%", maxWidth: 560, maxHeight: "82dvh", background: "var(--card)", borderRadius: "18px 18px 0 0", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 -10px 40px rgba(20,26,22,.25)" };
const sheetHeaderStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "15px 16px", borderBottom: "1px solid var(--hairline)", flexShrink: 0 };
const sheetSubtitleStyle: React.CSSProperties = { marginTop: 2, color: "var(--ink-soft)", fontSize: 12 };
const iconButtonStyle: React.CSSProperties = { width: 34, height: 34, borderRadius: 999, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--ink)", display: "grid", placeItems: "center", cursor: "pointer" };
const readingListStyle: React.CSSProperties = { overflowY: "auto", padding: "4px 16px 14px" };
const readingStyle: React.CSSProperties = { marginTop: 8, padding: 12, border: "1px solid var(--hairline)", borderRadius: 10, background: "var(--card)" };
const recommendedReadingStyle: React.CSSProperties = { border: "2px solid #dc2626", background: "color-mix(in srgb, #dc2626 5%, var(--card))" };
const readingMetaStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, color: "var(--ink-soft)", fontSize: 12, fontWeight: 700 };
const recommendBadgeStyle: React.CSSProperties = { padding: "2px 7px", borderRadius: 999, background: "#dc2626", color: "#fff", fontSize: 10, fontWeight: 900 };
const referenceStyle: React.CSSProperties = { marginTop: 4, fontSize: 17, fontWeight: 800 };
const passageButtonStyle: React.CSSProperties = { marginTop: 9, minHeight: 34, padding: "0 11px", border: 0, borderRadius: 8, background: "var(--accent)", color: "#fff", display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 800, fontFamily: "inherit" };
const footerStyle: React.CSSProperties = { padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", borderTop: "1px solid var(--hairline)", background: "var(--surface)", flexShrink: 0 };
const manageButtonStyle: React.CSSProperties = { width: "100%", minHeight: 42, borderRadius: 10, border: "1px solid var(--hairline)", background: "var(--card)", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 800 };
const emptyStyle: React.CSSProperties = { padding: "28px 4px", color: "var(--ink-soft)", textAlign: "center", fontSize: 13 };
