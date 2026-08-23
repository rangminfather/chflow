"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronsLeft, ChevronsRight, MessagesSquare } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import FontScaleControl from "@/components/FontScaleControl";
import { supabase } from "@/lib/supabase";

const HIDDEN_PATH_PREFIXES = [
  "/login",
  "/signup",
  "/find-id",
  "/find-password",
  "/reset-password",
  "/messenger",
  "/admin/messenger-reports",
];

export default function GlobalNotifications() {
  const pathname = usePathname();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const hidden = useMemo(
    () =>
      HIDDEN_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix)) ||
      // 주보 보기 화면(메인/부서)에서는 종 숨김
      !!pathname?.endsWith("/bulletin") ||
      // 달란트통장·내반출결 화면에서는 도크(가·메신저·종) 전체 숨김
      !!pathname?.endsWith("/talent") ||
      !!pathname?.endsWith("/my-class-attendance"),
    [pathname]
  );

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUserId(data.session?.user.id ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // 일일 방문 기록 — 홈뿐 아니라 어떤 경로(푸시 딥링크·즐겨찾기)로 들어와도 집계.
  // KST 날짜가 바뀔 때만 호출 (RPC 자체도 하루 1회 upsert라 중복 무해)
  const lastVisitLogRef = useRef("");
  useEffect(() => {
    if (!userId) return;
    const logVisit = () => {
      const kstDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      if (lastVisitLogRef.current === kstDate) return;
      lastVisitLogRef.current = kstDate;
      supabase.rpc("log_daily_visit").then(() => {});
    };
    logVisit();
    const onVisible = () => {
      if (document.visibilityState === "visible") logVisit();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId]);

  if (!userId) return null;

  return (
    <div className="global-notification-dock" aria-live="polite">
      {!hidden && (
        <button
          type="button"
          className={`global-notification-dock-toggle${collapsed ? " global-notification-dock-toggle-collapsed" : ""}`}
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "도움 메뉴 열기" : "도움 메뉴 접기"}
          title={collapsed ? "도움 메뉴 열기" : "도움 메뉴 접기"}
        >
          {collapsed
            ? <ChevronsLeft size={16} strokeWidth={2.2} />
            : <ChevronsRight size={16} strokeWidth={2.2} />}
        </button>
      )}
      {!hidden && !collapsed && (
        <>
          <FontScaleControl />
          <button
            type="button"
            className="dock-messenger-button"
            onClick={() => router.push("/messenger")}
            aria-label="메신저 열기"
            title="메신저"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "1px solid rgba(43, 39, 34, 0.1)",
              background: "var(--surface)",
              color: "var(--accent-strong)",
              boxShadow: "0 14px 34px rgba(43, 39, 34, 0.18)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MessagesSquare size={20} strokeWidth={1.9} />
          </button>
        </>
      )}
      <NotificationBell
        userId={userId}
        placement="dock"
        controlsVisible={!hidden && !collapsed}
        toastsVisible={!hidden}
      />
    </div>
  );
}
