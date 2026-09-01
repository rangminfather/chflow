// 알림 분류의 단일 출처.
//
// 새 알림 타입을 추가할 때는 NOTIFICATION_TYPES 에 audience/category(운영이면 required)를
// 함께 등록해야 한다. 등록을 빼먹으면 조용히 'system' 으로 흘러들어가는 대신
// lib/notificationRegistry.test.ts 가 실패한다. (DB 쪽 대응 함수는
// public.notification_audience_of / notification_category 이며 같은 테스트가 대조한다)

export type NotificationAudience = "user" | "ops";

/**
 * 운영 알림을 볼 수 있는 전역 역할. 프로젝트 전반이 쓰는 판정과 같은 목록이며
 * DB 쪽 대응은 public.can_view_ops_notifications() (내부에서 get_user_role() 위임) 이다.
 */
export const OPS_NOTIFICATION_ROLES = ["admin", "office", "pastor"] as const;

export type NotificationCategory =
  // 사용자 알림
  | "message"
  | "worship"
  | "worship_end"
  | "notice"
  | "department"
  | "education"
  | "pasture"
  | "feedback"
  | "account"
  | "system"
  // 운영 알림
  | "ops_signup"
  | "ops_feedback"
  | "ops_report"
  | "ops_system";

export interface NotificationTypeSpec {
  audience: NotificationAudience;
  category: NotificationCategory;
  /** 필수 운영 알림 — 사용자 알림 설정으로 끌 수 없다. ops 에만 쓴다. */
  required?: true;
}

export const NOTIFICATION_TYPES = {
  // ── 사용자: 예배 생방송 (전 성도) ──
  // 시작과 종료는 성격이 달라 카테고리를 나눈다 (시작만 받고 종료는 끄는 선택이 가능해야 한다).
  notice_worship_live: { audience: "user", category: "worship" },
  notice_worship_live_ended: { audience: "user", category: "worship_end" },

  // ── 사용자: 메신저 ──
  message_new: { audience: "user", category: "message" },

  // ── 사용자: 계정 (본인) ──
  signup_approved: { audience: "user", category: "account" },
  signup_rejected: { audience: "user", category: "account" },

  // ── 사용자: 문의게시판 (작성자) ──
  feedback_reply: { audience: "user", category: "feedback" },
  feedback_status: { audience: "user", category: "feedback" },

  // ── 사용자: 부서 (당사자 / 부서 담당자 자격) ──
  dept_join_approved: { audience: "user", category: "department" },
  dept_join_rejected: { audience: "user", category: "department" },
  dept_approved: { audience: "user", category: "department" },
  dept_rejected: { audience: "user", category: "department" },
  dept_removed: { audience: "user", category: "department" },
  dept_role_assigned: { audience: "user", category: "department" },
  dept_appointed: { audience: "user", category: "department" },
  dept_notice_new: { audience: "user", category: "department" },
  dept_notice_reply: { audience: "user", category: "department" },
  dept_verse_memory_new: { audience: "user", category: "department" },
  // 부서 담당자(grade<=2)와 전역 관리자 양쪽에 발송되지만, 처리 주체는 부서 담당자다.
  dept_join_request: { audience: "user", category: "department" },
  // 진급받는 부서의 부장·전도사(grade<=1)가 받는다. 전역 운영 권한과 무관하다.
  dept_promotion_in: { audience: "user", category: "department" },

  // ── 사용자: 교육부서 (담임교사·부서 소속 자격) ──
  edu_promotion_done: { audience: "user", category: "education" },
  edu_promotion_upcoming: { audience: "user", category: "education" },
  edu_absence: { audience: "user", category: "education" },

  // 목장 모임 조율 — 가능일 조사 → 확정 → 최종 참석
  pasture_availability_request: { audience: "user", category: "pasture" },
  pasture_schedule_confirmed: { audience: "user", category: "pasture" },
  pasture_schedule_changed: { audience: "user", category: "pasture" },
  pasture_schedule_cancelled: { audience: "user", category: "pasture" },
  pasture_rsvp_request: { audience: "user", category: "pasture" },

  // ── 운영(선택): 업무 처리 대기 — 운영 설정으로 끌 수 있다 ──
  ops_signup_pending: { audience: "ops", category: "ops_signup" },
  ops_feedback_new: { audience: "ops", category: "ops_feedback" },

  // ── 운영(필수): 신고·장애·용량 — 사용자 설정으로 끌 수 없다 ──
  ops_message_report: { audience: "ops", category: "ops_report", required: true },
  ops_usage_anomaly: { audience: "ops", category: "ops_system", required: true },
  ops_usage_r2_capacity: { audience: "ops", category: "ops_system", required: true },
  ops_usage_db_capacity: { audience: "ops", category: "ops_system", required: true },
  ops_bulletin_sync_error: { audience: "ops", category: "ops_system", required: true },
} as const satisfies Record<string, NotificationTypeSpec>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/**
 * ops_* rename 이전에 저장된 알림 타입. 백필로 DB 는 정리하지만,
 * 백필 전에 만들어진 push delivery 큐나 캐시된 목록이 미분류로 떨어지지 않게 남겨둔다.
 */
export const LEGACY_NOTIFICATION_TYPES: Record<string, NotificationType> = {
  signup_pending: "ops_signup_pending",
  feedback_new: "ops_feedback_new",
  message_report: "ops_message_report",
  usage_anomaly: "ops_usage_anomaly",
  usage_r2_capacity: "ops_usage_r2_capacity",
  usage_db_capacity: "ops_usage_db_capacity",
  bulletin_sync_error: "ops_bulletin_sync_error",
};

