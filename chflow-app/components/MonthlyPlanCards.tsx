"use client";

import { useState } from "react";
import {
  BookOpen, ChevronDown, Info, CalendarClock,
  Mic, Speech, HandHeart, Music, Music2, Megaphone, Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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

const ROLE_ICON: Record<string, LucideIcon> = {
  사회: Mic,
  설교: Speech,
  기도: HandHeart,
  주제찬양: Music,
  안내: Megaphone,
  율동: Music2,
};

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
    <div
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: 16,
        background: "var(--card)",
        overflow: "hidden",
        boxShadow: "0 1px 2px color-mix(in srgb, var(--ink) 4%, transparent), 0 6px 18px color-mix(in srgb, var(--ink) 5%, transparent)",
      }}
    >
      <div style={{ padding: "15px 16px 14px" }}>
        {/* 날짜 + 요절 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, color: "var(--accent-strong)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--accent)" }} />
            {week.date} <span style={{ color: "var(--ink-faint)", fontWeight: 700 }}>주일</span>
          </span>
          {week.verse && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: "var(--accent)", background: "var(--accent-soft)", padding: "3px 9px", borderRadius: 99 }}>
              <BookOpen size={11} strokeWidth={2.2} /> {week.verse}
            </span>
          )}
        </div>

        {/* 설교제목 — 히어로 */}
        {week.title && (
          <div style={{ marginTop: 8, fontSize: 17, fontWeight: 800, color: "var(--ink)", lineHeight: 1.36, letterSpacing: "-0.01em" }}>
            {week.title}
          </div>
        )}
        {week.scripture && (
          <div style={{ marginTop: 3, fontSize: 12.5, fontWeight: 600, color: "var(--ink-soft)" }}>{week.scripture}</div>
        )}

        {/* 2부 특별활동 */}
        {week.event && (
          <div style={{ marginTop: 11, display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 700, color: "var(--ink-mid)" }}>
            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: "var(--accent)", background: "var(--accent-soft)", padding: "2px 7px", borderRadius: 6 }}>2부</span>
            {week.event}
          </div>
        )}
      </div>

      {/* 역할 분담 — 아이콘 칩 (하단 밴드) */}
      {week.roles.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "7px 8px", padding: "11px 16px", borderTop: "1px solid var(--hairline)", background: "color-mix(in srgb, var(--accent) 4%, var(--card))" }}>
          {week.roles.map((r) => {
            const Icon = ROLE_ICON[r.label] ?? Users;
            return (
              <span key={r.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--ink-mid)" }}>
                <Icon size={13} strokeWidth={2} color="var(--accent)" />
                <span style={{ color: "var(--ink-faint)", fontWeight: 700 }}>{r.label}</span>
                <span style={{ color: "var(--ink)" }}>{r.name}</span>
              </span>
            );
          })}
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
