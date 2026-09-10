import { describe, it, expect } from "vitest";
import { canUseFacility } from "./facility-access";

describe("시설 사용신청 권한", () => {
  it("목사 ~ 서리집사 직분은 쓸 수 있다", () => {
    for (const role of [
      "담임목사", "부목사", "은퇴목사", "선교사", "전도사", "사모",
      "시무장로", "원로장로", "은퇴장로", "명예장로",
      "교육사", "간사",
      "시무집사", "명예시무집사", "은퇴시무집사",
      "시무권사", "명예시무권사", "은퇴시무권사",
      "서리집사 (남)", "서리집사 (여)",
    ]) {
      expect(canUseFacility(role), role).toBe(true);
    }
  });

  it("청년·청소년은 직접 신청할 수 있어야 하므로 열어 둔다", () => {
    for (const role of ["청년 (남)", "청년 (여)", "청소년 (남)", "청소년 (여)"]) {
      expect(canUseFacility(role), role).toBe(true);
    }
  });

  it("일반 성도와 청소년 미만은 쓸 수 없다", () => {
    for (const role of [
      "성도", "성도 (남)", "성도 (여)",
      "어린이 (남)", "어린이 (여)",
      "유아 (남)", "유아 (여)",
      "영아 (남)", "영아 (여)",
    ]) {
      expect(canUseFacility(role), role).toBe(false);
    }
  });

  it("직분이 비었거나 모르면 막는다 (모르는 값에 권한을 주지 않는다)", () => {
    expect(canUseFacility(null)).toBe(false);
    expect(canUseFacility(undefined)).toBe(false);
    expect(canUseFacility("")).toBe(false);
    expect(canUseFacility("   ")).toBe(false);
    expect(canUseFacility("알 수 없음")).toBe(false);
  });

  it("결재자(admin·office·pastor)는 직분과 무관하게 쓸 수 있다", () => {
    expect(canUseFacility("성도 (남)", "admin")).toBe(true);
    expect(canUseFacility(null, "office")).toBe(true);
    expect(canUseFacility("어린이 (여)", "pastor")).toBe(true);
    expect(canUseFacility("성도 (남)", "member")).toBe(false);
  });

  it("청년과 청소년은 서로 다른 낱말이라 섞이지 않는다", () => {
    expect(canUseFacility("청소년 (남)")).toBe(true);
    expect(canUseFacility("청년 (남)")).toBe(true);
    // 어린이는 어느 쪽에도 걸리지 않는다
    expect(canUseFacility("어린이 (남)")).toBe(false);
  });
});
