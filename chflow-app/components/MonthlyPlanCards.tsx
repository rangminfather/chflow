"use client";

import { useState } from "react";
import { BookOpen, ChevronDown, Info, Users } from "lucide-react";

// render route(format=cards)가 돌려주는 구조와 동일
export interface PlanWeek {
  date: string;
  month: number;
  day: number;
  title: string;
  scripture: string;
  verse: string;
  roles: Array<{ label: string; name: string }>;
  prep: string;
  event: string;
}
export interface MonthBucket {
  month: number;
  weeks: PlanWeek[];
  notes: string[];
}
export interface CardsData {
  year: number;
  common: string[];
  months: MonthBucket[];
}

// 한 달치 화면: 공통 안내(접기) + 그 달 안내 + 주일 카드들
export function PlanMonthView({ year, month, common, weeks, notes }: {
  year: number;
  month: number;
  common: string[];
  weeks: PlanWeek[];
  notes: string[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {common.length > 0 && <CommonNotes common={common} />}
      {notes.length > 0 && <MonthNotes month={month} notes={notes} />}
      {weeks.length === 0 ? (
        <div style={{ padding: "28px 0", textAlign: "center", color: "var(--ink-faint)", fontSize: 13, fontWeight: 600 }}>
          {month}월 주일 일정이 없습니다.
        </div>
      ) : (
        weeks.map((w) => <WeekCard key={`${year}-${w.date}`} week={w} />)
      )}
    </div>
  );
}

function WeekCard({ week }: { week: PlanWeek }) {
  return (
    <div style={{ border: "1px solid var(--hairline)", borderRadius: 14, background: "var(--card)", padding: "14px 16px", boxShadow: "0 1px 4px color-mix(in srgb, var(--ink) 5%, transparent)" }}>
      {/* 날짜 + 요절 */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>{week.date} <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)" }}>주일</span></span>
        {week.verse && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--accent)", background: "var(--accent-soft)", padding: "3px 9px", borderRadius: 99 }}>
            <BookOpen size={12} strokeWidth={2.2} /> 요절 {week.verse}
          </span>
        )}
      </div>

      {/* 설교제목 + 본문 */}
      {week.title && <div style={{ marginTop: 8, fontSize: 15, fontWeight: 700, color: "var(--ink)", lineHeight: 1.4 }}>{week.title}</div>}
      {week.scripture && <div style={{ marginTop: 2, fontSize: 13, fontWeight: 600, color: "var(--ink-soft)" }}>({week.scripture})</div>}

      {/* 역할 분담 */}
      {week.roles.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "5px 6px" }}>
          {week.roles.map((r) => (
            <span key={r.label} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color: "var(--ink-mid)", background: "var(--bg-soft)", padding: "3px 9px", borderRadius: 8 }}>
              <span style={{ color: "var(--ink-faint)", fontWeight: 700 }}>{r.label}</span> {r.name}
            </span>
          ))}
        </div>
      )}

      {/* 2부 특별활동 */}
      {week.event && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--hairline)", fontSize: 13, fontWeight: 600, color: "var(--ink-mid)" }}>
          <span style={{ fontWeight: 700, color: "var(--ink-faint)" }}>2부</span> · {week.event}
        </div>
      )}
    </div>
  );
}

function CommonNotes({ common }: { common: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: "1px solid var(--accent-line)", borderRadius: 12, background: "var(--accent-soft)", overflow: "hidden" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "11px 14px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
      >
        <Info size={15} strokeWidth={2} color="var(--accent)" />
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--accent-strong)" }}>이 학기 공통 안내</span>
        <ChevronDown size={16} strokeWidth={2.2} color="var(--accent)" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          {common.map((l, i) => (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-mid)" }}>{stripBullet(l)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function MonthNotes({ month, notes }: { month: number; notes: string[] }) {
  return (
    <div style={{ border: "1px solid var(--hairline)", borderRadius: 12, background: "var(--card)", padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <Users size={14} strokeWidth={2} color="var(--ink-soft)" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{month}월 행사·안내</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {notes.map((l, i) => (
          <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-mid)", paddingLeft: 10, position: "relative" }}>
            <span style={{ position: "absolute", left: 0, color: "var(--ink-faint)" }}>·</span>
            {stripBullet(l)}
          </div>
        ))}
      </div>
    </div>
  );
}

function stripBullet(line: string) {
  return line.replace(/^[*·•]\s*/, "").trim();
}
