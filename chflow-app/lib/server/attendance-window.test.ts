import { describe, expect, it } from "vitest";
import { isWithinAttendanceWindow, localDateInTimeZone } from "./attendance-window";

describe("attendance operating window", () => {
  it("accepts a time inside a same-day window", () => {
    expect(isWithinAttendanceWindow(
      new Date("2026-07-30T01:30:00.000Z"),
      "07:00",
      "15:00",
      "Asia/Seoul",
    )).toBe(true);
  });

  it("rejects a time outside a same-day window", () => {
    expect(isWithinAttendanceWindow(
      new Date("2026-07-30T10:30:00.000Z"),
      "07:00",
      "15:00",
      "Asia/Seoul",
    )).toBe(false);
  });

  it("supports an operating window crossing midnight", () => {
    expect(isWithinAttendanceWindow(
      new Date("2026-07-30T15:30:00.000Z"),
      "22:00",
      "02:00",
      "Asia/Seoul",
    )).toBe(true);
  });

  it("formats the attendance date in the configured timezone", () => {
    expect(localDateInTimeZone(
      new Date("2026-07-29T16:00:00.000Z"),
      "Asia/Seoul",
    )).toBe("2026-07-30");
  });
});
