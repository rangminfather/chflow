"use client";

// 목장 홈 — 다음 모임 · 내 참석 · 집계 · 이번 달 가능일 등록 여부 · 이번 달 일정
// 통계 분모는 성인만이다(DB RPC 가 이미 성인만 센다). 구성원 화면만 자녀를 포함한다.

import { useCallback, useEffect, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Users, Church, Bell, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import {
  PastureShell, PastureEmpty, cardStyle, sectionTitleStyle,
  primaryButtonStyle, ghostButtonStyle,
} from "@/components/PastureShell";
import {
  fetchPastureHome, fetchCalendar, setRsvp, notifyPending,
  formatMeetingDate, formatTime, monthRange, RSVP_LABEL,
  type PastureHome, type CalendarRow, type RsvpResponse,
} from "@/lib/pasture";

export default function PastureHomePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [home, setHome] = useState<PastureHome | null>(null);
  const [items, setItems] = useState<CalendarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const h = await fetchPastureHome();
      setHome(h);
      if (h?.pasture_id) {
        const { from, to } = monthRange(new Date());
        setItems(await fetchCalendar(from, to));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "목장 정보를 불러오지 못했습니다");
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

  const respond = async (r: RsvpResponse) => {
    if (!home?.next_schedule_id) return;
    setBusy(true);
    try {
      await setRsvp(home.next_schedule_id, r);
      setToast(`${RSVP_LABEL[r]}으로 응답했습니다`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "응답 저장에 실패했습니다");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(""), 2500);
    }
  };

  const askAvailability = async () => {
    setBusy(true);
    try {
      const n = await notifyPending("availability");
      setToast(n > 0 ? `${n}명에게 알림을 보냈습니다` : "가능일을 아직 입력하지 않은 구성원이 없습니다");
    } catch (e) {
      setError(e instanceof Error ? e.message : "알림 발송에 실패했습니다");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(""), 3000);
    }
  };

  const askRsvp = async () => {
    if (!home?.next_schedule_id) return;
    setBusy(true);
    try {
      const n = await notifyPending("rsvp", home.next_schedule_id);
      setToast(n > 0 ? `미응답 ${n}명에게 알림을 보냈습니다` : "미응답자가 없습니다");
    } catch (e) {
      setError(e instanceof Error ? e.message : "알림 발송에 실패했습니다");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(""), 3000);
    }
  };

  if (!authChecked) return <main style={{ minHeight: "100vh" }}><LoadingView full /></main>;

  const pastureItems = items.filter((i) => i.source === "pasture");
  const churchItems = items.filter((i) => i.source === "church");

  return (
    <PastureShell
      eyebrow={home?.pasture_name ? `${home.pasture_name} 목장` : "목장"}
      title="목장"
      chip={home?.is_leader ? "목자·목녀" : undefined}
    >
      {loading ? (
        <div style={cardStyle}><LoadingView /></div>
      ) : error ? (
        <PastureEmpty
          title="목장 정보를 불러오지 못했습니다"
          hint={error}
          action={<button type="button" onClick={load} style={primaryButtonStyle}>다시 불러오기</button>}
        />
      ) : !home?.pasture_id ? (
        <PastureEmpty
          title="아직 소속된 목장이 없습니다"
          hint="목장 소속은 가정 정보를 통해 연결됩니다. 관리자에게 문의해 주세요."
        />
      ) : (
        <>
          {toast && <div style={toastStyle}>{toast}</div>}

          {/* 다음 목장모임 */}
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>다음 목장모임</div>
            {home.next_schedule_id ? (
              <>
                <button
                  type="button"
                  onClick={() => router.push(`/pasture/s/${home.next_schedule_id}`)}
                  style={rowButtonStyle}
                >
                  <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>
                      {formatMeetingDate(home.next_meets_on)} {formatTime(home.next_start_time)}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 3 }}>
                      {[home.next_location, home.next_meal ? "식사 있음" : null, home.next_family ? "가족 동반" : null]
                        .filter(Boolean).join(" · ") || home.next_title}
                    </div>
                  </div>
                  <ChevronRight size={18} strokeWidth={1.8} style={{ color: "var(--ink-faint)", flexShrink: 0 }} />
                </button>

                <div style={tallyRowStyle}>
                  <Tally label="참석" value={home.cnt_attend} color="var(--success)" />
                  <Tally label="미정" value={home.cnt_undecided} color="var(--warning)" />
                  <Tally label="불참" value={home.cnt_absent} color="var(--danger)" />
                  <Tally label="미응답" value={home.cnt_pending} color="var(--ink-faint)" />
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 10 }}>
                  성인 {home.member_total}명 기준
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  {(["attend", "undecided", "absent"] as RsvpResponse[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={busy}
                      onClick={() => respond(r)}
                      style={home.my_response === r ? { ...primaryButtonStyle, flex: 1 } : { ...ghostButtonStyle, flex: 1 }}
                    >
                      {RSVP_LABEL[r]}
                    </button>
                  ))}
                </div>

                {home.is_leader && home.cnt_pending > 0 && (
                  <button type="button" disabled={busy} onClick={askRsvp} style={{ ...ghostButtonStyle, width: "100%", marginTop: 8 }}>
                    <Bell size={14} strokeWidth={1.9} style={{ marginRight: 6, verticalAlign: "-2px" }} />
                    미응답 {home.cnt_pending}명에게 알림
                  </button>
                )}
              </>
            ) : (
              <div style={{ fontSize: 14, color: "var(--ink-soft)" }}>
                아직 확정된 모임이 없습니다.
                {home.is_leader ? " 가능일 집계에서 날짜를 확정해 주세요." : " 이번 달 가능한 날을 표시해 주세요."}
              </div>
            )}
          </div>

          {/* 이번 달 가능일 */}
          <button
            type="button"
            onClick={() => router.push("/pasture/calendar?mode=availability")}
            style={{ ...cardStyle, ...rowButtonStyle, width: "100%" }}
          >
            <CalendarDays size={20} strokeWidth={1.8} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>이번 달 모임 가능일</div>
              <div style={{ fontSize: 12.5, color: home.my_availability_count > 0 ? "var(--ink-soft)" : "var(--warning)", marginTop: 2 }}>
                {home.my_availability_count > 0
                  ? `${home.my_availability_count}일 표시했습니다 · 달력에서 수정`
                  : "아직 표시하지 않았습니다 — 가능한 날을 알려주세요"}
              </div>
            </div>
            <ChevronRight size={18} strokeWidth={1.8} style={{ color: "var(--ink-faint)", flexShrink: 0 }} />
          </button>

          {home.is_leader && (
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>목자·목녀</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => router.push("/pasture/calendar?mode=summary")} style={{ ...primaryButtonStyle, flex: 1, minWidth: 150 }}>
                  가능일 집계 · 확정
                </button>
                <button type="button" disabled={busy} onClick={askAvailability} style={{ ...ghostButtonStyle, flex: 1, minWidth: 150 }}>
                  <Bell size={14} strokeWidth={1.9} style={{ marginRight: 6, verticalAlign: "-2px" }} />
                  가능일 입력 요청
                </button>
              </div>
            </div>
          )}

          {/* 이번 달 목장 일정 */}
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>이번 달 목장 일정</div>
            {pastureItems.length === 0 ? (
              <div style={{ fontSize: 13.5, color: "var(--ink-faint)" }}>등록된 일정이 없습니다</div>
            ) : (
              pastureItems.map((i) => (
                <button key={i.ref_id} type="button" onClick={() => router.push(`/pasture/s/${i.ref_id}`)} style={listRowStyle}>
                  <span style={dotStyle("var(--accent)")} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 66 }}>{formatMeetingDate(i.on_date)}</span>
                  <span style={{ fontSize: 13.5, flex: 1, textAlign: "left", minWidth: 0 }}>{i.title}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{formatTime(i.start_time)}</span>
                </button>
              ))
            )}
          </div>

          {/* 교회 공식 일정 */}
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>교회 공식 일정</div>
            {churchItems.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--ink-faint)", lineHeight: 1.6 }}>
                <Church size={14} strokeWidth={1.8} style={{ verticalAlign: "-2px", marginRight: 5 }} />
                등록된 교회 일정이 없습니다. 교회 달력이 준비되면 이 자리에 함께 표시됩니다.
              </div>
            ) : (
              churchItems.map((i) => (
                <div key={i.ref_id} style={{ ...listRowStyle, cursor: "default" }}>
                  <span style={dotStyle("var(--brass)")} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 66 }}>{formatMeetingDate(i.on_date)}</span>
                  <span style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{i.title}</span>
                </div>
              ))
            )}
          </div>

          <button type="button" onClick={() => router.push("/pasture/members")} style={{ ...cardStyle, ...rowButtonStyle, width: "100%" }}>
            <Users size={20} strokeWidth={1.8} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>우리 목장 구성원</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>가정별로 보기 · 자녀 포함</div>
            </div>
            <ChevronRight size={18} strokeWidth={1.8} style={{ color: "var(--ink-faint)", flexShrink: 0 }} />
          </button>
        </>
      )}
    </PastureShell>
  );
}

function Tally({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ fontSize: 19, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 1 }}>{label}</div>
    </div>
  );
}

const dotStyle = (color: string): React.CSSProperties => ({
  width: 7, height: 7, borderRadius: 999, background: color, flexShrink: 0,
});

const rowButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  border: "none",
  background: "transparent",
  padding: 0,
  color: "var(--ink)",
  cursor: "pointer",
  fontFamily: "inherit",
  width: "100%",
};

const tallyRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  margin: "14px 0 2px",
  padding: "10px 0",
  borderTop: "1px solid var(--hairline)",
  borderBottom: "1px solid var(--hairline)",
};

const listRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "9px 0",
  border: "none",
  borderBottom: "1px solid var(--hairline)",
  background: "transparent",
  color: "var(--ink)",
  cursor: "pointer",
  fontFamily: "inherit",
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
