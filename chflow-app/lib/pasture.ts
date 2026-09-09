// 목장 모임 조율 — 타입 · RPC 래퍼 · 표시 헬퍼
//
// 표시 기준(확정):
//  - 구성원 화면은 자녀를 포함하고 가정 단위로 묶는다 (목장은 가정 공동체)
//  - 인원·참석률·가능일 집계의 분모는 성인만 (DB RPC 쪽에서 이미 성인만 센다)
//  - 테스트·중복 의심 데이터는 삭제하지 않고 "정리 대상" 으로 표시만 한다

import { supabase } from "@/lib/supabase";
import { isPastureExplorePlaceholder, sortPastureExploreRows } from "@/lib/pasture-explore-utils";

export { isPastureExplorePlaceholder, sortPastureExploreRows } from "@/lib/pasture-explore-utils";

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

export type PastureExploreRow = {
  pasture_id: string;
  pasture_name: string;
  mission_area: string | null;
  grassland_name: string | null;
  plain_name: string | null;
  pasture_order: number;
  grassland_order: number;
  plain_order: number;
  leaders: PastureLeader[];
};

export type PastureLeaderRole = "목자" | "목녀" | "목부";

export type PastureLeader = {
  member_id: string;
  name: string;
  role: PastureLeaderRole;
  photo_url: string | null;
  gender: string | null;
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

type PastureDirectoryRecord = {
  id: string;
  name: string;
  order_no: number | null;
  mission_area: string | null;
  grassland: {
    name: string;
    order_no: number | null;
    plain: { name: string; display_name: string | null; order_no: number | null } | null;
  } | null;
};

type PastureLeaderRecord = {
  id: string;
  name: string;
  family_church: string | null;
  photo_url: string | null;
  gender: string | null;
  household: { pasture_id: string } | Array<{ pasture_id: string }> | null;
};

const PASTURE_EXPLORE_SELECT = `
  id,
  name,
  order_no,
  mission_area,
  grassland:grasslands(name,order_no,plain:plains(name,display_name,order_no))
`;

const LEADER_ROLES = ["목자", "목녀", "목부"] as const;
const LEADER_ROLE_ORDER: Record<PastureLeaderRole, number> = { 목자: 0, 목녀: 1, 목부: 2 };

function toPastureExploreRow(row: PastureDirectoryRecord): PastureExploreRow {
  const plain = row.grassland?.plain;
  return {
    pasture_id: row.id,
    pasture_name: row.name,
    mission_area: row.mission_area || null,
    grassland_name: row.grassland?.name || null,
    plain_name: plain?.display_name || (plain?.name ? `${plain.name}평원` : null),
    pasture_order: row.order_no ?? Number.MAX_SAFE_INTEGER,
    grassland_order: row.grassland?.order_no ?? Number.MAX_SAFE_INTEGER,
    plain_order: plain?.order_no ?? Number.MAX_SAFE_INTEGER,
    leaders: [],
  };
}

function isPastureLeaderRole(role: string | null): role is PastureLeaderRole {
  return LEADER_ROLES.includes(role as PastureLeaderRole);
}

function leaderPastureId(row: PastureLeaderRecord): string | null {
  if (Array.isArray(row.household)) return row.household[0]?.pasture_id || null;
  return row.household?.pasture_id || null;
}

async function fetchPastureLeaders(pastureIds: string[]): Promise<Map<string, PastureLeader[]>> {
  const byPasture = new Map<string, PastureLeader[]>();
  if (pastureIds.length === 0) return byPasture;

  const { data, error } = await supabase
    .from("members")
    .select("id,name,family_church,photo_url,gender,household:households!inner(pasture_id)")
    .eq("is_child", false)
    .in("family_church", [...LEADER_ROLES])
    .in("household.pasture_id", pastureIds);
  if (error) throw error;

  for (const row of (data ?? []) as unknown as PastureLeaderRecord[]) {
    const pastureId = leaderPastureId(row);
    if (!pastureId || !isPastureLeaderRole(row.family_church)) continue;
    const leaders = byPasture.get(pastureId) || [];
    leaders.push({
      member_id: row.id,
      name: row.name,
      role: row.family_church,
      photo_url: row.photo_url || null,
      gender: row.gender || null,
    });
    byPasture.set(pastureId, leaders);
  }

  for (const leaders of byPasture.values()) {
    leaders.sort((a, b) => LEADER_ROLE_ORDER[a.role] - LEADER_ROLE_ORDER[b.role] || a.name.localeCompare(b.name, "ko-KR"));
  }
  return byPasture;
}

/** 목장탐방 목록. 소개 화면에서 필요한 공개 목장 정보만 가져온다. */
export async function fetchPastureDirectory(): Promise<PastureExploreRow[]> {
  const { data, error } = await supabase
    .from("directory_pastures")
    .select(PASTURE_EXPLORE_SELECT)
    .order("name");
  if (error) throw error;
  const rows = ((data ?? []) as unknown as PastureDirectoryRecord[])
    .map(toPastureExploreRow)
    .filter((row) => !isPastureExplorePlaceholder(row));
  const leaders = await fetchPastureLeaders(rows.map((row) => row.pasture_id));
  return sortPastureExploreRows(rows.map((row) => ({ ...row, leaders: leaders.get(row.pasture_id) || [] })));
}

/** 목장탐방 상세. 이후 목장모임 요약도 이 결과 모델에 합쳐서 재사용한다. */
export async function fetchPastureIntroduction(pastureId: string): Promise<PastureExploreRow | null> {
  const { data, error } = await supabase
    .from("directory_pastures")
    .select(PASTURE_EXPLORE_SELECT)
    .eq("id", pastureId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = toPastureExploreRow(data as unknown as PastureDirectoryRecord);
  if (isPastureExplorePlaceholder(row)) return null;
  const leaders = await fetchPastureLeaders([row.pasture_id]);
  return { ...row, leaders: leaders.get(row.pasture_id) || [] };
}

export function pastureSearchText(row: PastureExploreRow): string {
  return [row.pasture_name, row.grassland_name, row.plain_name, row.mission_area, ...row.leaders.flatMap((leader) => [leader.name, leader.role])]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ko-KR");
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
