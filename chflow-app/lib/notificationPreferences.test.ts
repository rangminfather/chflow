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
  });

  it("운영 알림은 별도 운영 카테고리로 분류한다", () => {
    expect(notificationCategory("ops_bulletin_sync_error")).toBe("ops_system");
    expect(notificationCategory("ops_usage_anomaly")).toBe("ops_system");
    expect(notificationCategory("ops_message_report")).toBe("ops_report");
    expect(notificationCategory("ops_signup_pending")).toBe("ops_signup");
    expect(notificationCategory("ops_feedback_new")).toBe("ops_feedback");
  });

  it("rename 이전 타입도 같은 운영 카테고리로 흡수한다", () => {
    expect(notificationCategory("bulletin_sync_error")).toBe("ops_system");
    expect(notificationCategory("message_report")).toBe("ops_report");
    expect(notificationCategory("signup_pending")).toBe("ops_signup");
  });

  it("미등록 타입은 system 이 아니라 unclassified 로 떨어진다", () => {
    expect(notificationCategory("brand_new_type_without_mapping")).toBe("unclassified");
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

  it("메신저 알림을 꺼도 신고 접수는 영향받지 않는다", () => {
    const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, message_enabled: false };
    expect(notificationAllowed(preferences, "message_new", "push")).toBe(false);
    expect(notificationAllowed(preferences, "ops_message_report", "push")).toBe(true);
    expect(notificationAllowed(preferences, "ops_message_report", "in_app")).toBe(true);
  });

  it("필수 운영 알림은 전체 알림 OFF 에도 전달된다", () => {
    const off = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enabled: false,
      push_enabled: false,
      in_app_enabled: false,
    };
    for (const type of [
      "ops_usage_anomaly",
      "ops_usage_r2_capacity",
      "ops_usage_db_capacity",
      "ops_bulletin_sync_error",
      "ops_message_report",
    ]) {
      expect(notificationAllowed(off, type, "push")).toBe(true);
      expect(notificationAllowed(off, type, "in_app")).toBe(true);
    }
    // 사용자 알림은 그대로 차단된다
    expect(notificationAllowed(off, "message_new", "push")).toBe(false);
  });

  it("선택 운영 알림은 운영 스위치로만 끈다", () => {
    const off = { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false, account_enabled: false, feedback_enabled: false };
    // 사용자용 전역/카테고리 설정에 영향받지 않는다
    expect(notificationAllowed(off, "ops_signup_pending", "push")).toBe(true);
    expect(notificationAllowed(off, "ops_feedback_new", "push")).toBe(true);
    // 운영 스위치를 끄면 차단된다
    expect(notificationAllowed({ ...DEFAULT_NOTIFICATION_PREFERENCES, ops_signup_enabled: false }, "ops_signup_pending", "push")).toBe(false);
    expect(notificationAllowed({ ...DEFAULT_NOTIFICATION_PREFERENCES, ops_feedback_enabled: false }, "ops_feedback_new", "push")).toBe(false);
  });

  it("사용자 문의/계정 알림은 운영 스위치와 무관하다", () => {
    const opsOff = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ops_signup_enabled: false,
      ops_feedback_enabled: false,
    };
    expect(notificationAllowed(opsOff, "feedback_reply", "push")).toBe(true);
    expect(notificationAllowed(opsOff, "signup_approved", "push")).toBe(true);
  });

  it("미분류 타입은 차단하지 않는다 (알림 유실 방지)", () => {
    expect(notificationAllowed(DEFAULT_NOTIFICATION_PREFERENCES, "brand_new_type_without_mapping", "push")).toBe(true);
  });
});
