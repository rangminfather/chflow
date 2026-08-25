import { supabase } from "./supabase";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationAudience,
  type NotificationAudience,
  type NotificationPreferences,
} from "./notificationPreferences";

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link_url: string | null;
  is_read: boolean;
  created_at: string;
  metadata: Record<string, unknown>;
  /** 'user' = 내 알림, 'ops' = 운영 알림. 서버가 권한을 확인한 뒤 채워준다. */
  audience: NotificationAudience;
}

export interface NotificationCounts {
  /** 내 알림 미읽음 */
  user: number;
  /** 운영 알림 미읽음 (운영 권한이 없으면 항상 0) */
  ops: number;
  /** 배지에 쓰는 합계 */
  total: number;
  /** 운영 알림 탭을 볼 수 있는지 — 서버의 현재 role 판정 결과 */
  opsViewer: boolean;
}

export const EMPTY_NOTIFICATION_COUNTS: NotificationCounts = {
  user: 0, ops: 0, total: 0, opsViewer: false,
};

function isTransientFetchError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const record = error as Record<string, unknown>;
  const message = [record.message, record.details, record.name, record.code]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return (
    message.includes("failed to fetch") ||
    message.includes("err_aborted") ||
    message.includes("aborterror") ||
    message.includes("networkerror")
  );
}

type NotificationFetchOptions = {
  throwOnError?: boolean;
};

/**
 * 내 알림과 운영 알림을 한 번에 받아온다. 운영 알림 노출 여부는 서버(RPC)가
 * 현재 role 로 판정하므로 클라이언트가 audience 를 지정하지 않는다.
 * 탭 분리는 이 결과를 audience 로 나누기만 한다 — 탭마다 조회하지 않는다.
 */
export async function fetchNotifications(
  limit = 30,
  onlyUnread = false,
  options: NotificationFetchOptions = {},
): Promise<Notification[]> {
  const { data, error } = await supabase.rpc("get_my_notifications", {
    p_limit: limit,
    p_only_unread: onlyUnread,
  });
  if (error) {
    if (!isTransientFetchError(error)) {
      console.error("fetchNotifications error", error);
    }
    if (options.throwOnError) throw error;
    return [];
  }
  return normalizeRows(data);
}

type RawNotification = Omit<Notification, "audience"> & { audience?: string | null };

// audience 컬럼 마이그레이션 적용 전 배포에서도 목록이 비지 않게 타입에서 보정한다.
function normalizeRows(data: unknown): Notification[] {
  if (!Array.isArray(data)) return [];
  return (data as RawNotification[]).map((row) => ({
    ...row,
    audience: row.audience === "ops" || row.audience === "user"
      ? row.audience
      : notificationAudience(row.type),
  }));
}

export function splitByAudience(rows: Notification[]): Record<NotificationAudience, Notification[]> {
  const user: Notification[] = [];
  const ops: Notification[] = [];
  for (const row of rows) (row.audience === "ops" ? ops : user).push(row);
  return { user, ops };
}

/**
 * 미읽음 수를 audience 별로 한 번에 받아온다. 탭별 숫자 때문에 쿼리를 추가하지 않기 위한 RPC 이며
 * 운영 탭 노출 여부(opsViewer)도 같은 응답에 담겨 온다.
 */
