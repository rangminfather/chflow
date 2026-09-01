"use client";

// 목장 일정 상세 — 정보 + 내 참석 응답 + 참석현황
//  · 참석현황 분모는 성인만 (자녀는 구성원 화면에서만 표시)
//  · 이름 공개는 목자·목녀에게만. 목원에게는 숫자만 보인다 (RPC 가 이름을 비워 보낸다)

import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { useParams, useRouter } from "next/navigation";
import { MapPin, Utensils, Users, ClipboardList, Bell } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import {
  PastureShell, PastureEmpty, cardStyle, sectionTitleStyle,
  primaryButtonStyle, ghostButtonStyle,
} from "@/components/PastureShell";
import {
  fetchScheduleDetail, setRsvp, notifyPending,
  formatMeetingDate, formatTime, RSVP_LABEL, SCHEDULE_KIND_LABEL,
  type ScheduleDetailRow, type RsvpResponse, type ScheduleKind,
} from "@/lib/pasture";

const GROUPS: { key: RsvpResponse | "pending"; label: string; color: string }[] = [
  { key: "attend", label: "참석", color: "var(--success)" },
  { key: "undecided", label: "미정", color: "var(--warning)" },
  { key: "absent", label: "불참", color: "var(--danger)" },
  { key: "pending", label: "미응답", color: "var(--ink-faint)" },
];

export default function PastureScheduleDetailPage() {
  const router = useRouter();
  const params = useParams();
  const scheduleId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [rows, setRows] = useState<ScheduleDetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setRows(await fetchScheduleDetail(scheduleId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "일정을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, [scheduleId]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await load();
    })();
  }, [router, load]);

  const head = rows[0] ?? null;
  const tally = useMemo(() => {
    const t: Record<string, number> = { attend: 0, undecided: 0, absent: 0, pending: 0 };
    for (const r of rows) t[r.response] = (t[r.response] ?? 0) + 1;
    return t;
  }, [rows]);

  const respond = async (r: RsvpResponse) => {
    setBusy(true);
    try {
      await setRsvp(scheduleId, r);
      setToast(`${RSVP_LABEL[r]}으로 응답했습니다`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "응답 저장에 실패했습니다");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(""), 2500);
    }
  };

  const remind = async () => {
    setBusy(true);
    try {
      const n = await notifyPending("rsvp", scheduleId);
      setToast(n > 0 ? `미응답 ${n}명에게 알림을 보냈습니다` : "미응답자가 없습니다");
    } catch (e) {
      setError(e instanceof Error ? e.message : "알림 발송에 실패했습니다");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(""), 3000);
    }
  };

  if (!authChecked) return <main style={{ minHeight: "100vh" }}><LoadingView full /></main>;

  return (
    <PastureShell
      eyebrow="목장 일정"
      title={head ? formatMeetingDate(head.meets_on) : "일정"}
      chip={head?.status === "draft" ? "임시저장" : head?.status === "cancelled" ? "취소됨" : undefined}
    >
      {loading ? (
        <div style={cardStyle}><LoadingView /></div>
      ) : error ? (
        <PastureEmpty
          title="일정을 불러오지 못했습니다"
          hint={error}
          action={<button type="button" onClick={load} style={primaryButtonStyle}>다시 불러오기</button>}
        />
      ) : !head ? (
        <PastureEmpty title="일정을 찾을 수 없습니다" hint="삭제되었거나 다른 목장의 일정일 수 있습니다." />
      ) : (
        <>
          {toast && <div style={toastStyle}>{toast}</div>}

          <div style={cardStyle}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)", marginBottom: 4 }}>
              {SCHEDULE_KIND_LABEL[head.kind as ScheduleKind] ?? "목장 일정"}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3 }}>{head.title}</div>
            <div style={{ fontSize: 14, color: "var(--ink-soft)", marginTop: 6 }}>
              {formatMeetingDate(head.meets_on)} {formatTime(head.start_time)}
              {head.end_time ? ` ~ ${formatTime(head.end_time)}` : ""}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
              {head.location && <Meta icon={<MapPin size={14} strokeWidth={1.9} />}>{head.location}</Meta>}
              <Meta icon={<Utensils size={14} strokeWidth={1.9} />}>{head.meal_provided ? "식사 있음" : "식사 없음"}</Meta>
              <Meta icon={<Users size={14} strokeWidth={1.9} />}>{head.family_allowed ? "가족 동반 가능" : "본인만"}</Meta>
              {head.prep_notes && <Meta icon={<ClipboardList size={14} strokeWidth={1.9} />}>준비: {head.prep_notes}</Meta>}
            </div>

            {head.description && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--hairline)", fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {head.description}
              </div>
            )}
          </div>

          {/* 내 응답 */}
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>나의 참석 여부</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["attend", "undecided", "absent"] as RsvpResponse[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={busy || head.status === "cancelled"}
                  onClick={() => respond(r)}
                  style={head.my_response === r ? { ...primaryButtonStyle, flex: 1 } : { ...ghostButtonStyle, flex: 1 }}
                >
                  {RSVP_LABEL[r]}
                </button>
              ))}
            </div>
            {!head.my_response && (
              <div style={{ fontSize: 12, color: "var(--warning)", marginTop: 8 }}>아직 응답하지 않았습니다</div>
            )}
          </div>

          {/* 참석현황 */}
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>참석현황 (성인 {rows.length}명 기준)</div>
            <div style={{ display: "flex", gap: 4, padding: "8px 0 12px" }}>
              {GROUPS.map((g) => (
                <div key={g.key} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 19, fontWeight: 800, color: g.color }}>{tally[g.key] ?? 0}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 1 }}>{g.label}</div>
                </div>
              ))}
            </div>

            {head.is_leader ? (
              <>
                {GROUPS.map((g) => {
                  const list = rows.filter((r) => r.response === g.key);
                  if (list.length === 0) return null;
                  return (
                    <div key={g.key} style={{ paddingTop: 10, borderTop: "1px solid var(--hairline)" }}>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: g.color, marginBottom: 5 }}>
                        {g.label} {list.length}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {list.map((r) => (
                          <span key={r.member_id} style={namePillStyle}>{r.member_name ?? "이름 없음"}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {(tally.pending ?? 0) > 0 && head.status !== "cancelled" && (
                  <button type="button" disabled={busy} onClick={remind} style={{ ...ghostButtonStyle, width: "100%", marginTop: 12 }}>
                    <Bell size={14} strokeWidth={1.9} style={{ marginRight: 6, verticalAlign: "-2px" }} />
                    미응답 {tally.pending}명에게 알림
                  </button>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: "var(--ink-faint)", paddingTop: 10, borderTop: "1px solid var(--hairline)", lineHeight: 1.6 }}>
                개인별 응답 명단은 목자·목녀에게만 보입니다.
              </div>
            )}
          </div>
        </>
      )}
    </PastureShell>
  );
}

function Meta({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--ink-soft)" }}>
      <span style={{ color: "var(--ink-faint)", flexShrink: 0, display: "inline-flex" }}>{icon}</span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

const namePillStyle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
};

const toastStyle: React.CSSProperties = {
  marginBottom: 12,
  padding: "10px 14px",
  borderRadius: 10,
  background: "color-mix(in srgb, var(--accent) 12%, transparent)",
  color: "var(--accent)",
  fontSize: 13,
  fontWeight: 700,
};
