import { describe, expect, it } from "vitest";
import {
  getBulletinSundayTargets,
  getExpectedBulletinIssueDate,
  isBulletinDemandRetryWindow,
} from "./schedule";

describe("bulletin schedule", () => {
  it("targets the upcoming Sunday on Saturday KST", () => {
    const now = new Date("2026-09-05T03:00:00.000Z"); // Saturday noon KST
    expect(getBulletinSundayTargets(now)).toEqual({
      currentSunday: "2026-08-30",
      nextSunday: "2026-09-06",
    });
    expect(getExpectedBulletinIssueDate(now)).toBe("2026-09-06");
    expect(isBulletinDemandRetryWindow(now)).toBe(true);
  });

  it("targets the current Sunday on Sunday KST", () => {
    const now = new Date("2026-09-05T21:30:00.000Z"); // Sunday 06:30 KST
    expect(getExpectedBulletinIssueDate(now)).toBe("2026-09-06");
    expect(isBulletinDemandRetryWindow(now)).toBe(true);
  });

  it("does not allow demand retries outside the weekend", () => {
    const now = new Date("2026-09-07T03:00:00.000Z"); // Monday noon KST
    expect(getExpectedBulletinIssueDate(now)).toBe("2026-09-06");
    expect(isBulletinDemandRetryWindow(now)).toBe(false);
  });
});
