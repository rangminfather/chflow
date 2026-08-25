import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_FALLBACK_INITIAL_MS,
  NOTIFICATION_FALLBACK_MAX_MS,
  attendancePollingDelay,
  nextNotificationFallbackDelay,
} from "./pollingPolicies";

describe("notification fallback polling", () => {
  it("backs off from 10 seconds up to 60 seconds", () => {
    let delay = NOTIFICATION_FALLBACK_INITIAL_MS;
    delay = nextNotificationFallbackDelay(delay, false);
    expect(delay).toBe(20_000);
    delay = nextNotificationFallbackDelay(delay, false);
    expect(delay).toBe(40_000);
    delay = nextNotificationFallbackDelay(delay, false);
    expect(delay).toBe(NOTIFICATION_FALLBACK_MAX_MS);
    expect(nextNotificationFallbackDelay(delay, false)).toBe(NOTIFICATION_FALLBACK_MAX_MS);
  });

  it("resets after a successful fallback sync", () => {
    expect(nextNotificationFallbackDelay(60_000, true)).toBe(10_000);
  });
});

describe("attendance status polling", () => {
  it("uses 10 seconds only while an unfinished candidate is active", () => {
    expect(attendancePollingDelay({ candidate: { status: "candidate" }, attendance: null })).toBe(10_000);
  });

  it("uses 60 seconds when automatic attendance is not in progress", () => {
    expect(attendancePollingDelay(null)).toBe(60_000);
    expect(attendancePollingDelay({ candidate: null, attendance: null })).toBe(60_000);
    expect(attendancePollingDelay({ candidate: { status: "expired" }, attendance: null })).toBe(60_000);
  });

  it("stops after attendance is recorded", () => {
    expect(attendancePollingDelay({ candidate: { status: "confirmed" }, attendance: {} })).toBeNull();
  });
});