export async function fetchNotificationCounts(
  options: NotificationFetchOptions = {},
): Promise<NotificationCounts> {
  const { data, error } = await supabase.rpc("get_my_notification_counts");
  if (error) {
    // audience 마이그레이션 적용 전에 웹이 먼저 배포된 구간에서도 배지가 죽지 않게
    // 기존 RPC 로 물러난다. 이 경로에서는 운영 탭이 열리지 않는다.
    const legacy = await supabase.rpc("get_unread_count");
    if (!legacy.error) {
      const total = (legacy.data as number) || 0;
      return { user: total, ops: 0, total, opsViewer: false };
    }
    if (options.throwOnError) throw error;
    return EMPTY_NOTIFICATION_COUNTS;
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return EMPTY_NOTIFICATION_COUNTS;
  const user = Number(row.user_unread) || 0;
  const ops = Number(row.ops_unread) || 0;
  return { user, ops, total: user + ops, opsViewer: row.ops_viewer === true };
}

/** @deprecated fetchNotificationCounts 를 쓴다. 배지 합계만 필요한 경로를 위해 남겨둔다. */
export async function getUnreadCount(options: NotificationFetchOptions = {}): Promise<number> {
  const { data, error } = await supabase.rpc("get_unread_count");
  if (error) {
    if (options.throwOnError) throw error;
    return 0;
  }
  return (data as number) || 0;
}

export async function fetchNotificationPreferences(
  options: NotificationFetchOptions = {},
): Promise<NotificationPreferences> {
  const { data, error } = await supabase.rpc("get_my_notification_preferences");
  if (error) {
    if (options.throwOnError) throw error;
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
  if (!data?.[0]) return DEFAULT_NOTIFICATION_PREFERENCES;
  return data[0] as NotificationPreferences;
}

export async function saveNotificationPreferences(preferences: NotificationPreferences): Promise<void> {
  const { error } = await supabase.rpc("set_my_notification_preferences", {
    p_enabled: preferences.enabled,
    p_push_enabled: preferences.push_enabled,
    p_in_app_enabled: preferences.in_app_enabled,
    p_message_enabled: preferences.message_enabled,
    p_worship_enabled: preferences.worship_enabled,
    p_notice_enabled: preferences.notice_enabled,
    // 생방송 종료 알림. 시작(worship)과 따로 끌 수 있다.
    p_worship_end_enabled: preferences.worship_end_enabled,
    p_department_enabled: preferences.department_enabled,
    p_education_enabled: preferences.education_enabled,
    p_feedback_enabled: preferences.feedback_enabled,
    p_account_enabled: preferences.account_enabled,
    p_system_enabled: preferences.system_enabled,
    // 운영 알림 설정. 마이그레이션 적용 전 DB 는 기본값이 있는 인자라 무시한다.
    p_ops_signup_enabled: preferences.ops_signup_enabled,
    p_ops_feedback_enabled: preferences.ops_feedback_enabled,
  });
  if (error) throw error;
}

export async function markRead(id: string): Promise<void> {
  await supabase.rpc("mark_notification_read", { p_notification_id: id });
}

/**
 * audience 범위를 반드시 지정한다. 「내 알림」 모두 읽음이 운영 알림 미읽음까지
 * 지우지 않도록 서버 RPC 도 범위를 받고, ops 범위는 DB 에서 권한을 다시 확인한다.
 */
export async function markAllRead(audience: NotificationAudience = "user"): Promise<number> {
  const { data } = await supabase.rpc("mark_all_notifications_read", { p_audience: audience });
  return (data as number) || 0;
}

export async function deleteNotification(id: string): Promise<void> {
  await supabase.from("notifications").delete().eq("id", id);
}

/**
 * "전체삭제" 는 내 알림(audience='user')만 지운다.
 * 운영 알림은 장애·신고 이력이라 사용자 조작으로 통째로 사라지면 안 된다.
 */
export async function deleteAllNotifications(): Promise<void> {
  // RLS 만 믿지 않고 본인 알림으로 명시 한정한다. (정책이 잘못 적용되면
  // user_id 조건 없는 전체 delete 가 다른 사용자 알림까지 지울 수 있다)
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  await supabase
    .from("notifications")
    .delete()
    .eq("user_id", userId)
    .eq("audience", "user");
}

// PWA 앱 아이콘 배지 (지원 브라우저만)
type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

type NativeWebViewBridge = {
  postMessage: (message: string) => void;
};

function normalizeBadgeCount(count: number): number {
  if (!Number.isFinite(count)) return 0;
  return Math.min(Math.max(Math.floor(count), 0), 9999);
}

function syncNativeAppBadge(count: number): void {
  if (typeof window === "undefined") return;

  const nativeWebView = (window as Window & {
    ReactNativeWebView?: NativeWebViewBridge;
  }).ReactNativeWebView;
  if (!nativeWebView) return;

  try {
    nativeWebView.postMessage(JSON.stringify({
      type: "CHFLOW_SET_BADGE",
      count,
    }));
  } catch {
    // Native bridge is optional.
  }
}

export function setAppBadge(count: number): void {
  const normalizedCount = normalizeBadgeCount(count);
  syncNativeAppBadge(normalizedCount);
  if (typeof navigator === "undefined") return;

  const nav = navigator as BadgeNavigator;
  try {
    if (normalizedCount > 0) {
      nav.setAppBadge?.(normalizedCount)?.catch(() => {});
      // Service Worker에도 알림 (Service Worker가 더 안정적)
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "SET_BADGE",
          count: normalizedCount,
        });
      }
    } else {
      nav.clearAppBadge?.()?.catch(() => {});
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "CLEAR_BADGE",
        });
      }
    }
  } catch {
    // Badging API not supported
  }
}

export function clearAppBadge(): void {
  syncNativeAppBadge(0);
  if (typeof navigator === "undefined") return;

  const nav = navigator as BadgeNavigator;
  try {
    nav.clearAppBadge?.()?.catch(() => {});
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "CLEAR_BADGE",
      });
    }
  } catch {}
}

// 사용자에게 알림 권한 요청 (PWA 배지에 도움)
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window)) return false;

  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}
