"use client";

import { useState } from "react";
import { BookOpen, ChevronDown, Info, CalendarClock } from "lucide-react";

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

// 한 달치 화면: 주일 카드(주요 내용) → 그 달 행사·안내 → 공통 안내(접기)
export function PlanMonthView({ year, month, common, weeks, notes }: {
  year: number;
  month: number;
  common: string[];
  weeks: PlanWeek[];
  notes: string[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {weeks.length === 0 ? (
        <div style={{ padding: "28px 0", textAlign: "center", color: "var(--ink-faint)", fontSize: 13, fontWeight: 600 }}>
          {month}월 주일 일정이 없습니다.
        </div>
      ) : (
        weeks.map((w) => <WeekCard key={`${year}-${w.date}`} week={w} />)
      )}
      {notes.length > 0 && <MonthNotes month={month} notes={notes} />}
      {common.length > 0 && <CommonNotes common={common} />}
    </div>
  );
}

function WeekCard({ week }: { week: PlanWeek }) {
  return (
    <div style={{ position: "relative", border: "1px solid var(--hairline)", borderLeft: "3px solid var(--accent)", borderRadius: 14, background: "var(--card)", padding: "13px 16px", boxShadow: "0 1px 4px color-mix(in srgb, var(--ink) 5%, transparent)" }}>
      {/* 날짜 (보조 마커) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--accent-strong)", letterSpacing: "0.01em" }}>
          {week.date} <span style={{ color: "var(--ink-faint)", fontWeight: 700 }}>주일</span>
        </span>
        {week.verse && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: "var(--accent)", background: "var(--accent-soft)", padding: "2px 8px", borderRadius: 99 }}>
            <BookOpen size={11} strokeWidth={2.2} /> {week.verse}
          </span>
        )}
      </div>

      {/* 설교제목 — 주요 내용(히어로) */}
      {week.title && (
        <div style={{ marginTop: 5, fontSize: 17, fontWeight: 800, color: "var(--ink)", lineHeight: 1.35, letterSpacing: "-0.01em" }}>
          {week.title}
        </div>
      )}
      {week.scripture && (
        <div style={{ marginTop: 3, fontSize: 12.5, fontWeight: 600, color: "var(--ink-soft)" }}>{week.scripture}</div>
      )}

      {/* 2부 특별활동 — 한 일정의 핵심 활동 */}
      {week.event && (
        <div style={{ marginTop: 9, fontSize: 13.5, fontWeight: 700, color: "var(--ink-mid)" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent)", background: "var(--accent-soft)", padding: "2px 7px", borderRadius: 6, marginRight: 6 }}>2부</span>
          {week.event}
        </div>
      )}

      {/* 역할 분담 — 보조 정보 */}
      {week.roles.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px dashed var(--hairline)", display: "flex", flexWrap: "wrap", gap: "4px 5px" }}>
          {week.roles.map((r) => (
            <span key={r.label} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", background: "var(--bg-soft)", padding: "2px 8px", borderRadius: 7 }}>
              <span style={{ color: "var(--ink-faint)", fontWeight: 700 }}>{r.label}</span> {r.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MonthNotes({ month, notes }: { month: number; notes: string[] }) {
  return (
    <div style={{ border: "1px solid var(--hairline)", borderRadius: 12, background: "var(--bg-soft)", padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <CalendarClock size={14} strokeWidth={2} color="var(--ink-soft)" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-mid)" }}>{month}월 행사·안내</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {notes.map((l, i) => (
          <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-soft)", paddingLeft: 10, position: "relative" }}>
            <span style={{ position: "absolute", left: 0, color: "var(--ink-faint)" }}>·</span>
            {stripBullet(l)}
          </div>
        ))}
      </div>
    </div>
  );
}

function CommonNotes({ common }: { common: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: "1px solid var(--hairline)", borderRadius: 12, background: "var(--bg-soft)", overflow: "hidden" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "10px 14px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
      >
        <Info size={14} strokeWidth={2} color="var(--ink-soft)" />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--ink-mid)" }}>이 학기 공통 안내</span>
        <ChevronDown size={16} strokeWidth={2.2} color="var(--ink-faint)" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          {common.map((l, i) => (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-soft)" }}>{stripBullet(l)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function stripBullet(line: string) {
  return line.replace(/^[*·•]\s*/, "").trim();
}
