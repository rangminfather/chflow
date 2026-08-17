"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell, MessagesSquare, X, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import NotificationSettingsCard from "@/components/NotificationSettingsCard";
import { supabase } from "@/lib/supabase";
import {
  fetchNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  deleteAllNotifications,
  setAppBadge,
  clearAppBadge,
  fetchNotificationPreferences,
  type Notification,
} from "@/lib/notifications";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationAllowed,
  type NotificationPreferences,
} from "@/lib/notificationPreferences";
import {
  NOTIFICATION_FALLBACK_INITIAL_MS,
  NOTIFICATION_SAFETY_SYNC_MS,
  nextNotificationFallbackDelay,
} from "@/lib/pollingPolicies";

interface ToastNotification {
  id: string;
  title: string;
  body: string;
  type: string;
}

type PanelTab = "all" | "message" | "notice" | "settings";

// 이미 토스트로 띄운 알림 ID를 사용자별로 localStorage 에 보관한다.
// 벨 컴포넌트가 재마운트(화면 이동)·새로고침으로 초기화돼도 같은 알림이
// 폴링/첫 로드에서 다시 토스트로 뜨는 것을 막는다.
const TOAST_SEEN_KEY_PREFIX = "chflow:notifToastSeen:";
const TOAST_SEEN_CAP = 300;

