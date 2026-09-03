import { describe, it, expect } from "vitest";
import {
  type RangeBooking,
  blocksOf,
  bookingsAt,
  byDate,
  byFacility,
  formatRange,
  monthGrid,
  monthLabel,
  monthRange,
  overlapsHour,
  shiftMonth,
  toDateKey,
  toHourValue,
} from "./facility-schedule";

function booking(patch: Partial<RangeBooking> = {}): RangeBooking {
  return {
    id: "b1",
    facility_id: "vision-3f-seminar",
    facility_name: "세미나실",
    building_code: "vision",
    floor: 3,
    date: "2026-09-10",
    time_start: "14:00:00",
    time_end: "16:00:00",
    status: "approved",
    purpose: "청년부 모임",
    headcount: 20,
    contact: "010-0000-0000",
    requester_name: "홍길동",
    is_mine: false,
    extras: [],
    ...patch,
  };
}

describe("시간 계산", () => {
  it("시:분을 소수 시간으로 읽는다", () => {
    expect(toHourValue("14:00:00")).toBe(14);
    expect(toHourValue("14:30")).toBe(14.5);
    expect(toHourValue("00:00:00")).toBe(0);
  });

  it("시간대 겹침 — 경계는 겹치지 않는다", () => {
    const b = booking({ time_start: "14:00", time_end: "16:00" });
    expect(overlapsHour(b, 14, 15)).toBe(true);
    expect(overlapsHour(b, 15, 16)).toBe(true);
    expect(overlapsHour(b, 13, 14)).toBe(false); // 끝이 시작과 맞닿음
    expect(overlapsHour(b, 16, 17)).toBe(false); // 시작이 끝과 맞닿음
    expect(overlapsHour(b, 12, 18)).toBe(true);
  });

  it("30분 단위 예약도 그 시간 칸에 걸린다", () => {
    const b = booking({ time_start: "14:30", time_end: "15:30" });
    expect(overlapsHour(b, 14, 15)).toBe(true);
    expect(overlapsHour(b, 15, 16)).toBe(true);
    expect(overlapsHour(b, 13, 14)).toBe(false);
  });

  it("모바일 2시간 묶음 — 오전·오후 각 6칸", () => {
    expect(blocksOf("am")).toEqual([
      { from: 0, to: 2 }, { from: 2, to: 4 }, { from: 4, to: 6 },
      { from: 6, to: 8 }, { from: 8, to: 10 }, { from: 10, to: 12 },
    ]);
    expect(blocksOf("pm")[0]).toEqual({ from: 12, to: 14 });
    expect(blocksOf("pm")[5]).toEqual({ from: 22, to: 24 });
  });

  it("표시 문구", () => {
    expect(formatRange(booking())).toBe("14:00~16:00");
  });
});

describe("묶기", () => {
  it("시설별로 나눈다", () => {
    const map = byFacility([
      booking({ id: "a", facility_id: "x" }),
      booking({ id: "b", facility_id: "y" }),
      booking({ id: "c", facility_id: "x" }),
    ]);
    expect(map.get("x")!.map((b) => b.id)).toEqual(["a", "c"]);
    expect(map.get("y")!.map((b) => b.id)).toEqual(["b"]);
  });

  it("날짜별로 나눈다 — 타임스탬프가 붙어 와도 날짜만 본다", () => {
    const map = byDate([
      booking({ id: "a", date: "2026-09-10" }),
      booking({ id: "b", date: "2026-09-10T00:00:00" }),
      booking({ id: "c", date: "2026-09-11" }),
    ]);
    expect(map.get("2026-09-10")!.map((b) => b.id)).toEqual(["a", "b"]);
    expect(map.get("2026-09-11")!.map((b) => b.id)).toEqual(["c"]);
  });

  it("그 칸에 걸린 예약만 고른다", () => {
    const list = [
      booking({ id: "a", time_start: "09:00", time_end: "11:00" }),
      booking({ id: "b", time_start: "14:00", time_end: "16:00" }),
    ];
    expect(bookingsAt(list, 14, 16).map((b) => b.id)).toEqual(["b"]);
    expect(bookingsAt(list, 12, 14).map((b) => b.id)).toEqual([]);
    expect(bookingsAt(list, 8, 12).map((b) => b.id)).toEqual(["a"]);
  });
});

describe("달 이동", () => {
  it("앞뒤로 넘긴다 — 해를 넘어가도 맞는다", () => {
    expect(shiftMonth({ year: 2026, month: 9 }, 1)).toEqual({ year: 2026, month: 10 });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 3 }, -14)).toEqual({ year: 2025, month: 1 });
  });

  it("그 달의 첫날·마지막날", () => {
    expect(monthRange({ year: 2026, month: 9 })).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthRange({ year: 2026, month: 2 })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // 윤년
    expect(monthRange({ year: 2028, month: 2 }).to).toBe("2028-02-29");
  });

  it("조회 범위가 62일을 넘지 않는다 (RPC 제한과 맞춤)", () => {
    for (let month = 1; month <= 12; month += 1) {
      const { from, to } = monthRange({ year: 2026, month });
      const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
      expect(days).toBeLessThanOrEqual(62);
    }
  });

  it("달력 격자 — 1일 앞을 요일만큼 비운다", () => {
    const cells = monthGrid({ year: 2026, month: 9 });
    const lead = cells.findIndex((c) => c !== null);
    expect(lead).toBe(new Date(2026, 8, 1).getDay());
    expect(cells.filter((c) => c !== null)).toHaveLength(30);
    expect(cells[cells.length - 1]).toBe("2026-09-30");
  });

  it("달 이름", () => {
    expect(monthLabel({ year: 2026, month: 9 })).toBe("2026년 9월");
  });

  it("날짜 키는 로컬 기준이라 UTC 로 밀리지 않는다", () => {
    expect(toDateKey(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(toDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
