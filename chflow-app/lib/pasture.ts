// 목장 모임 조율 — 타입 · RPC 래퍼 · 표시 헬퍼
//
// 표시 기준(확정):
//  - 구성원 화면은 자녀를 포함하고 가정 단위로 묶는다 (목장은 가정 공동체)
//  - 인원·참석률·가능일 집계의 분모는 성인만 (DB RPC 쪽에서 이미 성인만 센다)
//  - 테스트·중복 의심 데이터는 삭제하지 않고 "정리 대상" 으로 표시만 한다

import { supabase } from "@/lib/supabase";

export type AvailabilityStatus = "ok" | "hard" | "maybe";
export type RsvpResponse = "attend" | "undecided" | "absent";
export type ScheduleKind = "regular" | "meal" | "outdoor" | "service" | "family_event" | "etc";

export const SCHEDULE_KIND_LABEL: Record<ScheduleKind, string> = {
  regular: "정기 목장모임",
  meal: "식사",
  outdoor: "야외모임",
  service: "봉사",
  family_event: "경조사",
  etc: "기타",
};

export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  ok: "가능",
  hard: "어려움",
  maybe: "미정",
};

export const RSVP_LABEL: Record<RsvpResponse, string> = {
  attend: "참석",
  undecided: "미정",
  absent: "불참",
};

export type PastureHome = {
  pasture_id: string | null;
  pasture_name: string | null;
  is_leader: boolean;
  member_total: number;
  next_schedule_id: string | null;
  next_title: string | null;
  next_meets_on: string | null;
  next_start_time: string | null;
  next_location: string | null;
  next_meal: boolean | null;
  next_family: boolean | null;
  my_response: RsvpResponse | null;
  cnt_attend: number;
  cnt_undecided: number;
  cnt_absent: number;
  cnt_pending: number;
  my_availability_count: number;
};

export type PastureMemberRow = {
  member_id: string;
  name: string;
  family_church: string | null;
  sub_role: string | null;
  is_child: boolean;
  gender: string | null;
  birth_date: string | null;
  household_id: string;
  household_no: number | null;
  relationship: string | null;
  has_app: boolean;
  is_me: boolean;
  dup_in_household: boolean;
  photo_url: string | null;
};

export type CalendarRow = {
  source: "pasture" | "church" | "availability";
  ref_id: string;
  on_date: string;
  title: string;
  kind: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  status: string | null;
  family_allowed: boolean | null;
  meal_provided: boolean | null;
};

export type AvailabilitySummaryRow = {
  on_date: string;
  ok_count: number;
  hard_count: number;
  maybe_count: number;
  responded: number;
  roster_total: number;
  is_recommended: boolean;
};

export type ScheduleDetailRow = {
  schedule_id: string;
  pasture_id: string;
  title: string;
  kind: ScheduleKind;
  meets_on: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  description: string | null;
  prep_notes: string | null;
  family_allowed: boolean;
  meal_provided: boolean;
  status: string;
  is_leader: boolean;
  my_response: RsvpResponse | null;
  member_id: string;
  member_name: string | null;
  response: RsvpResponse | "pending";
};

/** 한 가정 = 성인 목록 + 자녀 목록. 화면은 이 단위로 카드를 그린다. */
export type Household = {
  household_id: string;
  household_no: number | null;
  adults: PastureMemberRow[];
  children: PastureMemberRow[];
  hasLeader: boolean;
};

// ── RPC ──────────────────────────────────────────────

export async function fetchPastureHome(): Promise<PastureHome | null> {
  const { data, error } = await supabase.rpc("pasture_home");
  if (error) throw error;
  return (data?.[0] as PastureHome) ?? null;
}

export async function fetchPastureMembers(): Promise<PastureMemberRow[]> {
  const { data, error } = await supabase.rpc("pasture_list_members");
  if (error) throw error;
  return (data ?? []) as PastureMemberRow[];
}

