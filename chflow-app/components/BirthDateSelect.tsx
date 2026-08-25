"use client";

import type { CSSProperties } from "react";
import YmdSelect, { joinYmd, splitYmd, type YmdParts } from "./YmdSelect";

const THIS_YEAR = new Date().getFullYear();

/**
 * 생년월일 선택 — 회원가입 화면과 동일한 연·월·일 드롭다운 (공용 YmdSelect 사용)
 *
 * - monthDayOptional=true: 연도만 골라도 저장 (월·일 미선택 = 01) — 교육부서 학생·새친구 등록 규칙
 * - monthDayOptional=false: 연·월·일 모두 선택해야 저장 — 요람 자녀 등록·편집
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
}) {
  return (
    <YmdSelect
      value={value}
      onChange={onChange}
      minYear={minYear}
      maxYear={maxYear}
      monthDayOptional={monthDayOptional}
      disabled={disabled}
      className={className}
      selectStyle={selectStyle}
      gridStyle={gridStyle}
      hint={hint}
      groupLabel="생년월일"
    />
  );
}

export const splitBirthDate = (value: string, monthDayOptional = false): YmdParts => splitYmd(value, monthDayOptional);
export const joinBirthDate = (parts: YmdParts, monthDayOptional = false) => joinYmd(parts, monthDayOptional);

/** 교육부서 학생·새친구 등록에서 고를 수 있는 가장 이른 출생연도 (기존 저장 검증과 동일: 2000년 이상) */
export const STUDENT_BIRTH_MIN_YEAR = 2000;
