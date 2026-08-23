"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

const THIS_YEAR = new Date().getFullYear();

type Parts = { year: string; month: string; day: string };

/**
 * 생년월일 선택 — 연 / 월 / 일 드롭다운 3분할 (회원가입 화면과 동일한 방식)
 *
 * - value / onChange 는 'YYYY-MM-DD' 문자열 (미입력은 '')
 * - monthDayOptional=true 면 연도만 골라도 유효 (월·일 미선택 = 01 로 저장),
 *   교육부서 학생·새친구 등록의 기존 저장 규칙을 그대로 유지하기 위한 옵션
 * - 부모가 value 를 바꾸면(학년 선택 → 출생연도 자동 등) 그대로 반영된다
 */
export default function BirthDateSelect({
  value,
  onChange,
  minYear = 1900,
  maxYear = THIS_YEAR,
  monthDayOptional = false,
  disabled = false,
  className,
  selectStyle,
  gridStyle,
  hint,
  groupLabel = "생년월일",
}: {
  value: string;
  onChange: (value: string) => void;
  minYear?: number;
  maxYear?: number;
  monthDayOptional?: boolean;
  disabled?: boolean;
  className?: string;
  selectStyle?: CSSProperties;
  gridStyle?: CSSProperties;
  hint?: string;
  groupLabel?: string;
}) {
  const [parts, setParts] = useState<Parts>(() => splitBirthDate(value, monthDayOptional));
  // 내가 올려보낸 값이 되돌아온 경우는 무시한다 —
  // (예: 1월 선택 → 'YYYY-01-01' 저장 → 다시 쪼개면 월이 빈칸이 되어 선택이 지워짐)
  const emitted = useRef<string | null>(null);

  useEffect(() => {
    if (emitted.current === value) return;
    emitted.current = null;
    setParts(splitBirthDate(value, monthDayOptional));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let year = maxYear; year >= minYear; year -= 1) years.push(year);
    // 목록 범위를 벗어난 기존 값도 그대로 보이도록 포함
    const current = Number(parts.year);
    if (parts.year && Number.isFinite(current) && !years.includes(current)) {
      years.push(current);
      years.sort((a, b) => b - a);
    }
    return years.map(String);
  }, [minYear, maxYear, parts.year]);

  const maxDay = parts.year && parts.month
    ? new Date(Number(parts.year), Number(parts.month), 0).getDate()
    : 31;

  const updatePart = (part: keyof Parts, nextValue: string) => {
    const next: Parts = { ...parts, [part]: nextValue };
    if (!next.year) {
      next.month = "";
      next.day = "";
    }
    const nextMaxDay = next.year && next.month
      ? new Date(Number(next.year), Number(next.month), 0).getDate()
      : 31;
    if (Number(next.day) > nextMaxDay) next.day = String(nextMaxDay);
    setParts(next);
    const emittedValue = joinBirthDate(next, monthDayOptional);
    emitted.current = emittedValue;
    onChange(emittedValue);
  };

  const style: CSSProperties | undefined = selectStyle
    ? { ...selectStyle, minWidth: 0, cursor: disabled ? "default" : "pointer", appearance: "auto" }
    : undefined;

  return (
    <div>
      <div
        role="group"
        aria-label={groupLabel}
        style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr 1fr", gap: 8, ...gridStyle }}
      >
        <select
          aria-label="출생 연도"
          value={parts.year}
          disabled={disabled}
          onChange={(event) => updatePart("year", event.target.value)}
          className={className}
          style={style}
        >
          <option value="">연도</option>
          {yearOptions.map((year) => <option key={year} value={year}>{year}년</option>)}
        </select>
        <select
          aria-label="출생 월"
          value={parts.month}
          disabled={disabled || !parts.year}
          onChange={(event) => updatePart("month", event.target.value)}
          className={className}
          style={style}
        >
          <option value="">월</option>
          {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((month) => (
            <option key={month} value={month}>{month}월</option>
          ))}
        </select>
        <select
          aria-label="출생 일"
          value={parts.day}
          disabled={disabled || !parts.year || !parts.month}
          onChange={(event) => updatePart("day", event.target.value)}
          className={className}
          style={style}
        >
          <option value="">일</option>
          {Array.from({ length: maxDay }, (_, index) => String(index + 1)).map((day) => (
            <option key={day} value={day}>{day}일</option>
          ))}
        </select>
      </div>
      {hint && (
        <div style={{ marginTop: 6, color: "var(--ink-soft)", fontSize: 11, fontWeight: 600, lineHeight: 1.45 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/** 'YYYY-MM-DD' → 연·월·일 조각. monthDayOptional 이면 01-01(연도만 등록)은 월·일을 비워서 보여준다 */
export function splitBirthDate(value: string, monthDayOptional = false): Parts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return { year: "", month: "", day: "" };
  if (monthDayOptional && match[2] === "01" && match[3] === "01") {
    return { year: match[1], month: "", day: "" };
  }
  return { year: match[1], month: String(Number(match[2])), day: String(Number(match[3])) };
}

/** 연·월·일 조각 → 'YYYY-MM-DD'. monthDayOptional 이면 월·일 미선택은 01 로 채운다 */
export function joinBirthDate(parts: Parts, monthDayOptional = false) {
  if (!/^\d{4}$/.test(parts.year)) return "";
  if (!monthDayOptional && (!parts.month || !parts.day)) return "";
  const month = String(Math.min(12, Math.max(1, Number(parts.month) || 1))).padStart(2, "0");
  const day = String(Math.min(31, Math.max(1, Number(parts.day) || 1))).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

/** 교육부서 학생·새친구 등록에서 고를 수 있는 가장 이른 출생연도 (기존 저장 검증과 동일: 2000년 이상) */
export const STUDENT_BIRTH_MIN_YEAR = 2000;
