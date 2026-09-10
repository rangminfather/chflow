import { describe, it, expect } from "vitest";
import {
  attendanceStatusLabel,
  normalizeAttendanceStatus,
  summarizeAttendance,
} from "./attendanceStatus";

describe("출결 상태 — 미체크와 결석 구분", () => {
  it("기록이 없으면 미체크다 (예전에는 결석으로 바꿔 보여줬다)", () => {
    expect(normalizeAttendanceStatus(null)).toBe("");
    expect(normalizeAttendanceStatus(undefined)).toBe("");
    expect(normalizeAttendanceStatus("")).toBe("");
    expect(attendanceStatusLabel(null)).toBe("미체크");
  });

  it("결석은 선생님이 찍었을 때만 결석이다", () => {
    expect(normalizeAttendanceStatus("결")).toBe("결");
    expect(attendanceStatusLabel("결")).toBe("결석");
  });

  it("출석·출석인정은 그대로", () => {
    expect(normalizeAttendanceStatus("출")).toBe("출");
    expect(normalizeAttendanceStatus("인")).toBe("인");
    expect(attendanceStatusLabel("인")).toBe("출석인정");
  });

  it("모르는 값은 미체크로 본다 (결석으로 단정하지 않는다)", () => {
    expect(normalizeAttendanceStatus("X")).toBe("");
    expect(normalizeAttendanceStatus("지각")).toBe("");
  });

  it("주간 요약 — 미체크를 따로 센다", () => {
    // 2026-09-06 초등1부 2-2반 실제 상태: 4명 중 2명만 기록
    expect(summarizeAttendance(["출", "출", null, null])).toEqual({
      total: 4, attend: 2, absent: 0, otherChurch: 0, unchecked: 2,
    });
  });

  it("전원 결석으로 찍은 반과 아무도 안 찍은 반이 구분된다", () => {
    const allAbsent = summarizeAttendance(["결", "결"]);
    const untouched = summarizeAttendance([null, null]);
    expect(allAbsent).toMatchObject({ absent: 2, unchecked: 0 });
    expect(untouched).toMatchObject({ absent: 0, unchecked: 2 });
    // 예전 방식이었다면 둘 다 "결석 2" 로 같아 보였다
    expect(allAbsent.absent).not.toBe(untouched.absent);
  });

  it("전원 찍힌 반은 미체크가 0이다", () => {
    expect(summarizeAttendance(["출", "결", "인"])).toMatchObject({ unchecked: 0 });
  });
});
