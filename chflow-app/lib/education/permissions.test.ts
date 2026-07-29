import { describe, expect, it } from "vitest";
import {
  canApproveEducationHistory,
  canImportEducationHistory,
  canManageEducationCourses,
  canManageEducationHistory,
  canViewEducationHistory,
  EDUCATION_CAPABILITY,
} from "./permissions";

describe("education capabilities", () => {
  it("비로그인은 조회와 수정을 할 수 없다", () => {
    expect(canViewEducationHistory([])).toBe(false);
    expect(canManageEducationHistory([])).toBe(false);
  });
  it("일반 성도는 공개 이력만 조회한다", () => {
    const caps = [EDUCATION_CAPABILITY.read];
    expect(canViewEducationHistory(caps)).toBe(true);
    expect(canManageEducationHistory(caps)).toBe(false);
    expect(canImportEducationHistory(caps)).toBe(false);
  });
  it("역할명이 아니라 부여된 capability로 관리자 작업을 판단한다", () => {
    const caps = Object.values(EDUCATION_CAPABILITY);
    expect(canManageEducationHistory(caps)).toBe(true);
    expect(canImportEducationHistory(caps)).toBe(true);
    expect(canApproveEducationHistory(caps)).toBe(true);
    expect(canManageEducationCourses(caps)).toBe(true);
  });
});
