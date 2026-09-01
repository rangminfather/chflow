"use client";

// 목장 구성원 — 가정 단위로 묶어 부부 + 자녀를 보여준다.
//  · 자녀는 "자녀 2명" 으로 요약하고 펼치면 이름·나이(세는나이)
//  · 목장 인원 통계는 성인 기준 (홈·집계와 같은 분모)
//  · 테스트 계정·중복 의심 데이터는 삭제하지 않고 "정리 대상" 배지로만 표시

import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Smartphone, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import { PastureShell, PastureEmpty, cardStyle, primaryButtonStyle } from "@/components/PastureShell";
import {
  fetchPastureMembers, groupByHousehold, koreanAge, reviewFlag,
  type PastureMemberRow, type Household,
} from "@/lib/pasture";

export default function PastureMembersPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [rows, setRows] = useState<PastureMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setError("");
    try {
      setRows(await fetchPastureMembers());
    } catch (e) {
      setError(e instanceof Error ? e.message : "구성원을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await load();
    })();
  }, [router, load]);

  const households = useMemo(() => groupByHousehold(rows), [rows]);
  const adultCount = rows.filter((r) => !r.is_child).length;
  const childCount = rows.length - adultCount;
  const flagged = rows.filter((r) => reviewFlag(r)).length;

  if (!authChecked) return <main style={{ minHeight: "100vh" }}><LoadingView full /></main>;

  return (
    <PastureShell eyebrow="목장" title="구성원" chip={`${households.length}가정`}>
      {loading ? (
        <div style={cardStyle}><LoadingView /></div>
      ) : error ? (
        <PastureEmpty
          title="구성원을 불러오지 못했습니다"
          hint={error}
          action={<button type="button" onClick={load} style={primaryButtonStyle}>다시 불러오기</button>}
        />
      ) : rows.length === 0 ? (
        <PastureEmpty title="구성원이 없습니다" hint="목장에 연결된 가정이 아직 없습니다." />
      ) : (
        <>
          <div style={{ ...cardStyle, display: "flex", gap: 4 }}>
            <Stat label="가정" value={`${households.length}`} />
            <Stat label="성인" value={`${adultCount}`} note="통계 기준" />
            <Stat label="자녀" value={`${childCount}`} />
          </div>

          {flagged > 0 && (
            <div style={noticeStyle}>
              <AlertTriangle size={14} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                테스트 계정 또는 중복 의심 {flagged}건이 목장에 포함돼 있습니다. 임의로 지우지 않고
                <b> 정리 대상</b>으로만 표시했습니다.
              </span>
            </div>
          )}

          {households.map((h) => (
            <HouseholdCard
              key={h.household_id}
              household={h}
              expanded={!!open[h.household_id]}
              onToggle={() => setOpen((p) => ({ ...p, [h.household_id]: !p[h.household_id] }))}
            />
          ))}
        </>
      )}
    </PastureShell>
  );
}

function HouseholdCard({ household, expanded, onToggle }: { household: Household; expanded: boolean; onToggle: () => void }) {
  const { adults, children, hasLeader } = household;
  return (
    <div style={{ ...cardStyle, padding: 14, borderColor: hasLeader ? "var(--accent)" : "var(--hairline)" }}>
      {adults.map((a) => (
        <div key={a.member_id} style={personRowStyle}>
          <span style={{ fontSize: 15, fontWeight: a.is_me ? 800 : 700 }}>{a.name}</span>
          {a.family_church && <span style={rolePill(a.family_church)}>{a.family_church}</span>}
          {a.sub_role && <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{a.sub_role}</span>}
          {a.relationship && <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{a.relationship}</span>}
          {a.has_app && <Smartphone size={12} strokeWidth={2} style={{ color: "var(--accent)" }} aria-label="앱 사용" />}
          {a.is_me && <span style={mePillStyle}>나</span>}
          {reviewFlag(a) && <span style={flagPillStyle}>{reviewFlag(a) === "test" ? "정리 대상 · 테스트" : "정리 대상 · 중복 의심"}</span>}
        </div>
      ))}

      {children.length > 0 && (
        <>
          <button type="button" onClick={onToggle} style={childToggleStyle}>
            {expanded ? <ChevronDown size={15} strokeWidth={2} /> : <ChevronRight size={15} strokeWidth={2} />}
            <span>자녀 {children.length}명</span>
          </button>
          {expanded && (
            <div style={{ paddingLeft: 21 }}>
              {children.map((c) => {
                const age = koreanAge(c.birth_date);
                return (
                  <div key={c.member_id} style={{ ...personRowStyle, paddingTop: 4, paddingBottom: 4 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</span>
                    {age !== null && <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{age}세</span>}
                    {c.gender && <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{c.gender}</span>}
                    {c.relationship && <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{c.relationship}</span>}
                    {reviewFlag(c) && <span style={flagPillStyle}>{reviewFlag(c) === "test" ? "정리 대상 · 테스트" : "정리 대상 · 중복 의심"}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 1 }}>{label}</div>
      {note && <div style={{ fontSize: 10, color: "var(--accent)", marginTop: 1 }}>{note}</div>}
    </div>
  );
}

const personRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  flexWrap: "wrap",
  padding: "5px 0",
};

const rolePill = (role: string): React.CSSProperties => ({
  fontSize: 10.5,
  fontWeight: 800,
  padding: "2px 7px",
  borderRadius: 999,
  background: role === "목자" || role === "목녀"
    ? "color-mix(in srgb, var(--accent) 14%, transparent)"
    : "color-mix(in srgb, var(--ink-faint) 12%, transparent)",
  color: role === "목자" || role === "목녀" ? "var(--accent)" : "var(--ink-soft)",
});

const mePillStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  padding: "2px 7px",
  borderRadius: 999,
  background: "color-mix(in srgb, var(--accent) 20%, transparent)",
  color: "var(--accent)",
};

const flagPillStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  padding: "2px 7px",
  borderRadius: 999,
  background: "color-mix(in srgb, var(--warning) 16%, transparent)",
  color: "var(--warning)",
};

const childToggleStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  marginTop: 6,
  padding: "4px 0",
  border: "none",
  background: "transparent",
  color: "var(--ink-soft)",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const noticeStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
  marginBottom: 12,
  padding: "11px 14px",
  borderRadius: 10,
  border: "1px solid color-mix(in srgb, var(--warning) 35%, transparent)",
  background: "color-mix(in srgb, var(--warning) 8%, transparent)",
  color: "var(--ink)",
  fontSize: 12.5,
  lineHeight: 1.6,
};
