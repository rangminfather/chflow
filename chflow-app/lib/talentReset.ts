// 달란트 반기 리셋 (달란트 잔치 정산) 공용 헬퍼
// 리셋 = edu_talent_resets에 리셋일 기록. 잔액·통계는 마지막 리셋일 "다음날부터" 적립분만 합산.
// 기록 자체는 삭제하지 않으므로 마지막 리셋 행을 지우면 그대로 되돌아간다.

import { supabase } from "@/lib/supabase";

export interface TalentReset {
  id: string;
  reset_date: string; // YYYY-MM-DD
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

/** 오늘 날짜로 부서 전체 리셋 기록 */
export async function insertTalentReset(deptId: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("edu_talent_resets").insert({
    department_id: deptId,
    reset_date: todayKey(),
    created_by: user?.id ?? null,
  });
  return error ? error.message : null;
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

export function todayKey(): string {
  return dateToKey(new Date());
}

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