export async function fetchCalendar(from: string, to: string): Promise<CalendarRow[]> {
  const { data, error } = await supabase.rpc("pasture_calendar", { p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []) as CalendarRow[];
}

export async function fetchAvailabilitySummary(from: string, to: string): Promise<AvailabilitySummaryRow[]> {
  const { data, error } = await supabase.rpc("pasture_availability_summary", { p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []) as AvailabilitySummaryRow[];
}

export async function setAvailability(onDate: string, status: AvailabilityStatus | null): Promise<void> {
  const { error } = await supabase.rpc("pasture_set_availability", { p_on_date: onDate, p_status: status });
  if (error) throw error;
}

export async function fetchScheduleDetail(scheduleId: string): Promise<ScheduleDetailRow[]> {
  const { data, error } = await supabase.rpc("pasture_schedule_detail", { p_schedule_id: scheduleId });
  if (error) throw error;
  return (data ?? []) as ScheduleDetailRow[];
}

export async function setRsvp(scheduleId: string, response: RsvpResponse): Promise<void> {
  const { error } = await supabase.rpc("pasture_set_rsvp", { p_schedule_id: scheduleId, p_response: response });
  if (error) throw error;
}

export async function confirmMeeting(input: {
  meetsOn: string;
  title: string;
  startTime?: string | null;
  location?: string | null;
  kind?: ScheduleKind;
  mealProvided?: boolean;
  familyAllowed?: boolean;
  decidedFromMonth?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("pasture_upsert_schedule", {
    p_id: null,
    p_title: input.title,
    p_meets_on: input.meetsOn,
    p_kind: input.kind ?? "regular",
    p_start_time: input.startTime || null,
    p_location: input.location || null,
    p_meal_provided: input.mealProvided ?? false,
    p_family_allowed: input.familyAllowed ?? true,
    p_status: "confirmed",
    p_decided_from_month: input.decidedFromMonth ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function notifyPending(kind: "availability" | "rsvp", scheduleId?: string): Promise<number> {
  const { data, error } = await supabase.rpc("pasture_notify_pending", {
    p_kind: kind,
    p_schedule_id: scheduleId ?? null,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

// ── 표시 헬퍼 ─────────────────────────────────────────

/** 세는나이 — 프로젝트의 교육부서 나이 규칙과 같다 (올해 - 출생연도 + 1) */
export function koreanAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const year = Number(birthDate.slice(0, 4));
  if (!Number.isFinite(year) || year < 1900) return null;
  return new Date().getFullYear() - year + 1;
}

/**
 * 정리 대상 표시 — 임의 삭제하지 않고 화면에서만 알린다.
 *  test: 심사·테스트 목적으로 만든 계정이 실제 목장에 섞여 있는 경우
 *  dup:  같은 가정에 같은 이름이 둘 이상 (실제 동명이인일 수도 있어 병합하지 않는다)
 */
const TEST_NAME_HINTS = ["심사용", "테스트", "smoke", "클로드"];
export function reviewFlag(row: PastureMemberRow): "test" | "dup" | null {
  const name = (row.name || "").toLowerCase();
  if (TEST_NAME_HINTS.some((h) => name.includes(h.toLowerCase()))) return "test";
  if ((row.family_church || "").toLowerCase() === "smoke") return "test";
  if (row.dup_in_household) return "dup";
  return null;
}

/** 가정 단위로 묶는다. RPC 가 이미 목자 가정 → 가정번호 → 성인 먼저 순으로 정렬해 보낸다. */
export function groupByHousehold(rows: PastureMemberRow[]): Household[] {
  const order: string[] = [];
  const map = new Map<string, Household>();
  for (const r of rows) {
    let h = map.get(r.household_id);
    if (!h) {
      h = { household_id: r.household_id, household_no: r.household_no, adults: [], children: [], hasLeader: false };
      map.set(r.household_id, h);
      order.push(r.household_id);
    }
    if (r.is_child) h.children.push(r);
    else h.adults.push(r);
    if (r.family_church === "목자" || r.family_church === "목녀") h.hasLeader = true;
  }
  return order.map((id) => map.get(id)!);
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthRange(base: Date): { from: string; to: string; monthStart: string } {
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { from: ymd(first), to: ymd(last), monthStart: ymd(first) };
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

export function formatMeetingDate(onDate: string | null): string {
  if (!onDate) return "";
  const [y, m, d] = onDate.split("-").map(Number);
  const wd = WEEKDAY[new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일(${wd})`;
}

export function formatTime(time: string | null): string {
  if (!time) return "";
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mStr && mStr !== "00" ? `${ampm} ${h12}:${mStr}` : `${ampm} ${h12}시`;
}
