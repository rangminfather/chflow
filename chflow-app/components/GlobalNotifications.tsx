"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronsLeft, ChevronsRight, Headphones, LoaderCircle, MessagesSquare } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import FontScaleControl from "@/components/FontScaleControl";
import { supabase } from "@/lib/supabase";
import { openAdminHotline } from "@/lib/messenger";

const HIDDEN_PATH_PREFIXES = [
  "/login",
  "/signup",
  "/find-id",
  "/find-password",
  "/reset-password",
  "/messenger",
  "/admin/messenger-reports",
];

const COLLAPSED_STORAGE_KEY = "chflow-global-notification-dock-collapsed";

function getInitialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function GlobalNotifications() {
  const pathname = usePathname();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [hotlineOpening, setHotlineOpening] = useState(false);
  const [hotlineError, setHotlineError] = useState("");
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

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      try {
        if (next) {
          window.localStorage.setItem(COLLAPSED_STORAGE_KEY, "1");
        } else {
          window.localStorage.removeItem(COLLAPSED_STORAGE_KEY);
        }
      } catch {
        // 저장소가 차단된 환경에서는 현재 화면의 상태만 유지한다.
      }
      return next;
    });
  };

  const handleOpenHotline = async () => {
    if (hotlineOpening) return;
    setHotlineOpening(true);
    setHotlineError("");
    try {
      const { data: isOperator, error: operatorError } = await supabase.rpc("is_admin_hotline_operator");
      if (operatorError) throw operatorError;
      if (isOperator === true) {
        router.push("/messenger?hotline=inbox");
        return;
      }
      const conversationId = await openAdminHotline();
      router.push(`/messenger?c=${conversationId}`);
    } catch (error) {
      setHotlineError(error instanceof Error ? error.message : "관리자 핫라인을 열지 못했습니다.");
    } finally {
      setHotlineOpening(false);
    }
  };

  return (
    <div className="global-notification-dock" aria-live="polite">
      {hotlineError && !hidden && !collapsed && (
        <div role="alert" style={{ maxWidth: 230, padding: "8px 10px", borderRadius: 10, background: "var(--card)", border: "1px solid var(--hairline)", color: "var(--danger)", fontSize: 12, fontWeight: 700, boxShadow: "0 8px 24px rgba(43,39,34,0.14)" }}>
          {hotlineError}
        </div>
      )}
      {!hidden && (
        <button
          type="button"
          className={`global-notification-dock-toggle${collapsed ? " global-notification-dock-toggle-collapsed" : ""}`}
          onClick={toggleCollapsed}
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
          <button
            type="button"
            className="dock-hotline-button"
            onClick={handleOpenHotline}
            disabled={hotlineOpening}
            aria-label="관리자 핫라인 열기"
            aria-busy={hotlineOpening}
            title="관리자 핫라인"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "1px solid var(--accent-line)",
              background: "var(--accent-soft)",
              color: "var(--accent-strong)",
              boxShadow: "0 14px 34px rgba(43, 39, 34, 0.18)",
              cursor: hotlineOpening ? "wait" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: hotlineOpening ? 0.7 : 1,
            }}
          >
            {hotlineOpening
              ? <LoaderCircle size={20} strokeWidth={1.9} />
              : <Headphones size={20} strokeWidth={1.9} />}
          </button>
        </>
      )}
      <NotificationBell
        userId={userId}
        placement="dock"
        controlsVisible={!hidden && !collapsed}
        toastMode={hidden ? "ops" : "all"}
      />
    </div>
  );
}
