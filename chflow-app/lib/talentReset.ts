// 달란트 반기 리셋 (달란트 잔치 정산) 공용 헬퍼
// 리셋 = edu_talent_resets에 "정산한 반기의 말일"(6/30 또는 12/31)을 기록.
// 잔액은 마지막 리셋일 다음날부터 적립분만 합산 → 리셋을 몇 주 늦게 눌러도
// 다음 반기에 이미 체크된 달란트는 그대로 보존된다.
// 기록 자체는 삭제하지 않으므로 마지막 리셋 행을 지우면 그대로 되돌아간다.
// 기록/취소 권한은 임원(grade 0~2)만 (RLS 강제).

import { supabase } from "@/lib/supabase";

export interface TalentReset {
  id: string;
  reset_date: string; // YYYY-MM-DD (반기 말일)
}

export interface HalfOption {
  label: string;    // 예: "2026년 상반기 (1~6월)"
  endDate: string;  // 반기 말일 = 리셋 기록일
}

/** 부서 리셋 이력 (최신순) */
export async function fetchTalentResets(deptId: string): Promise<TalentReset[]> {
  const { data } = await supabase
    .from("edu_talent_resets")
    .select("id, reset_date")
    .eq("department_id", deptId)
    .order("reset_date", { ascending: false })
    .order("created_at", { ascending: false });
  return (data || []) as TalentReset[];
}

/** 부서 전체 리셋 기록 — resetDate = 정산한 반기의 말일 (6/30 · 12/31) */
export async function insertTalentReset(deptId: string, resetDate: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("edu_talent_resets").insert({
    department_id: deptId,
    reset_date: resetDate,
    created_by: user?.id ?? null,
  });
  return error ? error.message : null;
}

/**
 * 리셋 후보 반기 = 이미 끝난 최근 두 반기 (진행 중인 반기는 정산 대상 아님).
 * 예) 2026년 7~12월에 누르면: [2026 상반기, 2025 하반기]
 *     2027년 1~6월에 누르면: [2026 하반기, 2026 상반기]
 */
export function recentEndedHalves(): HalfOption[] {
  const now = new Date();
  const y = now.getFullYear();
  const firstHalf = (year: number): HalfOption =>
    ({ label: `${year}년 상반기 (1~6월)`, endDate: `${year}-06-30` });
  const secondHalf = (year: number): HalfOption =>
    ({ label: `${year}년 하반기 (7~12월)`, endDate: `${year}-12-31` });
  return now.getMonth() + 1 <= 6
    ? [secondHalf(y - 1), firstHalf(y - 1)]
    : [firstHalf(y), secondHalf(y - 1)];
}

/** 리셋 취소 (해당 리셋 행 삭제 → 이전 상태로 복원) */
export async function deleteTalentReset(resetId: string): Promise<string | null> {
  const { error } = await supabase.from("edu_talent_resets").delete().eq("id", resetId);
  return error ? error.message : null;
}

/** 리셋일 다음날 = 새 반기 시작일. 리셋 이력 없으면 전체 기간 시작. */
export function periodStartAfter(reset: TalentReset | undefined): string {
  if (!reset) return "2000-01-01";
  return addDaysKey(reset.reset_date, 1);
}

export const PERIOD_END_MAX = "2100-12-31";

export function addDaysKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return dateToKey(date);
}

export function formatResetDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return `${y}.${m}.${d}`;
}

function dateToKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
