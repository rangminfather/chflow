export type NotificationCategory =
  | "message"
  | "worship"
  | "notice"
  | "department"
  | "education"
  | "feedback"
  | "account"
  | "system";

export interface NotificationPreferences {
  enabled: boolean;
  push_enabled: boolean;
  in_app_enabled: boolean;
  message_enabled: boolean;
  worship_enabled: boolean;
  notice_enabled: boolean;
  department_enabled: boolean;
  education_enabled: boolean;
  feedback_enabled: boolean;
  account_enabled: boolean;
  system_enabled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  push_enabled: true,
  in_app_enabled: true,
  message_enabled: true,
  worship_enabled: true,
  notice_enabled: true,
  department_enabled: true,
  education_enabled: true,
  feedback_enabled: true,
  account_enabled: true,
  system_enabled: true,
};

export const NOTIFICATION_CATEGORIES: Array<{
  key: NotificationCategory;
  label: string;
  description: string;
}> = [
  { key: "message", label: "메신저", description: "새 메시지와 대화 알림" },
  { key: "worship", label: "예배 생방송", description: "예배 방송 시작·종료 알림" },
  { key: "notice", label: "공지·게시판", description: "공지, 게시글과 댓글 알림" },
  { key: "department", label: "사역·부서", description: "부서 가입, 승인과 역할 변경 알림" },
  { key: "education", label: "교육부서", description: "등반 예정·완료와 장기 미출석 알림" },
  { key: "feedback", label: "문의게시판", description: "문의 등록, 답변과 처리 상태 알림" },
  { key: "account", label: "계정", description: "회원가입 승인과 계정 상태 알림" },
  { key: "system", label: "시스템", description: "동기화 오류와 운영 상태 알림" },
];

export function notificationCategory(type: string): NotificationCategory {
  if (type.startsWith("message_") || type === "message") return "message";
  if (type.startsWith("notice_worship_")) return "worship";
  if (type.startsWith("edu_")) return "education";
  if (type.startsWith("feedback_")) return "feedback";
  if (type.startsWith("signup_")) return "account";
  if (type.startsWith("dept_")) return "department";
  if (type.startsWith("notice_") || type === "notice" || type.startsWith("verse_")) return "notice";
  return "system";
}

export function notificationAllowed(
  preferences: NotificationPreferences,
  type: string,
  channel: "push" | "in_app",
): boolean {
  if (!preferences.enabled) return false;
  if (channel === "push" && !preferences.push_enabled) return false;
  if (channel === "in_app" && !preferences.in_app_enabled) return false;
  return preferences[`${notificationCategory(type)}_enabled`];
}