export function normalizeNotificationType(type: string): string {
  return LEGACY_NOTIFICATION_TYPES[type] ?? type;
}

export function notificationSpec(type: string): NotificationTypeSpec | null {
  const normalized = normalizeNotificationType(type);
  const spec = (NOTIFICATION_TYPES as Record<string, NotificationTypeSpec>)[normalized];
  if (spec) return spec;
  if (process.env.NODE_ENV !== "production") {
    console.error(
      `[notifications] 미등록 알림 타입: ${type} — lib/notificationPreferences.ts 의 NOTIFICATION_TYPES 에 audience/category 를 등록하세요.`,
    );
  }
  return null;
}

/** 미등록 타입은 'user' 로 본다 — 운영 알림을 잘못 숨기는 쪽보다 안전하다. */
export function notificationAudience(type: string): NotificationAudience {
  return notificationSpec(type)?.audience ?? "user";
}

export function isRequiredOpsNotification(type: string): boolean {
  const spec = notificationSpec(type);
  return spec?.audience === "ops" && spec.required === true;
}

export interface NotificationPreferences {
  enabled: boolean;
  push_enabled: boolean;
  in_app_enabled: boolean;
  message_enabled: boolean;
  worship_enabled: boolean;
  worship_end_enabled: boolean;
  notice_enabled: boolean;
  department_enabled: boolean;
  education_enabled: boolean;
  pasture_enabled: boolean;
  feedback_enabled: boolean;
  account_enabled: boolean;
  system_enabled: boolean;
  ops_signup_enabled: boolean;
  ops_feedback_enabled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  push_enabled: true,
  in_app_enabled: true,
  message_enabled: true,
  worship_enabled: true,
  worship_end_enabled: true,
  notice_enabled: true,
  department_enabled: true,
  education_enabled: true,
  pasture_enabled: true,
  feedback_enabled: true,
  account_enabled: true,
  system_enabled: true,
  ops_signup_enabled: true,
  ops_feedback_enabled: true,
};

/**
 * 스위치를 제공하는 카테고리. 필수 운영 알림(ops_report/ops_system)은 끌 수 없으므로
 * notification_preferences 에 컬럼도 두지 않는다.
 */
export type ToggleableNotificationCategory = Exclude<NotificationCategory, "ops_report" | "ops_system">;

type CategoryDisplay = {
  key: ToggleableNotificationCategory;
  label: string;
  description: string;
  audience: NotificationAudience;
};

/** 사용자가 직접 끌 수 있는 카테고리만 담는다. 필수 운영 알림은 스위치를 만들지 않는다. */
export const NOTIFICATION_CATEGORIES: CategoryDisplay[] = [
  { key: "message", label: "메신저", description: "새 메시지와 대화 알림", audience: "user" },
  { key: "worship", label: "예배 생방송 시작", description: "예배 방송이 시작될 때", audience: "user" },
  { key: "worship_end", label: "예배 생방송 종료", description: "예배 방송이 끝났을 때", audience: "user" },
  { key: "notice", label: "공지·게시판", description: "공지, 게시글과 댓글 알림", audience: "user" },
  { key: "department", label: "사역·부서", description: "부서 가입, 승인과 역할 변경 알림", audience: "user" },
  { key: "education", label: "교육부서", description: "등반 예정·완료와 장기 미출석 알림", audience: "user" },
  { key: "pasture", label: "목장", description: "목장모임 확정, 가능일 요청과 참석 확인 알림", audience: "user" },
  { key: "feedback", label: "문의게시판", description: "내가 쓴 문의의 답변과 처리 상태", audience: "user" },
  { key: "account", label: "계정", description: "회원가입 승인과 계정 상태 알림", audience: "user" },
  { key: "ops_signup", label: "가입 승인 대기", description: "새 가입 신청이 들어왔을 때", audience: "ops" },
  { key: "ops_feedback", label: "문의 접수", description: "성도가 새 문의를 등록했을 때", audience: "ops" },
];

export const USER_NOTIFICATION_CATEGORIES = NOTIFICATION_CATEGORIES.filter((c) => c.audience === "user");
export const OPS_NOTIFICATION_CATEGORIES = NOTIFICATION_CATEGORIES.filter((c) => c.audience === "ops");

/**
 * 미등록 타입은 'unclassified' 로 돌려준다. 'system' 으로 흘려보내지 않는다.
 * (예전 구현은 else → 'system' 이어서 신규 타입이 사용자 '시스템' 스위치에 빨려 들어갔다)
 */
export function notificationCategory(type: string): NotificationCategory | "unclassified" {
  return notificationSpec(type)?.category ?? "unclassified";
}

export function notificationAllowed(
  preferences: NotificationPreferences,
  type: string,
  channel: "push" | "in_app",
): boolean {
  const spec = notificationSpec(type);

  // 운영 알림은 사용자용 전역 스위치(enabled/push/in_app)의 영향을 받지 않는다.
  // 장애·신고가 "알림 끄기" 때문에 사라지면 안 된다.
  if (spec?.audience === "ops") {
    if (spec.required) return true;
    return categoryEnabled(preferences, spec.category);
  }

  if (!preferences.enabled) return false;
  if (channel === "push" && !preferences.push_enabled) return false;
  if (channel === "in_app" && !preferences.in_app_enabled) return false;
  // 미등록 타입은 차단하지 않는다 — 분류 누락으로 알림이 유실되는 쪽이 더 나쁘다.
  if (!spec) return true;
  return categoryEnabled(preferences, spec.category);
}

function categoryEnabled(preferences: NotificationPreferences, category: NotificationCategory): boolean {
  const value = preferences[`${category}_enabled` as keyof NotificationPreferences];
  return typeof value === "boolean" ? value : true;
}
