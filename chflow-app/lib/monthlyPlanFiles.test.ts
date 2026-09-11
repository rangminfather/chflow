import { describe, expect, it } from "vitest";
import { monthlyPlanMonthToken, parseMonthlyPlanName } from "./monthlyPlanFiles";

describe("월간교육계획 파일명", () => {
  it("기존 단일 월 파일명을 이전과 동일하게 읽는다", () => {
    expect(parseMonthlyPlanName("2026-09_123_monthly-plan.xlsx")).toMatchObject({
      year: 2026,
      month: 9,
      months: [9],
      multiMonth: false,
    });
  });

  it("새 복수 월 파일명을 모든 선택 월로 읽는다", () => {
    const parsed = parseMonthlyPlanName("2026-09+10_123_monthly-plan.xlsx");
    expect(parsed.months).toEqual([9, 10]);
    expect(parsed.multiMonth).toBe(true);
    expect(parsed.originalName).toContain("9월·10월");
  });

  it("선택 월을 파일명 토큰으로 만든다", () => {
    expect(monthlyPlanMonthToken([9, 10])).toBe("09+10");
  });
});
