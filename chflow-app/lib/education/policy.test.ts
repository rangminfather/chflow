import { describe, expect, it } from "vitest";
import { calculateCurrentRequiredProgress, policyAt } from "./policy";

const policies = ["life", "new", "faith", "godly", "bible"].flatMap((courseId) => [
  { courseId, requirementType: "elective" as const, effectiveFrom: null, effectiveTo: "2025-12-31" },
  { courseId, requirementType: "basic_required" as const, effectiveFrom: "2026-01-01", effectiveTo: null },
]);

describe("education course policies", () => {
  it("적용기간별 정책을 선택하고 이력 자체는 변경하지 않는다", () => {
    expect(policyAt(policies, "life", "2025-01-01")?.requirementType).toBe("elective");
    expect(policyAt(policies, "life", "2026-07-29")?.requirementType).toBe("basic_required");
  });
  it("현재 기본필수 5과목을 계산한다", () => {
    const result = calculateCurrentRequiredProgress(policies, ["life", "new", "faith", "godly", "bible"].map((courseId) => ({
      courseId, audience: "adult" as const, attendanceStatus: "completed",
    })), "2026-07-29");
    expect(result.requiredCourseIds).toHaveLength(5);
    expect(result.status).toBe("met");
  });
  it("어린이·청소년 이력을 성인 필수 충족으로 인정하지 않는다", () => {
    const result = calculateCurrentRequiredProgress(policies, [{
      courseId: "life", audience: "child", attendanceStatus: "completed",
    }], "2026-07-29");
    expect(result.completedCourseIds).not.toContain("life");
    expect(result.status).toBe("not_met");
  });
});
