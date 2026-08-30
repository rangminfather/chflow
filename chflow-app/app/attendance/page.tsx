"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, LayoutGrid, MapPin, RefreshCw, Table2, UserRound, UsersRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import YmdSelect from "@/components/YmdSelect";

type AttendanceRow = {
  member_id: string;
  member_name: string;
  attend_date: string;
  source: "auto_geofence" | "manual" | "corrected";
  recorded_at: string;
};

type AbsenceRow = {
  member_id: string;
  member_name: string;
  last_attend_date: string;
  absent_weeks: number;
};

type Overview = { attendance: AttendanceRow[]; absences: AbsenceRow[] };

/** 하루치 출석을 한 덩어리로 묶은 형태 — 달력·요약카드·명단이 모두 이 값을 쓴다 */
type DayGroup = { date: string; rows: AttendanceRow[]; auto: number; manual: number };

type ViewMode = "calendar" | "cards" | "roster";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

// 조회 기간 연도 목록 — 자동출석 기록이 쌓인 범위만 보여준다
const ATTENDANCE_MIN_YEAR = new Date().getFullYear() - 3;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const ymd = (year: number, monthIndex: number, day: number) =>
  `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const weekdayOf = (date: string) => new Date(`${date}T00:00:00`).getDay();
/** 8/23 (주일) 형태 — 일요일만 주일로 표기한다 */
const dateLabel = (date: string) => {
  const day = weekdayOf(date);
  const [, month, dayOfMonth] = date.split("-");
  return `${Number(month)}/${Number(dayOfMonth)} (${day === 0 ? "주일" : WEEKDAYS[day]})`;
};
const weekdayTag = (date: string) => {
  const day = weekdayOf(date);
  return day === 0 ? "주일" : WEEKDAYS[day];
};
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

/* 좁은 화면 판정 — 출석부는 폭이 근본적으로 모자라 표 대신 성도별 줄로 바꾼다.
   effect+setState 대신 useSyncExternalStore 로 읽어 SSR(항상 false)과 어긋나지 않게 한다. */
const NARROW_QUERY = "(max-width: 768px)";
const subscribeNarrow = (onChange: () => void) => {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
function useIsNarrow() {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

/** 조회 기간이 걸쳐 있는 달들을 7열 달력 셀로 펼친다 (앞뒤 빈칸은 null) */
function buildMonths(start: string, end: string) {
  if (!start || !end || start > end) return [];
  const first = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return [];
  const months: { year: number; monthIndex: number; cells: (string | null)[] }[] = [];
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
  // 기간을 아주 넓게 잡아도 달력이 무한히 길어지지 않도록 24개월에서 끊는다
  while (cursor <= last && months.length < 24) {
    const year = cursor.getFullYear();
    const monthIndex = cursor.getMonth();
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    const cells: (string | null)[] = Array(new Date(year, monthIndex, 1).getDay()).fill(null);
    for (let day = 1; day <= dayCount; day += 1) cells.push(ymd(year, monthIndex, day));
    while (cells.length % 7 !== 0) cells.push(null);
    months.push({ year, monthIndex, cells });
    cursor.setMonth(monthIndex + 1);
  }
  return months;
}

export default function AttendanceOverviewPage() {
  const router = useRouter();
  const [start, setStart] = useState(daysAgo(30));
  const [end, setEnd] = useState(today());
  const [overview, setOverview] = useState<Overview>({ attendance: [], absences: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("calendar");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const isNarrow = useIsNarrow();

  const load = useCallback(async () => {
    // 연·월·일 중 하나라도 비어 있으면 조회하지 않는다 (기간이 정해지기 전 요청 방지)
    if (!start || !end) {
      setError("조회 기간을 연·월·일까지 선택해 주세요.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setError("로그인이 필요합니다.");
      setLoading(false);
      return;
    }
    const response = await fetch(`/api/attendance/overview?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => null) as { error?: string; attendance?: AttendanceRow[]; absences?: AbsenceRow[] } | null;
    if (!response.ok) {
      setError(payload?.error || "출석 정보를 불러오지 못했습니다.");
    } else {
      setOverview({ attendance: payload?.attendance || [], absences: payload?.absences || [] });
    }
    setLoading(false);
  }, [end, start]);

  useEffect(() => { void load(); }, [load]);

  const dayGroups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, AttendanceRow[]>();
    for (const row of overview.attendance) {
      const bucket = map.get(row.attend_date);
      if (bucket) bucket.push(row);
      else map.set(row.attend_date, [row]);
    }
    return Array.from(map.entries())
      .map(([date, rows]) => ({
        date,
        rows: [...rows].sort((a, b) => a.member_name.localeCompare(b.member_name, "ko")),
        auto: rows.filter((row) => row.source === "auto_geofence").length,
        manual: rows.filter((row) => row.source !== "auto_geofence").length,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [overview.attendance]);

  const dayMap = useMemo(() => new Map(dayGroups.map((group) => [group.date, group])), [dayGroups]);
  const maxPerDay = useMemo(() => dayGroups.reduce((max, group) => Math.max(max, group.rows.length), 0), [dayGroups]);
  const months = useMemo(() => buildMonths(start, end), [start, end]);

  // 선택한 날짜가 새 조회 결과에 없으면 가장 최근 출석일을 보여준다 (조회 기간을 바꾼 직후)
  const activeDate = selectedDate && dayMap.has(selectedDate) ? selectedDate : dayGroups[0]?.date ?? null;
  const selected = activeDate ? dayMap.get(activeDate) ?? null : null;

  // 출석부(성도×날짜) 표용 — 열은 출석이 있었던 날짜 오름차순, 행은 이름순 성도
  const roster = useMemo(() => {
    const dates = dayGroups.map((group) => group.date).slice().reverse();
    const members = new Map<string, { id: string; name: string; count: number }>();
    const marks = new Map<string, AttendanceRow["source"]>();
    for (const row of overview.attendance) {
      const found = members.get(row.member_id);
      if (found) found.count += 1;
      else members.set(row.member_id, { id: row.member_id, name: row.member_name, count: 1 });
      marks.set(`${row.member_id}|${row.attend_date}`, row.source);
    }
    return {
      dates,
      members: Array.from(members.values()).sort((a, b) => a.name.localeCompare(b.name, "ko")),
      marks,
    };
  }, [dayGroups, overview.attendance]);

  return (
    <>
      {/* 하위 화면 공통 헤더 — 홈 로고는 왼쪽, 상위 메뉴(홈) 이동은 오른쪽 (globals.css 규칙) */}
      <div className="app-subpage-header" style={subpageHeaderStyle}>
        <HeaderLogo />
        <button
          className="app-header-back"
          onClick={() => router.push("/home")}
          style={headerBackStyle}
          aria-label="홈으로"
        >
          ← 홈
        </button>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>
          <UsersRound size={18} strokeWidth={1.8} /> 교회 출석 현황
        </div>
      </div>

    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 20px 64px" }}>
      <header className="att-head" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 24 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 13 }}>목회 참고용 · <Link href="/attendance/settings" style={{ color: "var(--accent)" }}>자동출석 설정</Link></p>
          <h1 className="att-title" style={{ margin: "6px 0 8px", fontSize: 30, letterSpacing: "-0.04em" }}>교회 출석 현황</h1>
          <p className="att-desc" style={{ margin: 0, color: "var(--ink-mid)", fontSize: 14 }}>위치 기반 자동출석은 참고 신호이며, 필요하면 수동으로 확인해 주세요.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} style={buttonStyle}>
          <RefreshCw size={16} className={loading ? "attendance-spin" : undefined} /> 새로고침
        </button>
      </header>

      <section style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}><CalendarDays size={18} /> 조회 기간</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <YmdSelect groupLabel="조회 시작일" value={start} onChange={setStart} minYear={ATTENDANCE_MIN_YEAR} selectStyle={inputStyle} />
          </div>
          <span style={{ color: "var(--ink-soft)" }}>~</span>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <YmdSelect groupLabel="조회 종료일" value={end} onChange={setEnd} minYear={ATTENDANCE_MIN_YEAR} selectStyle={inputStyle} />
          </div>
        </div>
      </section>

      {error && <div role="alert" style={errorStyle}>{error}</div>}

      <section className="att-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, margin: "18px 0" }}>
        <Stat icon={<UsersRound size={18} />} label="조회 기간 출석" value={`${overview.attendance.length}건`} />
        <Stat icon={<MapPin size={18} />} label="자동 감지 출석" value={`${overview.attendance.filter((row) => row.source === "auto_geofence").length}건`} />
        <Stat icon={<UserRound size={18} />} label="2주 이상 미출석" value={`${overview.absences.length}명`} />
      </section>

      <section style={cardStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <h2 style={{ ...sectionTitle, margin: 0 }}>출석 기록</h2>
          <div role="tablist" aria-label="출석 기록 보기 방식" className="att-tabs" style={segmentWrap}>
            <ViewTab current={view} value="calendar" onSelect={setView} icon={<CalendarDays size={14} />} label="달력" />
            <ViewTab current={view} value="cards" onSelect={setView} icon={<LayoutGrid size={14} />} label="요약" />
            <ViewTab current={view} value="roster" onSelect={setView} icon={<Table2 size={14} />} label="출석부" />
          </div>
        </div>

        {loading ? <p style={muted}>불러오는 중입니다.</p> : overview.attendance.length === 0 ? <p style={muted}>조회 기간에 기록이 없습니다.</p> : (
          <>
            {view === "calendar" && (
              <div style={{ display: "grid", gap: 18 }}>
                {months.map((month) => (
                  <div key={`${month.year}-${month.monthIndex}`}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{month.year}년 {month.monthIndex + 1}월</div>
                    <div style={calendarGrid}>
                      {WEEKDAYS.map((label, index) => (
                        <div key={label} style={{ ...weekdayHead, color: index === 0 ? "var(--danger)" : "var(--ink-soft)" }}>{label}</div>
                      ))}
                      {month.cells.map((date, index) => {
                        if (!date) return <div key={`empty-${index}`} />;
                        const outOfRange = date < start || date > end;
                        const group = dayMap.get(date);
                        const count = group?.rows.length ?? 0;
                        const isSunday = weekdayOf(date) === 0;
                        const isSelected = activeDate === date;
                        return (
                          <button
                            key={date}
                            type="button"
                            onClick={() => { if (count > 0) setSelectedDate(date); }}
                            disabled={count === 0}
                            aria-pressed={isSelected}
                            aria-label={`${date} 출석 ${count}명`}
                            className="att-cell"
                            style={{
                              ...calendarCell,
                              opacity: outOfRange ? 0.4 : 1,
                              cursor: count > 0 ? "pointer" : "default",
                              background: count > 0 ? heatBackground(count, maxPerDay) : "var(--bg-soft)",
                              borderColor: isSelected ? "var(--accent)" : "var(--hairline)",
                              boxShadow: isSelected ? "0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent)" : "none",
                            }}
                          >
                            <span style={{ fontSize: 12, fontWeight: 600, color: isSunday ? "var(--danger)" : "var(--ink-mid)" }}>
                              {Number(date.split("-")[2])}
                            </span>
                            <span style={{ fontSize: count > 0 ? 15 : 12, fontWeight: count > 0 ? 800 : 400, color: count > 0 ? "var(--ink)" : "var(--ink-soft)" }}>
                              {count > 0 ? count : "·"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <p style={{ ...muted, margin: 0 }}>칸의 숫자는 그날 출석 인원이고, 색이 진할수록 많은 날입니다. 날짜를 누르면 아래에 명단이 나옵니다.</p>
              </div>
            )}

            {view === "cards" && (
              <div className="att-cards" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
                {dayGroups.map((group) => {
                  const total = group.rows.length;
                  const isSelected = activeDate === group.date;
                  return (
                    <button
                      key={group.date}
                      type="button"
                      onClick={() => setSelectedDate(group.date)}
                      aria-pressed={isSelected}
                      style={{
                        ...dayCard,
                        borderColor: isSelected ? "var(--accent)" : "var(--hairline)",
                        boxShadow: isSelected ? "0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)" : "none",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 700, color: weekdayOf(group.date) === 0 ? "var(--danger)" : "var(--ink-mid)" }}>
                        {dateLabel(group.date)}
                      </span>
                      <strong style={{ fontSize: 26, letterSpacing: "-0.03em" }}>
                        {total}<span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)" }}>명</span>
                      </strong>
                      <span style={barTrack}>
                        <span style={{ ...barAuto, width: `${(group.auto / total) * 100}%` }} />
                        <span style={{ ...barManual, width: `${(group.manual / total) * 100}%` }} />
                      </span>
                      <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>자동 {group.auto} · 수동 {group.manual}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {view === "roster" && isNarrow && (
              <div>
                {/* 좁은 화면에서는 날짜 열이 화면 밖으로 잘려 표가 못 쓰게 된다.
                    성도 한 줄 = 이름 + 날짜순 점 띠 로 바꿔 가로 스크롤 없이 담는다. */}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--ink-soft)", marginBottom: 8 }}>
                  <span>← {dateLabel(roster.dates[0] ?? "")}</span>
                  <span>{dateLabel(roster.dates[roster.dates.length - 1] ?? "")} →</span>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {roster.members.map((member) => (
                    <div key={member.id} style={narrowRosterRow}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <strong style={{ fontSize: 14 }}>{member.name}</strong>
                        <span style={{ fontSize: 12, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{member.count}회</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                        {roster.dates.map((date) => {
                          const mark = roster.marks.get(`${member.id}|${date}`);
                          return (
                            <span
                              key={date}
                              title={`${date} ${mark ? "출석" : "기록 없음"}`}
                              style={{
                                ...rosterDot,
                                width: 10,
                                height: 10,
                                background: mark
                                  ? (mark === "auto_geofence" ? "var(--accent)" : "var(--ink-soft)")
                                  : "color-mix(in srgb, var(--ink-soft) 18%, transparent)",
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ ...muted, margin: "12px 0 0" }}>
                  점 하나가 날짜 하나입니다(왼쪽이 이른 날짜). 진한 점은 출석, 흐린 점은 기록 없음.
                </p>
              </div>
            )}

            {view === "roster" && !isNarrow && (
              <div>
                <div style={{ overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, ...stickyName }}>성도</th>
                        {roster.dates.map((date) => (
                          <th key={date} style={{ ...thStyle, textAlign: "center", whiteSpace: "nowrap", color: weekdayOf(date) === 0 ? "var(--danger)" : "var(--ink-soft)" }}>
                            {dateLabel(date)}
                          </th>
                        ))}
                        <th style={{ ...thStyle, textAlign: "center", whiteSpace: "nowrap" }}>합계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.members.map((member) => (
                        <tr key={member.id}>
                          <td style={{ ...tdStyle, ...stickyName, fontWeight: 600, whiteSpace: "nowrap" }}>{member.name}</td>
                          {roster.dates.map((date) => {
                            const mark = roster.marks.get(`${member.id}|${date}`);
                            return (
                              <td key={date} style={{ ...tdStyle, textAlign: "center" }}>
                                {mark ? (
                                  <span
                                    title={mark === "auto_geofence" ? "자동 감지" : mark === "corrected" ? "수정" : "수동"}
                                    style={{ ...rosterDot, background: mark === "auto_geofence" ? "var(--accent)" : "var(--ink-soft)" }}
                                  />
                                ) : (
                                  <span style={{ color: "var(--hairline-strong)" }}>·</span>
                                )}
                              </td>
                            );
                          })}
                          <td style={{ ...tdStyle, textAlign: "center", fontWeight: 700 }}>{member.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ ...muted, margin: "12px 0 0" }}>
                  <span style={{ ...rosterDot, background: "var(--accent)", marginRight: 5 }} />자동 감지
                  <span style={{ ...rosterDot, background: "var(--ink-soft)", margin: "0 5px 0 12px" }} />수동·수정 · 열은 조회 기간 중 출석 기록이 있는 날짜입니다.
                </p>
              </div>
            )}

            {view !== "roster" && selected && (
              <div style={rosterPanel}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
                  <strong style={{ fontSize: 16, letterSpacing: "-0.03em" }}>{selected.date} ({weekdayTag(selected.date)})</strong>
                  <span style={{ fontSize: 13, color: "var(--ink-mid)" }}>{selected.rows.length}명 · 자동 {selected.auto} · 수동 {selected.manual}</span>
                </div>
                <div className="att-chips" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(116px, 1fr))", gap: 8 }}>
                  {selected.rows.map((row) => (
                    <div key={`${row.member_id}-${row.attend_date}`} style={nameChip}>
                      <span style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.member_name}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--ink-soft)" }}>
                        <span style={{ ...rosterDot, width: 6, height: 6, background: row.source === "auto_geofence" ? "var(--accent)" : "var(--ink-soft)" }} />
                        {timeLabel(row.recorded_at)} · {row.source === "auto_geofence" ? "자동" : row.source === "corrected" ? "수정" : "수동"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section style={{ ...cardStyle, marginTop: 18 }}>
        <h2 style={sectionTitle}>연락 확인 대상</h2>
        <p style={{ ...muted, marginTop: -2 }}>최근 2주 이상 자동/수동 출석 기록이 없는 활성 성도입니다.</p>
        {overview.absences.length === 0 ? <p style={muted}>현재 확인 대상이 없습니다.</p> : <div style={{ display: "grid", gap: 8 }}>{overview.absences.map((row) => <div key={row.member_id} style={absenceRow}><div><strong>{row.member_name}</strong><div style={muted}>마지막 출석 {row.last_attend_date}</div></div><span style={absenceBadge}>{row.absent_weeks}주 미출석</span></div>)}</div>}
      </section>
      <style>{`
        .attendance-spin{animation:attendance-spin .8s linear infinite}
        @keyframes attendance-spin{to{transform:rotate(360deg)}}
        /* 모바일 전용 밀도 — 인라인 style 을 이기려면 !important 가 필요하다 (globals.css 의 journal-stats-grid 와 같은 방식) */
        @media (max-width: 768px){
          .att-head{flex-direction:column;gap:10px !important;margin-bottom:16px !important}
          .att-title{font-size:22px !important;margin:4px 0 6px !important}
          .att-desc{font-size:13px !important}
          .att-stats{grid-template-columns:repeat(3, minmax(0, 1fr)) !important;gap:8px !important;margin:14px 0 !important}
          .att-stat{padding:11px 9px !important;border-radius:14px !important}
          .att-stat-label{font-size:11px !important;gap:4px !important;line-height:1.35}
          .att-stat-icon{display:none}
          .att-stat-value{font-size:18px !important;margin-top:6px !important}
          .att-tabs{width:100%}
          .att-tabs button{flex:1;justify-content:center;padding:9px 4px !important}
          .att-cell{min-height:46px !important}
          .att-cards{grid-template-columns:repeat(2, minmax(0, 1fr)) !important}
          .att-chips{grid-template-columns:repeat(auto-fill, minmax(96px, 1fr)) !important}
        }
      `}</style>
    </main>
    </>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="att-stat" style={cardStyle}>
      <div className="att-stat-label" style={{ display: "flex", gap: 8, color: "var(--ink-soft)", fontSize: 13 }}>
        <span className="att-stat-icon">{icon}</span>{label}
      </div>
      <strong className="att-stat-value" style={{ display: "block", fontSize: 25, marginTop: 12 }}>{value}</strong>
    </div>
  );
}

function ViewTab({ current, value, onSelect, icon, label }: { current: ViewMode; value: ViewMode; onSelect: (next: ViewMode) => void; icon: ReactNode; label: string }) {
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(value)}
      style={{
        ...segmentButton,
        background: active ? "var(--card)" : "transparent",
        color: active ? "var(--ink)" : "var(--ink-soft)",
        fontWeight: active ? 700 : 500,
        boxShadow: active ? "0 1px 4px rgba(26,22,18,.10)" : "none",
      }}
    >
      {icon} {label}
    </button>
  );
}

/** 인원이 많은 날일수록 진하게 — 0명인 날은 호출하지 않는다 */
function heatBackground(count: number, max: number) {
  const ratio = max > 0 ? count / max : 0;
  const percent = Math.round(10 + ratio * 45);
  return `color-mix(in srgb, var(--accent) ${percent}%, var(--card))`;
}

const cardStyle: CSSProperties = { background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: 18, padding: 18, boxShadow: "0 2px 14px rgba(26,22,18,.04)" };
const buttonStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--hairline)", borderRadius: 10, padding: "9px 12px", background: "var(--card)", color: "var(--ink)", cursor: "pointer" };
const inputStyle: CSSProperties = { border: "1px solid var(--hairline)", borderRadius: 9, padding: "9px 10px", background: "var(--paper)", color: "var(--ink)" };
const errorStyle: CSSProperties = { margin: "16px 0", padding: 12, borderRadius: 10, background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)" };
const sectionTitle: CSSProperties = { margin: "0 0 14px", fontSize: 18, letterSpacing: "-0.03em" };
const muted: CSSProperties = { color: "var(--ink-soft)", fontSize: 13 };
const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 14 };
const thStyle: CSSProperties = { textAlign: "left", color: "var(--ink-soft)", fontWeight: 600, padding: "9px 8px", borderBottom: "1px solid var(--hairline)" };
const tdStyle: CSSProperties = { padding: "12px 8px", borderBottom: "1px solid var(--hairline)" };
const absenceRow: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--hairline)" };
const absenceBadge: CSSProperties = { whiteSpace: "nowrap", borderRadius: 999, padding: "5px 9px", background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)", fontSize: 12, fontWeight: 700 };

const segmentWrap: CSSProperties = { display: "inline-flex", gap: 3, padding: 3, borderRadius: 12, background: "var(--bg-soft)", border: "1px solid var(--hairline)" };
const segmentButton: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, border: "none", borderRadius: 9, padding: "7px 12px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" };

const calendarGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 5 };
const weekdayHead: CSSProperties = { textAlign: "center", fontSize: 12, fontWeight: 600, paddingBottom: 2 };
const calendarCell: CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
  minHeight: 54, padding: "6px 2px", borderRadius: 10, border: "1px solid var(--hairline)",
  fontFamily: "inherit", color: "var(--ink)",
};

const dayCard: CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6,
  padding: "12px 14px", borderRadius: 14, border: "1px solid var(--hairline)",
  background: "var(--bg-soft)", color: "var(--ink)", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
};
const barTrack: CSSProperties = { display: "flex", width: "100%", height: 8, borderRadius: 999, overflow: "hidden", background: "color-mix(in srgb, var(--ink-soft) 15%, transparent)" };
const barAuto: CSSProperties = { display: "block", height: "100%", background: "var(--accent)" };
const barManual: CSSProperties = { display: "block", height: "100%", background: "color-mix(in srgb, var(--ink-soft) 55%, transparent)" };

const stickyName: CSSProperties = { position: "sticky", left: 0, zIndex: 1, background: "var(--card)" };
const rosterDot: CSSProperties = { display: "inline-block", width: 9, height: 9, borderRadius: "50%" };

const narrowRosterRow: CSSProperties = {
  padding: "10px 12px", borderRadius: 12, border: "1px solid var(--hairline)", background: "var(--bg-soft)",
};

const rosterPanel: CSSProperties = { marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--hairline)" };
const nameChip: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 3, minWidth: 0,
  padding: "8px 10px", borderRadius: 10, border: "1px solid var(--hairline)", background: "var(--bg-soft)",
};

/* 하위 화면 공통 헤더 스타일 — /admin/usage-status 등과 동일 규칙 */
const subpageHeaderStyle: CSSProperties = {
  background: "var(--card)",
  borderBottom: "1px solid var(--hairline)",
  padding: "12px 20px",
};

const headerBackStyle: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 10,
  border: "1px solid var(--hairline-strong)",
  background: "var(--bg-soft)",
  color: "var(--ink-mid)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};
