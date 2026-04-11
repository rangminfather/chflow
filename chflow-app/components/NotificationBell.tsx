"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  fetchNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  setAppBadge,
  clearAppBadge,
  type Notification,
} from "@/lib/notifications";

interface ToastNotification {
  id: string;
  title: string;
  body: string;
  type: string;
  createdAt: number;
}

export default function NotificationBell({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initLoadedRef = useRef(false);

  // 초기 로드
  useEffect(() => {
    refresh();
  }, []);

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
  }, [userId]);

  const handleNewNotification = (n: Notification) => {
    if (seenIdsRef.current.has(n.id)) return;

    showToast({
      id: n.id,
      title: n.title,
      body: n.body || "",
      type: n.type,
      createdAt: Date.now(),
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
  };

  const refresh = async () => {
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
            createdAt: Date.now(),
          });
        }
      }
    }
  };

  const showToast = (toast: ToastNotification) => {
    if (seenIdsRef.current.has(toast.id)) return;
    seenIdsRef.current.add(toast.id);
    setToasts((prev) => [...prev, toast]);
    // 5초 후 자동 제거
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 5000);
  };

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
            background: open ? "#eef2ff" : "#f1f5f9",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            color: "#475569",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          🔔
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
                background: "#ef4444",
                color: "#fff",
                fontSize: 10,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid #fff",
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
                top: 44,
                right: 0,
                width: 360,
                maxHeight: 480,
                background: "#fff",
                borderRadius: 14,
                boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
                border: "1px solid #e2e8f0",
                zIndex: 70,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#f8fafc",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 800, color: "#1e293b" }}>
                  🔔 알림
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  {notifications.length}건
                </div>
              </div>
              <div style={{ overflowY: "auto", flex: 1 }}>
                {notifications.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "40px 20px",
                      color: "#94a3b8",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                    알림이 없습니다
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleNotifClick(n)}
                      style={{
                        padding: "12px 18px",
                        borderBottom: "1px solid #f1f5f9",
                        cursor: "pointer",
                        background: n.is_read ? "#fff" : "#eff6ff",
                        transition: "background 0.15s",
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = "#f8fafc";
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = n.is_read ? "#fff" : "#eff6ff";
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#1e293b",
                          marginBottom: 4,
                        }}
                      >
                        {n.title}
                      </div>
                      {n.body && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#64748b",
                            lineHeight: 1.5,
                          }}
                        >
                          {n.body}
                        </div>
                      )}
                      <div
                        style={{ fontSize: 10, color: "#94a3b8", marginTop: 6 }}
                      >
                        {timeAgo(n.created_at)}
                      </div>
                    </div>
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
  const isApproved = toast.type === "signup_approved";
  const bg = isApproved
    ? "linear-gradient(135deg, #10b981, #059669)"
    : "linear-gradient(135deg, #6366f1, #8b5cf6)";

  return (
    <div
      style={{
        background: bg,
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
      }}
    >
      <div style={{ fontSize: 22, lineHeight: 1 }}>
        {isApproved ? "🎉" : "🔔"}
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
        }}
      >
        ✕
      </button>
    </div>
  );
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
