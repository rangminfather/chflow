/* ============================================================
   예약 현황 표 — 시간대 계산

   DB(get_facility_range_bookings)가 준 예약들을
     · 날짜중심 : 하루 × 시설 × 24시간
     · 시설물중심 : 시설 × 그 달의 날짜들
   두 가지 표로 접기 위한 순수 함수 모음.

   화면은 PC 에서 24칸을 그대로, 모바일에서는 오전(0~11)·오후(12~23)로 나눠
   2시간 6칸씩 보여준다. 여기서는 칸 정의만 만들고 그리는 일은 컴포넌트가 한다.
   ============================================================ */

export type RangeBooking = {
  id: string;
  facility_id: string;
  facility_name: string;
  building_code: string | null;
  floor: number | null;
  date: string;
  time_start: string;
  time_end: string;
  status: string;
  purpose: string | null;
  headcount: number | null;
  contact: string | null;
  requester_name: string;
  is_mine: boolean;
  extras: string[] | null;
};

export const HOURS_IN_DAY = 24;

/** 모바일 묶음 — 오전/오후 각각 2시간 6칸 */
export type HalfDay = "am" | "pm";
export const BLOCK_HOURS = 2;

export function blocksOf(half: HalfDay): { from: number; to: number }[] {
  const base = half === "am" ? 0 : 12;
  return Array.from({ length: 12 / BLOCK_HOURS }, (_, i) => ({
    from: base + i * BLOCK_HOURS,
    to: base + i * BLOCK_HOURS + BLOCK_HOURS,
  }));
}

/** "14:30:00" / "14:30" → 14.5 */
export function toHourValue(time: string): number {
  const [h, m] = time.split(":");
  const hour = Number(h);
  const minute = Number(m ?? "0");
  if (!Number.isFinite(hour)) return 0;
  return hour + (Number.isFinite(minute) ? minute / 60 : 0);
}

/** 그 예약이 [from, to) 시간대와 겹치는지 */
export function overlapsHour(booking: RangeBooking, from: number, to: number): boolean {
  const start = toHourValue(booking.time_start);
  const end = toHourValue(booking.time_end);
  return start < to && from < end;
}

/** 하루치 예약을 시설별로 나눈다 */
export function byFacility(bookings: RangeBooking[]): Map<string, RangeBooking[]> {
  const map = new Map<string, RangeBooking[]>();
  for (const booking of bookings) {
    const list = map.get(booking.facility_id);
    if (list) list.push(booking);
    else map.set(booking.facility_id, [booking]);
  }
  return map;
}

/** 날짜(YYYY-MM-DD)별로 나눈다 */
export function byDate(bookings: RangeBooking[]): Map<string, RangeBooking[]> {
  const map = new Map<string, RangeBooking[]>();
  for (const booking of bookings) {
    const key = booking.date.slice(0, 10);
    const list = map.get(key);
    if (list) list.push(booking);
    else map.set(key, [booking]);
  }
  return map;
}

/** 그 시간대에 걸린 예약들 (여러 건이면 모두) */
export function bookingsAt(bookings: RangeBooking[], from: number, to: number): RangeBooking[] {
  return bookings.filter((booking) => overlapsHour(booking, from, to));
}

/** "14:30:00" → "14:30" */
export function shortTime(time: string): string {
  return time.slice(0, 5);
}

export function formatRange(booking: RangeBooking): string {
  return `${shortTime(booking.time_start)}~${shortTime(booking.time_end)}`;
}

// -------------------------------------------------------------
// 달 계산 — 월 단위로 넘겨보기
// -------------------------------------------------------------

/** 로컬 기준 YYYY-MM-DD */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type MonthCursor = { year: number; month: number }; // month: 1~12

export function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const zero = cursor.month - 1 + delta;
  const year = cursor.year + Math.floor(zero / 12);
  const month = ((zero % 12) + 12) % 12 + 1;
  return { year, month };
}

export function monthRange(cursor: MonthCursor): { from: string; to: string } {
  const first = new Date(cursor.year, cursor.month - 1, 1);
  const last = new Date(cursor.year, cursor.month, 0);
  return { from: toDateKey(first), to: toDateKey(last) };
}

/** 달력 격자 — 그 달 1일이 놓일 요일만큼 앞을 비운다 */
export function monthGrid(cursor: MonthCursor): (string | null)[] {
  const first = new Date(cursor.year, cursor.month - 1, 1);
  const daysInMonth = new Date(cursor.year, cursor.month, 0).getDate();
  const lead = first.getDay();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toDateKey(new Date(cursor.year, cursor.month - 1, day)));
  }
  return cells;
}

export function monthLabel(cursor: MonthCursor): string {
  return `${cursor.year}년 ${cursor.month}월`;
}
