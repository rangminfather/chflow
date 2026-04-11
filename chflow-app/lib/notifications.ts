import { supabase } from "./supabase";

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

export async function fetchNotifications(limit = 30, onlyUnread = false): Promise<Notification[]> {
  const { data, error } = await supabase.rpc("get_my_notifications", {
    p_limit: limit,
    p_only_unread: onlyUnread,
  });
  if (error) {
    console.error("fetchNotifications error", error);
    return [];
  }
  return data || [];
}

export async function getUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc("get_unread_count");
  if (error) return 0;
  return (data as number) || 0;
}

export async function markRead(id: string): Promise<void> {
  await supabase.rpc("mark_notification_read", { p_notification_id: id });
}

export async function markAllRead(): Promise<number> {
  const { data } = await supabase.rpc("mark_all_notifications_read");
  return (data as number) || 0;
}

// PWA 앱 아이콘 배지 (지원 브라우저만)
type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function setAppBadge(count: number): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as BadgeNavigator;
  try {
    if (count > 0) {
      nav.setAppBadge?.(count);
    } else {
      nav.clearAppBadge?.();
    }
  } catch {
    // Badging API not supported
  }
}

export function clearAppBadge(): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as BadgeNavigator;
  try {
    nav.clearAppBadge?.();
  } catch {}
}
