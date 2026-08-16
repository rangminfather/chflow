import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationAllowed,
  notificationCategory,
} from "./notificationPreferences";

describe("notificationCategory", () => {
  it("운영 중인 알림 유형을 사용자 설정 유형으로 분류한다", () => {
    expect(notificationCategory("message_new")).toBe("message");
    expect(notificationCategory("notice_worship_live")).toBe("worship");
    expect(notificationCategory("notice_worship_live_ended")).toBe("worship");
    expect(notificationCategory("edu_absence")).toBe("education");
    expect(notificationCategory("feedback_reply")).toBe("feedback");
    expect(notificationCategory("signup_approved")).toBe("account");
    expect(notificationCategory("dept_join_request")).toBe("department");
    expect(notificationCategory("bulletin_sync_error")).toBe("system");
  });
});

describe("notificationAllowed", () => {
  it("전체 및 채널 설정을 우선 적용한다", () => {
    expect(notificationAllowed({ ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false }, "message_new", "push")).toBe(false);
    expect(notificationAllowed({ ...DEFAULT_NOTIFICATION_PREFERENCES, push_enabled: false }, "message_new", "push")).toBe(false);
    expect(notificationAllowed({ ...DEFAULT_NOTIFICATION_PREFERENCES, in_app_enabled: false }, "message_new", "in_app")).toBe(false);
  });

  it("알림 유형별 설정을 적용한다", () => {
    const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, education_enabled: false };
    expect(notificationAllowed(preferences, "edu_absence", "push")).toBe(false);
    expect(notificationAllowed(preferences, "message_new", "push")).toBe(true);
  });
});
