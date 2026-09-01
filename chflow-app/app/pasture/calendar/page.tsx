"use client";

// 목장 달력 — 한 화면에서 모드만 바꿔 조회 · 가능일 입력 · (목자)집계·확정을 모두 처리한다.
//  일정   : 목장(accent)·교회(brass) 일정을 점으로 구분해 표시
//  가능일 : 날짜를 누를 때마다 가능 → 어려움 → 해제 순환. 별도 저장 버튼 없음
//  집계   : 날짜별 가능/응답 수와 추천일. 목자·목녀만 보이고 그 자리에서 확정한다
//
// 집계 분모는 성인만이다(DB RPC 기준). 자녀는 구성원 화면에서만 보여준다.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Star, Church } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import ModalBackdrop from "@/components/ModalBackdrop";
import {
  PastureShell, PastureEmpty, cardStyle, sectionTitleStyle,
  primaryButtonStyle, ghostButtonStyle,
} from "@/components/PastureShell";
import {
  fetchPastureHome, fetchCalendar, fetchAvailabilitySummary, setAvailability, confirmMeeting,
  monthRange, ymd, formatMeetingDate, formatTime, AVAILABILITY_LABEL,
  type PastureHome, type CalendarRow, type AvailabilitySummaryRow, type AvailabilityStatus,
} from "@/lib/pasture";

type Mode = "schedule" | "availability" | "summary";
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
// 누를 때마다 가능 → 어려움 → 해제 로 돈다. "미정" 은 입력하지 않은 것과 구분이 어려워 순환에서 뺐다.
const CYCLE: (AvailabilityStatus | null)[] = ["ok", "hard", null];

// useSearchParams 는 프리렌더 시 Suspense 경계를 요구한다 (app/login/page.tsx 와 같은 패턴).
export default function PastureCalendarPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh" }}><LoadingView full /></main>}>
      <PastureCalendarContent />
    </Suspense>
  );
}

function PastureCalendarContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [authChecked, setAuthChecked] = useState(false);
  const [mode, setMode] = useState<Mode>((params.get("mode") as Mode) || "schedule");
  const [cursor, setCursor] = useState(() => new Date());
  const [home, setHome] = useState<PastureHome | null>(null);
  const [rows, setRows] = useState<CalendarRow[]>([]);
  const [summary, setSummary] = useState<AvailabilitySummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [confirmDate, setConfirmDate] = useState<string | null>(null);

  const { from, to, monthStart } = useMemo(() => monthRange(cursor), [cursor]);

  const load = useCallback(async (h: PastureHome | null) => {
    setError("");
    try {
      const [cal, sum] = await Promise.all([
        fetchCalendar(from, to),
        h?.is_leader ? fetchAvailabilitySummary(from, to) : Promise.resolve([]),
      ]);
      setRows(cal);
      setSummary(sum);
    } catch (e) {
      setError(e instanceof Error ? e.message : "달력을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      try {
        const h = await fetchPastureHome();
        setHome(h);
        if (!h?.is_leader && mode === "summary") setMode("schedule");
        await load(h);
      } catch (e) {
        setError(e instanceof Error ? e.message : "목장 정보를 불러오지 못했습니다");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, from, to]);

  const myAvailability = useMemo(() => {
    const m = new Map<string, AvailabilityStatus>();
    for (const r of rows) if (r.source === "availability") m.set(r.on_date, r.status as AvailabilityStatus);
    return m;
  }, [rows]);

  const summaryByDate = useMemo(() => {
    const m = new Map<string, AvailabilitySummaryRow>();
    for (const s of summary) m.set(s.on_date, s);
    return m;
  }, [summary]);

  const eventsByDate = useMemo(() => {
    const m = new Map<string, CalendarRow[]>();
    for (const r of rows) {
      if (r.source === "availability") continue;
      const list = m.get(r.on_date) ?? [];
      list.push(r);
      m.set(r.on_date, list);
    }
    return m;
  }, [rows]);

  const recommended = summary.find((s) => s.is_recommended) ?? null;

  const tapDate = async (date: string) => {
    if (mode === "availability") {
      const cur = myAvailability.get(date) ?? null;
      const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
      setBusy(true);
      try {
        await setAvailability(date, next);
        await load(home);
        setToast(next ? `${formatMeetingDate(date)} ${AVAILABILITY_LABEL[next]}` : `${formatMeetingDate(date)} 표시 해제`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "저장에 실패했습니다");
      } finally {
        setBusy(false);
        setTimeout(() => setToast(""), 1800);
      }
      return;
    }
    if (mode === "summary" && home?.is_leader) {
      setConfirmDate(date);
      return;
    }
    const items = eventsByDate.get(date) ?? [];
    const first = items.find((i) => i.source === "pasture");
    if (first) router.push(`/pasture/s/${first.ref_id}`);
  };

  if (!authChecked) return <main style={{ minHeight: "100vh" }}><LoadingView full /></main>;

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lead = first.getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => ymd(new Date(cursor.getFullYear(), cursor.getMonth(), i + 1))),
  ];
  const today = ymd(new Date());

  return (
    <PastureShell
      eyebrow={home?.pasture_name ? `${home.pasture_name} 목장` : "목장"}
      title="달력"
      chip={`${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`}
    >
      {/* 모드 */}
      <div style={tabRowStyle}>
        <Tab active={mode === "schedule"} onClick={() => setMode("schedule")}>일정</Tab>
        <Tab active={mode === "availability"} onClick={() => setMode("availability")}>가능일 입력</Tab>
        {home?.is_leader && <Tab active={mode === "summary"} onClick={() => setMode("summary")}>집계 · 확정</Tab>}
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
      {error && <div style={errorStyle}>{error}</div>}

      {loading ? (
        <div style={cardStyle}><LoadingView /></div>
      ) : !home?.pasture_id ? (
        <PastureEmpty title="아직 소속된 목장이 없습니다" />
      ) : (
        <>
          <div style={cardStyle}>
            <div style={monthNavStyle}>
              <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={navBtnStyle} aria-label="이전 달">
                <ChevronLeft size={18} strokeWidth={2} />
              </button>
              <span style={{ fontSize: 15, fontWeight: 800 }}>{cursor.getFullYear()}년 {cursor.getMonth() + 1}월</span>
              <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={navBtnStyle} aria-label="다음 달">
                <ChevronRight size={18} strokeWidth={2} />
              </button>
            </div>

            <div style={gridStyle}>
              {WEEKDAY.map((w, i) => (
                <div key={w} style={{ ...weekdayStyle, color: i === 0 ? "var(--danger)" : i === 6 ? "var(--accent)" : "var(--ink-faint)" }}>{w}</div>
              ))}
              {cells.map((date, idx) => {
                if (!date) return <div key={`e${idx}`} />;
                const av = myAvailability.get(date);
                const sum = summaryByDate.get(date);
                const evs = eventsByDate.get(date) ?? [];
                return (
                  <button
                    key={date}
                    type="button"
                    disabled={busy}
                    onClick={() => tapDate(date)}
                    style={{
                      ...dayStyle,
                      background: mode === "availability" && av ? avBg(av) : "transparent",
                      borderColor: date === today ? "var(--accent)" : "transparent",
                      color: mode === "availability" && av ? avFg(av) : "var(--ink)",
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: date === today ? 800 : 600 }}>{Number(date.slice(-2))}</span>
                    {mode === "summary" && sum ? (
                      <span style={{ fontSize: 9.5, fontWeight: 800, color: sum.is_recommended ? "var(--accent)" : "var(--ink-soft)" }}>
                        {sum.ok_count}/{sum.roster_total}{sum.is_recommended ? "★" : ""}
                      </span>
                    ) : (
                      <span style={{ display: "flex", gap: 2, height: 5, alignItems: "center" }}>
                        {evs.some((e) => e.source === "pasture") && <i style={dot("var(--accent)")} />}
                        {evs.some((e) => e.source === "church") && <i style={dot("var(--brass)")} />}
                        {mode !== "availability" && av && <i style={dot(avFg(av))} />}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {mode === "availability" && (
              <div style={legendStyle}>
                날짜를 누르면 <b style={{ color: "var(--success)" }}>가능</b> → <b style={{ color: "var(--danger)" }}>어려움</b> → 해제 순으로 바뀝니다. 자동 저장됩니다.
              </div>
            )}
            {mode === "schedule" && (
              <div style={legendStyle}>
                <i style={dot("var(--accent)")} /> 목장 일정 &nbsp; <i style={dot("var(--brass)")} /> 교회 일정
              </div>
            )}
          </div>

          {mode === "summary" && (
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>가능일 집계 (성인 {home.member_total}명 기준)</div>
              {summary.length === 0 ? (
                <div style={{ fontSize: 13.5, color: "var(--ink-faint)" }}>아직 응답이 없습니다. 홈에서 「가능일 입력 요청」을 보낼 수 있습니다.</div>
              ) : (
                <>
                  {recommended && (
                    <div style={recommendStyle}>
                      <Star size={15} strokeWidth={2.2} style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 800 }}>추천 모임일 · {formatMeetingDate(recommended.on_date)}</div>
                        <div style={{ fontSize: 12, marginTop: 1 }}>
                          성인 {recommended.roster_total}명 중 {recommended.ok_count}명 가능 (응답 {recommended.responded}명)
                        </div>
                      </div>
                      <button type="button" onClick={() => setConfirmDate(recommended.on_date)} style={{ ...primaryButtonStyle, minHeight: 34, fontSize: 12.5 }}>
                        확정
                      </button>
                    </div>
                  )}
                  {summary.map((s) => (
                    <button key={s.on_date} type="button" onClick={() => setConfirmDate(s.on_date)} style={summaryRowStyle}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 74 }}>{formatMeetingDate(s.on_date)}</span>
                      <span style={{ fontSize: 13, flex: 1, textAlign: "left" }}>
                        가능 <b>{s.ok_count}</b> · 어려움 {s.hard_count} · 응답 {s.responded}/{s.roster_total}
                      </span>
                      {s.is_recommended && <Star size={13} strokeWidth={2.2} style={{ color: "var(--accent)" }} />}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* 해당 월 일정 목록 */}
          {mode === "schedule" && (
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>{cursor.getMonth() + 1}월 일정</div>
              {rows.filter((r) => r.source !== "availability").length === 0 ? (
                <div style={{ fontSize: 13.5, color: "var(--ink-faint)" }}>등록된 일정이 없습니다</div>
              ) : (
                rows.filter((r) => r.source !== "availability").map((r) => (
                  <div key={`${r.source}-${r.ref_id}`} style={eventRowStyle}>
                    <i style={dot(r.source === "pasture" ? "var(--accent)" : "var(--brass)")} />
                    <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 68 }}>{formatMeetingDate(r.on_date)}</span>
                    {r.source === "pasture" ? (
                      <button type="button" onClick={() => router.push(`/pasture/s/${r.ref_id}`)} style={linkBtnStyle}>{r.title}</button>
                    ) : (
                      <span style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>
                        <Church size={12} strokeWidth={1.9} style={{ verticalAlign: "-2px", marginRight: 4, color: "var(--brass)" }} />
                        {r.title}
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{formatTime(r.start_time)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {confirmDate && home?.is_leader && (
        <ConfirmMeetingModal
          date={confirmDate}
          monthStart={monthStart}
          churchConflicts={(eventsByDate.get(confirmDate) ?? []).filter((e) => e.source === "church")}
          summary={summaryByDate.get(confirmDate) ?? null}
          onClose={() => setConfirmDate(null)}
          onDone={async (id) => {
            setConfirmDate(null);
            setToast("목장모임을 확정하고 알림을 보냈습니다");
            await load(home);
            setTimeout(() => setToast(""), 2500);
            router.push(`/pasture/s/${id}`);
          }}
        />
      )}
    </PastureShell>
  );
}

function ConfirmMeetingModal({
  date, monthStart, churchConflicts, summary, onClose, onDone,
}: {
  date: string;
  monthStart: string;
  churchConflicts: CalendarRow[];
  summary: AvailabilitySummaryRow | null;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [title, setTitle] = useState("정기 목장모임");
  const [startTime, setStartTime] = useState("19:30");
  const [location, setLocation] = useState("");
  const [meal, setMeal] = useState(false);
  const [family, setFamily] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setSaving(true);
    setErr("");
    try {
      const id = await confirmMeeting({
        meetsOn: date, title, startTime, location,
        mealProvided: meal, familyAllowed: family, decidedFromMonth: monthStart,
      });
      onDone(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "확정에 실패했습니다");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={modalStyle}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>{formatMeetingDate(date)} 확정</div>
        {summary && (
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>
            성인 {summary.roster_total}명 중 {summary.ok_count}명 가능 · 응답 {summary.responded}명
          </div>
        )}

        {churchConflicts.length > 0 && (
          <div style={warnStyle}>
            같은 날 교회 공식 일정이 있습니다 — {churchConflicts.map((c) => c.title).join(", ")}.
            그대로 확정할 수 있습니다.
          </div>
        )}

        <label style={labelStyle}>일정명</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />

        <label style={labelStyle}>시작 시간</label>
        <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />

        <label style={labelStyle}>장소</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="예: 김OO 목자 가정" style={inputStyle} />

        <div style={{ display: "flex", gap: 8, margin: "12px 0 4px" }}>
          <button type="button" onClick={() => setMeal(!meal)} style={meal ? { ...primaryButtonStyle, flex: 1 } : { ...ghostButtonStyle, flex: 1 }}>식사 있음</button>
          <button type="button" onClick={() => setFamily(!family)} style={family ? { ...primaryButtonStyle, flex: 1 } : { ...ghostButtonStyle, flex: 1 }}>가족 동반</button>
        </div>

        {err && <div style={errorStyle}>{err}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onClose} style={{ ...ghostButtonStyle, flex: 1 }}>취소</button>
          <button type="button" disabled={saving} onClick={submit} style={{ ...primaryButtonStyle, flex: 2 }}>
            {saving ? "확정 중..." : "목장모임으로 확정"}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 8, lineHeight: 1.5 }}>
          확정하면 앱을 쓰는 목장 구성원에게 알림이 갑니다. 이후 참석 여부를 따로 받습니다.
        </div>
      </div>
    </ModalBackdrop>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={active ? tabActiveStyle : tabStyle}>{children}</button>
  );
}

const avBg = (s: AvailabilityStatus) =>
  s === "ok" ? "color-mix(in srgb, var(--success) 18%, transparent)"
  : s === "hard" ? "color-mix(in srgb, var(--danger) 16%, transparent)"
  : "color-mix(in srgb, var(--warning) 16%, transparent)";
const avFg = (s: AvailabilityStatus) =>
  s === "ok" ? "var(--success)" : s === "hard" ? "var(--danger)" : "var(--warning)";

const dot = (color: string): React.CSSProperties => ({
  width: 5, height: 5, borderRadius: 999, background: color, display: "inline-block",
});

const tabRowStyle: React.CSSProperties = { display: "flex", gap: 6, marginBottom: 12 };
const tabStyle: React.CSSProperties = {
  flex: 1, minHeight: 38, borderRadius: 10,
  border: "1px solid var(--hairline)", background: "var(--surface)",
  color: "var(--ink-soft)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
const tabActiveStyle: React.CSSProperties = {
  ...tabStyle, background: "var(--accent)", borderColor: "var(--accent)", color: "var(--on-accent, #fff)", fontWeight: 800,
};

const monthNavStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10,
};
const navBtnStyle: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 9, border: "1px solid var(--hairline)",
  background: "var(--surface)", color: "var(--ink)", display: "inline-flex",
  alignItems: "center", justifyContent: "center", cursor: "pointer",
};

const gridStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3,
};
const weekdayStyle: React.CSSProperties = {
  textAlign: "center", fontSize: 11, fontWeight: 700, paddingBottom: 4,
};
const dayStyle: React.CSSProperties = {
  aspectRatio: "1 / 1", minHeight: 40, borderRadius: 9,
  border: "1.5px solid transparent", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", gap: 2,
  cursor: "pointer", fontFamily: "inherit", padding: 0,
};

const legendStyle: React.CSSProperties = {
  marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--hairline)",
  fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.6,
};

const summaryRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, width: "100%",
  padding: "9px 0", border: "none", borderBottom: "1px solid var(--hairline)",
  background: "transparent", color: "var(--ink)", cursor: "pointer", fontFamily: "inherit",
};

const recommendStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, marginBottom: 10,
  padding: "12px 14px", borderRadius: 10,
  border: "1px solid var(--accent)",
  background: "color-mix(in srgb, var(--accent) 8%, transparent)",
  color: "var(--accent)",
};

const eventRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 9,
  padding: "9px 0", borderBottom: "1px solid var(--hairline)",
};

const linkBtnStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent",
  color: "var(--ink)", fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", padding: 0,
};

const modalStyle: React.CSSProperties = {
  width: "100%", maxWidth: 420, background: "var(--card)",
  border: "1px solid var(--hairline)", borderRadius: 14, padding: 20,
  color: "var(--ink)", fontFamily: "'Noto Sans KR', var(--app-sans), sans-serif",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", margin: "10px 0 4px",
};
const inputStyle: React.CSSProperties = {
  width: "100%", minHeight: 40, padding: "0 12px", borderRadius: 9,
  border: "1px solid var(--hairline)", background: "var(--surface)",
  color: "var(--ink)", fontSize: 14, fontFamily: "inherit",
};
const warnStyle: React.CSSProperties = {
  marginBottom: 10, padding: "10px 12px", borderRadius: 9,
  border: "1px solid color-mix(in srgb, var(--warning) 40%, transparent)",
  background: "color-mix(in srgb, var(--warning) 10%, transparent)",
  fontSize: 12.5, lineHeight: 1.6,
};
const toastStyle: React.CSSProperties = {
  marginBottom: 12, padding: "10px 14px", borderRadius: 10,
  background: "color-mix(in srgb, var(--accent) 12%, transparent)",
  color: "var(--accent)", fontSize: 13, fontWeight: 700,
};
const errorStyle: React.CSSProperties = {
  marginBottom: 12, padding: "10px 14px", borderRadius: 10,
  background: "color-mix(in srgb, var(--danger) 10%, transparent)",
  color: "var(--danger)", fontSize: 13, fontWeight: 700,
};
