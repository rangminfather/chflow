import { describe, expect, it } from "vitest";
import { resolveMonthlyPlanDate } from "./monthlyPlanDate";

describe("resolveMonthlyPlanDate", () => {
  it("정확한 날짜를 가장 먼저 사용한다", () => {
    expect(resolveMonthlyPlanDate("2026-08-30", ["2026-08-29", "2026-08-30", "2026-08-31"]))
      .toBe("2026-08-30");
  });

  it.each([
    ["2026-08-02", "2026-08-03"],
    ["2026-08-09", "2026-08-10"],
    ["2026-08-16", "2026-08-17"],
    ["2026-08-23", "2026-08-24"],
    ["2026-08-30", "2026-08-31"],
  ])("실제 운영 파일처럼 %s보다 하루 늦게 적힌 %s 행을 찾는다", (sunday, planDate) => {
    expect(resolveMonthlyPlanDate(sunday, [
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
    ])).toBe(planDate);
  });

  it("하루 빠르게 적힌 행도 같은 주 계획으로 찾는다", () => {
    expect(resolveMonthlyPlanDate("2026-08-30", ["2026-08-29"]))
      .toBe("2026-08-29");
  });

  it("인접 후보가 둘이면 임의로 고르지 않는다", () => {
    expect(resolveMonthlyPlanDate("2026-08-30", ["2026-08-29", "2026-08-31"]))
      .toBeNull();
  });

  it("이틀 이상 떨어진 행은 사용하지 않는다", () => {
    expect(resolveMonthlyPlanDate("2026-08-30", ["2026-09-01"]))
      .toBeNull();
  });
});
