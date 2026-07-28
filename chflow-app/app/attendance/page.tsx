"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { CalendarDays, MapPin, RefreshCw, UserRound, UsersRound } from "lucide-react";
import { supabase } from "@/lib/supabase";

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

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

export default function AttendanceOverviewPage() {
  const [start, setStart] = useState(daysAgo(30));
  const [end, setEnd] = useState(today());
  const [overview, setOverview] = useState<Overview>({ attendance: [], absences: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 20px 64px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 13 }}>목회 참고용</p>
          <h1 style={{ margin: "6px 0 8px", fontSize: 30, letterSpacing: "-0.04em" }}>교회 출석 현황</h1>
          <p style={{ margin: 0, color: "var(--ink-mid)", fontSize: 14 }}>위치 기반 자동출석은 참고 신호이며, 필요하면 수동으로 확인해 주세요.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} style={buttonStyle}>
          <RefreshCw size={16} className={loading ? "attendance-spin" : undefined} /> 새로고침
        </button>
      </header>

      <section style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}><CalendarDays size={18} /> 조회 기간</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <input aria-label="조회 시작일" type="date" value={start} onChange={(event) => setStart(event.target.value)} style={inputStyle} />
          <span style={{ color: "var(--ink-soft)" }}>~</span>
          <input aria-label="조회 종료일" type="date" value={end} onChange={(event) => setEnd(event.target.value)} style={inputStyle} />
        </div>
      </section>

      {error && <div role="alert" style={errorStyle}>{error}</div>}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, margin: "18px 0" }}>
        <Stat icon={<UsersRound size={18} />} label="조회 기간 출석" value={`${overview.attendance.length}건`} />
        <Stat icon={<MapPin size={18} />} label="자동 감지 출석" value={`${overview.attendance.filter((row) => row.source === "auto_geofence").length}건`} />
        <Stat icon={<UserRound size={18} />} label="2주 이상 미출석" value={`${overview.absences.length}명`} />
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitle}>출석 기록</h2>
        {loading ? <p style={muted}>불러오는 중입니다.</p> : overview.attendance.length === 0 ? <p style={muted}>조회 기간에 기록이 없습니다.</p> : (
          <div style={{ overflowX: "auto" }}><table style={tableStyle}><thead><tr><th style={thStyle}>날짜</th><th style={thStyle}>성도</th><th style={thStyle}>출처</th><th style={thStyle}>기록 시각</th></tr></thead><tbody>
            {overview.attendance.map((row) => <tr key={`${row.member_id}-${row.attend_date}`}><td style={tdStyle}>{row.attend_date}</td><td style={tdStyle}>{row.member_name}</td><td style={tdStyle}><SourceBadge source={row.source} /></td><td style={tdStyle}>{new Date(row.recorded_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</td></tr>)}
          </tbody></table></div>
        )}
      </section>

      <section style={{ ...cardStyle, marginTop: 18 }}>
        <h2 style={sectionTitle}>연락 확인 대상</h2>
        <p style={{ ...muted, marginTop: -2 }}>최근 2주 이상 자동/수동 출석 기록이 없는 활성 성도입니다.</p>
        {overview.absences.length === 0 ? <p style={muted}>현재 확인 대상이 없습니다.</p> : <div style={{ display: "grid", gap: 8 }}>{overview.absences.map((row) => <div key={row.member_id} style={absenceRow}><div><strong>{row.member_name}</strong><div style={muted}>마지막 출석 {row.last_attend_date}</div></div><span style={absenceBadge}>{row.absent_weeks}주 미출석</span></div>)}</div>}
      </section>
      <style>{`.attendance-spin{animation:attendance-spin .8s linear infinite}@keyframes attendance-spin{to{transform:rotate(360deg)}}`}</style>
    </main>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div style={cardStyle}><div style={{ display: "flex", gap: 8, color: "var(--ink-soft)", fontSize: 13 }}>{icon}{label}</div><strong style={{ display: "block", fontSize: 25, marginTop: 12 }}>{value}</strong></div>; }
function SourceBadge({ source }: { source: AttendanceRow["source"] }) { const label = source === "auto_geofence" ? "자동 감지" : source === "corrected" ? "수정" : "수동"; return <span style={source === "auto_geofence" ? autoBadge : manualBadge}>{label}</span>; }

const cardStyle: CSSProperties = { background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: 18, padding: 18, boxShadow: "0 2px 14px rgba(26,22,18,.04)" };
const buttonStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--hairline)", borderRadius: 10, padding: "9px 12px", background: "var(--card)", color: "var(--ink)", cursor: "pointer" };
const inputStyle: CSSProperties = { border: "1px solid var(--hairline)", borderRadius: 9, padding: "9px 10px", background: "var(--paper)", color: "var(--ink)" };
const errorStyle: CSSProperties = { margin: "16px 0", padding: 12, borderRadius: 10, background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)" };
const sectionTitle: CSSProperties = { margin: "0 0 14px", fontSize: 18, letterSpacing: "-0.03em" };
const muted: CSSProperties = { color: "var(--ink-soft)", fontSize: 13 };
const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 14 };
const thStyle: CSSProperties = { textAlign: "left", color: "var(--ink-soft)", fontWeight: 600, padding: "9px 8px", borderBottom: "1px solid var(--hairline)" };
const tdStyle: CSSProperties = { padding: "12px 8px", borderBottom: "1px solid var(--hairline)" };
const autoBadge: CSSProperties = { display: "inline-block", borderRadius: 999, padding: "4px 9px", background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)", fontSize: 12, fontWeight: 700 };
const manualBadge: CSSProperties = { ...autoBadge, background: "color-mix(in srgb, var(--ink-soft) 13%, transparent)", color: "var(--ink-mid)" };
const absenceRow: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--hairline)" };
const absenceBadge: CSSProperties = { whiteSpace: "nowrap", borderRadius: 999, padding: "5px 9px", background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)", fontSize: 12, fontWeight: 700 };