function loadSeenToastIds(userId: string): string[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = window.localStorage.getItem(TOAST_SEEN_KEY_PREFIX + userId);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function persistSeenToastIds(userId: string, ids: string[]) {
  if (typeof window === "undefined" || !userId) return;
  try {
    // 최근 것만 유지 (Set 삽입 순서 = 발생 순서)
    const capped = ids.slice(-TOAST_SEEN_CAP);
    window.localStorage.setItem(TOAST_SEEN_KEY_PREFIX + userId, JSON.stringify(capped));
  } catch {
    // 용량 초과 등은 무시 (토스트 중복 방지는 best-effort)
  }
}

export default function NotificationBell({
  userId,
  placement = "inline",
}: {
  userId: string;
  placement?: "inline" | "dock";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const [activeTab, setActiveTab] = useState<PanelTab>("all");
  const preferencesRef = useRef<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const preferencesLoadedRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initLoadedRef = useRef(false);
  const mountedRef = useRef(false);
  const syncInFlightRef = useRef<Promise<boolean> | null>(null);

  // 패널 손으로 끌어 옮기기 (dock 모드 전용) — 위치는 transform 으로만 이동시켜
  // 가로/세로 스크롤바를 만들지 않는다. 종을 다시 켜면 0,0(기본 상단 가운데)으로 초기화.
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ startX: 0, startY: 0, baseX: 0, baseY: 0, dragging: false });

  const tabCounts = useMemo(() => ({
    all: notifications.length,
    message: notifications.filter((n) => getNotificationGroup(n.type) === "message").length,
    notice: notifications.filter((n) => getNotificationGroup(n.type) === "notice").length,
  }), [notifications]);

  const visibleNotifications = useMemo(() => {
    if (activeTab === "settings") return [];
    if (activeTab === "all") return notifications;
    return notifications.filter((n) => getNotificationGroup(n.type) === activeTab);
  }, [activeTab, notifications]);

  // 알림 ID를 '이미 표시함'으로 기록 (메모리 + localStorage 동시).
  const markSeen = useCallback((id: string) => {
    if (seenIdsRef.current.has(id)) return;
    seenIdsRef.current.add(id);
    persistSeenToastIds(userId, Array.from(seenIdsRef.current));
  }, [userId]);

  const showToast = useCallback((toast: ToastNotification) => {
    if (seenIdsRef.current.has(toast.id)) return;
    markSeen(toast.id);
    setToasts((prev) => [...prev, toast]);
    // 5초 후 자동 제거
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 5000);
  }, [markSeen]);

  const handleNewNotification = useCallback((n: Notification) => {
    if (!preferencesLoadedRef.current) return;
    if (!notificationAllowed(preferencesRef.current, n.type, "in_app")) return;
    if (seenIdsRef.current.has(n.id)) return;

    // 진동 (Android Chrome 등 지원 브라우저만 — iOS Safari 는 미지원)
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    } catch {
      // 사용자 제스처 정책 등으로 실패해도 무시
    }

    showToast({
      id: n.id,
      title: n.title,
      body: n.body || "",
      type: n.type,
    });

    setNotifications((prev) => {
      // 중복 방지
      if (prev.find((p) => p.id === n.id)) return prev;
      return [n, ...prev];
    });
    setUnreadCount((c) => {
      const next = c + 1;
      setAppBadge(next);
      return next;
    });
  }, [showToast]);

  const syncNotifications = useCallback((includePreferences = false): Promise<boolean> => {
    if (syncInFlightRef.current) return syncInFlightRef.current;

    const request = (async () => {
      const [listResult, countResult, preferencesResult] = await Promise.allSettled([
        fetchNotifications(30, false, { throwOnError: true }),
        getUnreadCount({ throwOnError: true }),
        includePreferences
          ? fetchNotificationPreferences({ throwOnError: true })
          : Promise.resolve(null),
      ]);
      try {
        if (!mountedRef.current) {
          return listResult.status === "fulfilled" && countResult.status === "fulfilled";
        }

        const nextPreferences = preferencesResult.status === "fulfilled"
          ? preferencesResult.value
          : null;
        if (nextPreferences) {
          preferencesRef.current = nextPreferences;
          preferencesLoadedRef.current = true;
          if (!nextPreferences.enabled || !nextPreferences.in_app_enabled) setToasts([]);
        }

        if (listResult.status === "rejected" || countResult.status === "rejected") return false;
        const list = listResult.value;
        const count = countResult.value;

        if (initLoadedRef.current) {
          const newNotifs = list.filter((n) => !seenIdsRef.current.has(n.id) && !n.is_read);
          newNotifs.forEach(handleNewNotification);
        }

        setNotifications(list);
        setUnreadCount(count);
        setAppBadge(count);

        // 첫 로드 시 최신 미읽음 한 건만 안내하고 나머지는 중복 방지용으로 기록한다.
        if (!initLoadedRef.current) {
          initLoadedRef.current = true;
          const unread = list.filter((n) => !n.is_read);
          const latest = unread[0];
          if (latest && !seenIdsRef.current.has(latest.id)) {
            showToast({
              id: latest.id,
              title: latest.title,
              body: latest.body || "",
              type: latest.type,
            });
          }
          unread.forEach((n) => markSeen(n.id));
        }
        return true;
      } catch {
        // 기존 정상 상태를 빈 목록/0/기본 설정으로 덮어쓰지 않는다.
        return false;
      } finally {
        syncInFlightRef.current = null;
      }
    })();

    syncInFlightRef.current = request;
    return request;
  }, [handleNewNotification, markSeen, showToast]);

  // 표시 이력 복원 — refresh(첫 로드 토스트) 보다 먼저 실행돼야
  // 재마운트 시 이전에 띄운 알림을 다시 토스트로 올리지 않는다.
  useEffect(() => {
    if (!userId) return;
    loadSeenToastIds(userId).forEach((id) => seenIdsRef.current.add(id));
  }, [userId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 최초 로드: 목록, 미읽음 수, 알림 설정을 각각 한 번 조회한다.
  useEffect(() => {
    void syncNotifications(true);
  }, [syncNotifications]);

  useEffect(() => {
    const onPreferencesChanged = (event: Event) => {
      const next = (event as CustomEvent<NotificationPreferences>).detail;
      if (next) {
        preferencesRef.current = next;
        preferencesLoadedRef.current = true;
        if (!next.enabled || !next.in_app_enabled) setToasts([]);
      } else {
        void fetchNotificationPreferences({ throwOnError: true })
          .then((preferences) => {
            if (!mountedRef.current) return;
            preferencesRef.current = preferences;
            preferencesLoadedRef.current = true;
            if (!preferences.enabled || !preferences.in_app_enabled) setToasts([]);
          })
          .catch(() => {});
      }
    };
    window.addEventListener("chflow:notification-preferences-changed", onPreferencesChanged);
    return () => window.removeEventListener("chflow:notification-preferences-changed", onPreferencesChanged);
  }, []);

  // Realtime 정상 시 5분 안전 동기화, 단절 시 10~60초 fallback polling.
  useEffect(() => {
    if (!userId) return;

    let realtimeSubscribed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fallbackDelay = NOTIFICATION_FALLBACK_INITIAL_MS;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (!mountedRef.current || document.visibilityState !== "visible") return;
      const delay = realtimeSubscribed ? NOTIFICATION_SAFETY_SYNC_MS : fallbackDelay;
      timer = setTimeout(async () => {
        const succeeded = await syncNotifications();
        if (!realtimeSubscribed) {
          fallbackDelay = nextNotificationFallbackDelay(fallbackDelay, succeeded);
        }
        schedule();
      }, delay);
    };

    const syncNowAndSchedule = async () => {
      clearTimer();
      if (document.visibilityState !== "visible") return;
      const succeeded = await syncNotifications();
      if (!realtimeSubscribed) {
        fallbackDelay = nextNotificationFallbackDelay(fallbackDelay, succeeded);
      }
      schedule();
    };

    const channel = supabase
      .channel(`notif:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotif = payload.new as Notification & { user_id: string };
          handleNewNotification(newNotif);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeSubscribed = true;
          fallbackDelay = NOTIFICATION_FALLBACK_INITIAL_MS;
          void syncNowAndSchedule();
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeSubscribed = false;
          fallbackDelay = NOTIFICATION_FALLBACK_INITIAL_MS;
          schedule();
        }
      });

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearTimer();
        return;
      }
      void syncNowAndSchedule();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [handleNewNotification, syncNotifications, userId]);

  const handleBellClick = async () => {
    const willOpen = !open;
    setOpen(willOpen);
    // 다시 켤 때마다 위치 초기화 (상단 화면 가운데 = 기본 위치)
    if (willOpen) setDragOffset({ x: 0, y: 0 });
    // 종을 누르면 모두 읽음 처리 + 배지 제거
    if (willOpen && unreadCount > 0) {
      await markAllRead();
      setUnreadCount(0);
      clearAppBadge();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    }
  };

  // === 패널 드래그 핸들러 (헤더 바를 잡고 이동) ===
  const handleDragStart = (e: React.PointerEvent) => {
    if (placement !== "dock") return;
    // 헤더 안의 버튼(전체삭제 등)을 누른 경우는 드래그 시작 안 함
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      baseX: dragOffset.x, baseY: dragOffset.y, dragging: true,
    };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const handleDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current.dragging) return;
    setDragOffset({
      x: dragRef.current.baseX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.baseY + (e.clientY - dragRef.current.startY),
    });
  };
  const handleDragEnd = (e: React.PointerEvent) => {
    dragRef.current.dragging = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const handleNotifClick = async (notif: Notification) => {
    if (!notif.is_read) {
      await markRead(notif.id);
    }
    setOpen(false);
    if (notif.link_url) {
      router.push(notif.link_url);
    }
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleDeleteNotif = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await deleteNotification(id);
    const newCount = await getUnreadCount();
    setUnreadCount(newCount);
    if (newCount === 0) clearAppBadge(); else setAppBadge(newCount);
  };

  const handleDeleteAll = async () => {
    setNotifications([]);
    setUnreadCount(0);
    clearAppBadge();
    await deleteAllNotifications();
  };

  return (
    <>
      {/* === 종 버튼 === */}
      <div style={{ position: "relative" }}>
        <button
          onClick={handleBellClick}
          title="알림"
          style={{
            position: "relative",
            width: 36,
            height: 36,
            borderRadius: 8,
            background: open ? "var(--accent-soft)" : "var(--bg)",
            border: "none",
            cursor: "pointer",
            color: open ? "var(--accent)" : "var(--ink-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Bell size={18} strokeWidth={1.75} />
          {unreadCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: -2,
                right: -2,
                minWidth: 18,
                height: 18,
                padding: "0 5px",
                borderRadius: 9,
                background: "var(--danger)",
                color: "#fff",
                fontSize: 10,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid var(--card)",
                boxSizing: "content-box",
              }}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {/* === 드롭다운 === */}
        {open && (
          <>
            <div
              onClick={() => setOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 60 }}
            />
            <div
              className="notif-dropdown"
              style={{
                position: "absolute",
                top: placement === "dock" ? undefined : 44,
                bottom: placement === "dock" ? 44 : undefined,
                right: 0,
                width: placement === "dock" ? 392 : 360,
                // dock(알림 센터)은 탭마다 내용 길이가 달라도 창 크기가 바뀌지 않도록 높이 고정
                // (짧은 화면에서만 뷰포트에 맞춰 줄어듦 — 탭 간에는 항상 동일)
                height: placement === "dock" ? "min(560px, calc(100dvh - 140px))" : undefined,
                maxHeight: placement === "dock" ? undefined : 480,
                background: "var(--surface)",
                borderRadius: 14,
                boxShadow: "0 20px 60px rgba(43,39,34,0.12)",
                border: "1px solid var(--hairline)",
                zIndex: 70,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                transform: (dragOffset.x || dragOffset.y)
                  ? `translate(${dragOffset.x}px, ${dragOffset.y}px)`
                  : undefined,
              }}
            >
              <div
                onPointerDown={handleDragStart}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid var(--hairline)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "var(--accent-soft)",
                  cursor: placement === "dock" ? "grab" : "default",
                  touchAction: placement === "dock" ? "none" : undefined,
                  userSelect: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--app-serif)", fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
                  <Bell size={16} strokeWidth={1.75} color="var(--accent)" /> {placement === "dock" ? "알림 센터" : "알림"}
                  {placement === "dock" && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-faint)" }}>
                      ({notifications.length}건)
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {activeTab !== "settings" && notifications.length > 0 && (
                    <button
                      onClick={handleDeleteAll}
                      style={{ fontSize: 11, color: "var(--ink-faint)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px", borderRadius: 4, fontFamily: "inherit" }}
                    >
                      전체삭제
                    </button>
                  )}
                  {placement === "dock" ? (
                    <button
                      onClick={() => setOpen(false)}
                      aria-label="알림 센터 닫기"
                      title="닫기"
                      style={{ width: 26, height: 26, borderRadius: 7, background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                    >
                      <X size={16} strokeWidth={2.2} />
                    </button>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
                      {unreadCount > 0 ? `안읽음 ${unreadCount}` : `${notifications.length}건`}
                    </span>
                  )}
                </div>
              </div>
              {placement === "dock" && (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: 6,
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--hairline)",
                  background: "color-mix(in srgb, var(--surface) 86%, transparent)",
                }}>
                  <PanelTabButton
                    label="알림"
                    count={tabCounts.all}
                    active={activeTab === "all"}
                    onClick={() => setActiveTab("all")}
                  />
                  <PanelTabButton
                    label="메시지"
                    count={tabCounts.message}
                    active={activeTab === "message"}
                    onClick={() => setActiveTab("message")}
                  />
                  <PanelTabButton
                    label="공지"
                    count={tabCounts.notice}
                    active={activeTab === "notice"}
                    onClick={() => setActiveTab("notice")}
                  />
                  <PanelTabButton
                    label="설정"
                    active={activeTab === "settings"}
                    onClick={() => setActiveTab("settings")}
                  />
                </div>
              )}
              {placement === "dock" && activeTab === "message" && (
                <div style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--hairline)",
                  background: "var(--surface)",
                }}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push("/messenger");
                    }}
                    style={{
                      width: "100%",
                      minHeight: 36,
                      border: "1px solid rgba(62, 90, 74, 0.24)",
                      borderRadius: 8,
                      background: "var(--accent)",
                      color: "#fff",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 12,
                      fontWeight: 800,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <MessagesSquare size={15} strokeWidth={2} /> 메신저 열기
                  </button>
                </div>
              )}
              <div style={{ overflowY: "auto", flex: 1 }}>
                {activeTab === "settings" ? (
                  <NotificationSettingsCard embedded />
                ) : visibleNotifications.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "40px 20px",
                      color: "var(--ink-faint)",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
                      <Bell size={28} strokeWidth={1.5} color="var(--ink-faint)" />
                    </div>
                    {getEmptyLabel(activeTab)}
                  </div>
                ) : (
                  visibleNotifications.map((n) => (
                    <SwipeableNotifRow key={n.id} onDismiss={(e) => handleDeleteNotif(e as unknown as React.MouseEvent, n.id)}>
                      <div
                        onClick={() => handleNotifClick(n)}
                        style={{
                          padding: "12px 14px 12px 18px",
                          borderBottom: "1px solid var(--hairline)",
                          cursor: "pointer",
                          background: n.is_read ? "var(--surface)" : "var(--accent-soft)",
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg)"; }}
                        onMouseOut={(e) => { e.currentTarget.style.background = n.is_read ? "var(--surface)" : "var(--accent-soft)"; }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                            <TypeChip type={n.type} />
                            {!n.is_read && <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--danger)", flexShrink: 0 }} />}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>{n.title}</div>
                          {n.body && <div style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.5 }}>{n.body}</div>}
                          <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 6 }}>{timeAgo(n.created_at)}</div>
                        </div>
                        <button
                          onClick={(e) => handleDeleteNotif(e, n.id)}
                          style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, background: "none", border: "none", cursor: "pointer", color: "var(--ink-faint)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 2 }}
                        >
                          <X size={13} strokeWidth={2.2} />
                        </button>
                      </div>
                    </SwipeableNotifRow>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* === 토스트 컨테이너 === */}
      <div className="toast-container-pc" style={pcToastContainerStyle}>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
        ))}
      </div>
      <div className="toast-container-mobile" style={mobileToastContainerStyle}>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} mobile />
        ))}
      </div>

    </>
  );
}

function PanelTabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 34,
        border: active ? "1px solid rgba(62, 90, 74, 0.28)" : "1px solid transparent",
        borderRadius: 9,
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--ink-soft)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 12,
        fontWeight: 800,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
      }}
    >
      <span>{label}</span>
      {count !== undefined && <span style={{
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? "rgba(62, 90, 74, 0.14)" : "rgba(43, 39, 34, 0.07)",
        fontSize: 10,
        fontWeight: 800,
      }}>
        {count > 99 ? "99+" : count}
      </span>}
    </button>
  );
}

// ============ Toast Card ============
function ToastCard({
  toast,
  onDismiss,
  mobile,
}: {
  toast: ToastNotification;
  onDismiss: () => void;
  mobile?: boolean;
}) {
  const meta = getNotificationTypeMeta(toast.type);
  const startXRef = useRef<number | null>(null);
  const swipeXRef = useRef(0);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    swipeXRef.current = 0;
    setSwiping(true);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null) return;
    const dx = e.touches[0].clientX - startXRef.current;
    swipeXRef.current = dx;
    setSwipeX(dx);
  };
  const handleTouchEnd = () => {
    const dx = swipeXRef.current;
    if (Math.abs(dx) > 72) { onDismiss(); return; }
    swipeXRef.current = 0;
    setSwipeX(0);
    setSwiping(false);
    startXRef.current = null;
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        background: meta.gradient,
        color: "#fff",
        borderRadius: mobile ? 0 : 14,
        padding: "14px 18px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        animation: mobile ? "toastSlideDown 0.4s ease" : "toastSlideInRight 0.4s ease",
        marginBottom: mobile ? 0 : 8,
        borderBottom: mobile ? "1px solid rgba(255,255,255,0.2)" : "none",
        transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
        opacity: swiping ? Math.max(0.3, 1 - Math.abs(swipeX) / 150) : 1,
        transition: swiping ? "none" : "transform 0.25s ease, opacity 0.25s ease",
        touchAction: "none",
      }}
    >
      <div style={{
        minWidth: 32,
        height: 32,
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(255,255,255,0.2)",
        fontSize: 12,
        fontWeight: 800,
        lineHeight: 1,
      }}>
        {meta.shortLabel}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 3 }}>
          {toast.title}
        </div>
        <div
          style={{
            fontSize: 11,
            opacity: 0.95,
            lineHeight: 1.5,
            wordBreak: "keep-all",
          }}
        >
          {toast.body}
        </div>
      </div>
      <button
        onClick={onDismiss}
        style={{
          background: "rgba(255,255,255,0.2)",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          width: 24,
          height: 24,
          borderRadius: 6,
          fontSize: 12,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <X size={12} strokeWidth={2.2} />
      </button>
    </div>
  );
}

// 알림 목록 아이템 스와이프 — 빨간 배경 + 휴지통 아이콘 + 방향 화살표
function SwipeableNotifRow({ children, onDismiss }: { children: React.ReactNode; onDismiss: (e: Event) => void }) {
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const swipeXRef = useRef(0);
  const [swipeX, setSwipeX] = useState(0);
  const [dir, setDir] = useState<"idle" | "h" | "v">("idle");
  const [exiting, setExiting] = useState(false);

  const THRESHOLD = 80;
  const absX = Math.abs(swipeX);
  const isPast = absX > THRESHOLD;
  const bgOpacity = dir === "h" ? Math.min(1, absX / THRESHOLD) : 0;

  const triggerDismiss = (e: Event) => {
    setExiting(true);
    setTimeout(() => onDismiss(e), 280);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (exiting) return;
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    swipeXRef.current = 0;
    setDir("idle");
    setSwipeX(0);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;
    const dx = e.touches[0].clientX - startXRef.current;
    const dy = e.touches[0].clientY - startYRef.current;
    if (dir === "v") return;
    if (dir === "idle") {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) { setDir("v"); return; }
      setDir("h");
    }
    swipeXRef.current = dx;
    setSwipeX(dx);
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (dir === "h" && Math.abs(swipeXRef.current) > THRESHOLD) {
      triggerDismiss(e.nativeEvent);
      return;
    }
    swipeXRef.current = 0;
    setSwipeX(0);
    setDir("idle");
    startXRef.current = null;
    startYRef.current = null;
  };

  const goingLeft = swipeX < 0;

  return (
    <div style={{ position: "relative", overflow: "hidden", maxHeight: exiting ? 0 : 200, transition: exiting ? "max-height 0.28s ease" : "none" }}>
      {/* 빨간 배경 */}
      {dir === "h" && (
        <div style={{
          position: "absolute", inset: 0,
          background: `rgba(220,38,38,${bgOpacity})`,
          display: "flex", alignItems: "center",
          justifyContent: goingLeft ? "flex-end" : "flex-start",
          padding: "0 20px", gap: 6,
          transition: "background 0.05s",
        }}>
          {!goingLeft && (
            <ChevronRight size={isPast ? 20 : 16} color="white" strokeWidth={2.5}
              style={{ transition: "all 0.15s", opacity: bgOpacity }} />
          )}
          <Trash2 size={isPast ? 20 : 17} color="white" strokeWidth={isPast ? 2.5 : 2}
            style={{ transition: "all 0.15s", opacity: bgOpacity }} />
          {goingLeft && (
            <ChevronLeft size={isPast ? 20 : 16} color="white" strokeWidth={2.5}
              style={{ transition: "all 0.15s", opacity: bgOpacity }} />
          )}
        </div>
      )}
      {/* 콘텐츠 */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: exiting
            ? `translateX(${goingLeft ? "-110%" : "110%"})`
            : dir === "h" && swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
          transition: exiting ? "transform 0.28s ease" : dir === "idle" ? "transform 0.2s ease" : "none",
          touchAction: dir === "h" ? "none" : "pan-y",
          background: "var(--surface)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function TypeChip({ type }: { type: string }) {
  const meta = getNotificationTypeMeta(type);
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      height: 20,
      padding: "0 7px",
      borderRadius: 999,
      background: meta.soft,
      color: meta.color,
      fontSize: 10,
      fontWeight: 800,
      lineHeight: 1,
      whiteSpace: "nowrap",
    }}>
      {meta.label}
    </span>
  );
}

function getNotificationTypeMeta(type: string) {
  if (type.startsWith("signup_")) {
    return {
      label: "회원",
      shortLabel: "회원",
      color: "var(--success)",
      soft: "var(--success-soft)",
      gradient: "linear-gradient(135deg, var(--success), var(--success))",
    };
  }
  if (type.startsWith("dept_")) {
    return {
      label: "부서",
      shortLabel: "부서",
      color: "var(--info)",
      soft: "var(--info-soft)",
      gradient: "linear-gradient(135deg, var(--info), var(--info))",
    };
  }
  if (type.startsWith("feedback_")) {
    return {
      label: "문의",
      shortLabel: "문의",
      color: "#6B4F8C",
      soft: "#EDE7F2",
      gradient: "linear-gradient(135deg, #6B4F8C, #57407A)",
    };
  }
  if (type.startsWith("notice_") || type === "notice") {
    return {
      label: "공지",
      shortLabel: "공지",
      color: "var(--warning)",
      soft: "var(--warning-soft)",
      gradient: "linear-gradient(135deg, var(--warning), var(--warning))",
    };
  }
  if (type.startsWith("message_") || type === "message") {
    return {
      label: "메시지",
      shortLabel: "톡",
      color: "var(--danger)",
      soft: "var(--danger-soft)",
      gradient: "linear-gradient(135deg, var(--danger), var(--danger))",
    };
  }
  return {
    label: "알림",
    shortLabel: "알림",
    color: "#3e5a4a",
    soft: "#eaeef0",
    gradient: "linear-gradient(135deg, #3e5a4a, #2f4638)",
  };
}

function getNotificationGroup(type: string): PanelTab | "alert" {
  if (type.startsWith("message_") || type === "message") return "message";
  if (type.startsWith("notice_") || type === "notice") return "notice";
  return "alert";
}

function getEmptyLabel(tab: PanelTab): string {
  if (tab === "message") return "메시지가 없습니다";
  if (tab === "notice") return "공지가 없습니다";
  if (tab === "settings") return "";
  return "알림이 없습니다";
}

// ============ Helpers ============
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "방금 전";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

const pcToastContainerStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 20,
  right: 20,
  zIndex: 100,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxWidth: 360,
  pointerEvents: "auto",
};

const mobileToastContainerStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 100,
  display: "none",  // 기본 none, 모바일 미디어쿼리로 flex
  flexDirection: "column",
  pointerEvents: "auto",
};

// 주의: display는 globals.css의 미디어 쿼리에서 제어함
// PC: .toast-container-pc display:flex (기본), .toast-container-mobile display:none
// Mobile: .toast-container-pc display:none !important, .toast-container-mobile display:flex !important
