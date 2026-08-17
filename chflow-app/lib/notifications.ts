import { supabase } from "./supabase";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
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
}

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
  return data || [];
}

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
    p_department_enabled: preferences.department_enabled,
    p_education_enabled: preferences.education_enabled,
    p_feedback_enabled: preferences.feedback_enabled,
    p_account_enabled: preferences.account_enabled,
    p_system_enabled: preferences.system_enabled,
  });
  if (error) throw error;
}

export async function markRead(id: string): Promise<void> {
  await supabase.rpc("mark_notification_read", { p_notification_id: id });
}

export async function markAllRead(): Promise<number> {
  const { data } = await supabase.rpc("mark_all_notifications_read");
  return (data as number) || 0;
}

export async function deleteNotification(id: string): Promise<void> {
  await supabase.from("notifications").delete().eq("id", id);
}

export async function deleteAllNotifications(): Promise<void> {
  // RLS 만 믿지 않고 본인 알림으로 명시 한정한다. (정책이 잘못 적용되면
  // user_id 조건 없는 전체 delete 가 다른 사용자 알림까지 지울 수 있다)
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  await supabase.from("notifications").delete().eq("user_id", userId);
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
