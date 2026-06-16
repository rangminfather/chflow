"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell, MessagesSquare, X } from "lucide-react";
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
  type Notification,
} from "@/lib/notifications";

interface ToastNotification {
  id: string;
  title: string;
  body: string;
  type: string;
}

type PanelTab = "all" | "message" | "notice";

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
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initLoadedRef = useRef(false);

  const tabCounts = useMemo(() => ({
    all: notifications.length,
    message: notifications.filter((n) => getNotificationGroup(n.type) === "message").length,
    notice: notifications.filter((n) => getNotificationGroup(n.type) === "notice").length,
  }), [notifications]);

  const visibleNotifications = useMemo(() => {
    if (activeTab === "all") return notifications;
    return notifications.filter((n) => getNotificationGroup(n.type) === activeTab);
  }, [activeTab, notifications]);

  const showToast = useCallback((toast: ToastNotification) => {
    if (seenIdsRef.current.has(toast.id)) return;
    seenIdsRef.current.add(toast.id);
    setToasts((prev) => [...prev, toast]);
    // 5초 후 자동 제거
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 5000);
  }, []);

  const handleNewNotification = useCallback((n: Notification) => {
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

  const refresh = useCallback(async () => {
    const [list, count] = await Promise.all([fetchNotifications(30), getUnreadCount()]);
    setNotifications(list);
    setUnreadCount(count);
    setAppBadge(count);

    // 첫 로드 시: 안 읽은 알림이 있으면 토스트로 표시 (최대 1개)
    if (!initLoadedRef.current) {
      initLoadedRef.current = true;
      const unread = list.filter((n) => !n.is_read);
      if (unread.length > 0) {
        const latest = unread[0];
        if (!seenIdsRef.current.has(latest.id)) {
          seenIdsRef.current.add(latest.id);
          showToast({
            id: latest.id,
            title: latest.title,
            body: latest.body || "",
            type: latest.type,
          });
        }
      }
    }
  }, [showToast]);

  // 초기 로드
  useEffect(() => {
    refresh();
  }, [refresh]);

  // === Realtime 구독 (즉시) + 폴링 백업 (10초마다) ===
  useEffect(() => {
    if (!userId) return;

    // 1. Realtime
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
      .subscribe();

    // 2. 폴링 백업 (10초마다 새 알림 확인 - Realtime이 안 작동할 때 대비)
    const pollInterval = setInterval(async () => {
      try {
        const list = await fetchNotifications(30);
        const newCount = await getUnreadCount();
        // 새 알림 감지: 기존에 보지 못한 ID
        const newNotifs = list.filter((n) => !seenIdsRef.current.has(n.id) && !n.is_read);
        for (const n of newNotifs) {
          handleNewNotification(n);
        }
        // 카운트와 목록 업데이트
        setNotifications(list);
        setUnreadCount(newCount);
        setAppBadge(newCount);
      } catch (e) {
        // ignore
      }
    }, 10000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [handleNewNotification, userId]);

  const handleBellClick = async () => {
    setOpen(!open);
    // 종을 누르면 모두 읽음 처리 + 배지 제거
    if (!open && unreadCount > 0) {
      await markAllRead();
      setUnreadCount(0);
      clearAppBadge();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    }
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
                maxHeight: placement === "dock" ? 560 : 480,
                background: "var(--surface)",
                borderRadius: 14,
                boxShadow: "0 20px 60px rgba(43,39,34,0.12)",
                border: "1px solid var(--hairline)",
                zIndex: 70,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid var(--hairline)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "var(--accent-soft)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--app-serif)", fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
                  <Bell size={16} strokeWidth={1.75} color="var(--accent)" /> {placement === "dock" ? "알림 센터" : "알림"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
                    {unreadCount > 0 ? `안읽음 ${unreadCount}` : `${notifications.length}건`}
                  </span>
                  {notifications.length > 0 && (
                    <button
                      onClick={handleDeleteAll}
                      style={{ fontSize: 11, color: "var(--ink-faint)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px", borderRadius: 4, fontFamily: "inherit" }}
                    >
                      전체삭제
                    </button>
                  )}
                </div>
              </div>
              {placement === "dock" && (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
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
                {visibleNotifications.length === 0 ? (
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
  count: number;
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
      <span style={{
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
      </span>
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

// 알림 목록 아이템 스와이프 — 방향 감지 후 수평이면 dismiss
function SwipeableNotifRow({ children, onDismiss }: { children: React.ReactNode; onDismiss: (e: Event) => void }) {
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const swipeXRef = useRef(0);
  const [swipeX, setSwipeX] = useState(0);
  const [dir, setDir] = useState<"idle" | "h" | "v">("idle");

  const onTouchStart = (e: React.TouchEvent) => {
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
    if (dir === "h" && Math.abs(swipeXRef.current) > 80) {
      onDismiss(e.nativeEvent);
      return;
    }
    swipeXRef.current = 0;
    setSwipeX(0);
    setDir("idle");
    startXRef.current = null;
    startYRef.current = null;
  };

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        transform: dir === "h" && swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
        opacity: dir === "h" ? Math.max(0.3, 1 - Math.abs(swipeX) / 150) : 1,
        transition: dir === "idle" ? "transform 0.25s ease, opacity 0.25s ease" : "none",
        touchAction: dir === "h" ? "none" : "pan-y",
      }}
    >
      {children}
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
