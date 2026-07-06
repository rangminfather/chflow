"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const DANDELION_SRC = "/launch-dandelion.webp";

export default function SplashPage() {
  const router = useRouter();
  // ready: 민들레 이미지 로드 완료 → 그때부터 모션 시작 (느린 네트워크에서 모션 스킵 방지)
  const [ready, setReady] = useState(false);
  const [exiting, setExiting] = useState(false);
  const targetPathRef = useRef<Promise<string> | null>(null);

  // 세션 확인은 마운트 즉시 시작 (이미지 로드와 병렬)
  useEffect(() => {
    targetPathRef.current = (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return "/login";

      const { data } = await supabase.rpc("get_my_status");
      const profile = data?.[0];
      return profile?.status === "active" ? "/home" : "/login?notice=pending";
    })();

    let cancelled = false;
    const img = new Image();
    const start = () => { if (!cancelled) setReady(true); };
    img.onload = start;
    img.onerror = start;
    img.src = DANDELION_SRC;
    if (img.complete) start();
    // 이미지가 끝내 안 오더라도 스플래시에 갇히지 않도록 안전장치
    const fallback = setTimeout(start, 3000);

    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, []);

  // 모션이 실제로 시작된 시점 기준으로 전환 타이머 가동 → 로딩이 느려도 모션은 끝까지 재생
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const exitTimer = setTimeout(() => {
      if (!cancelled) setExiting(true);
    }, 1920);

    const navigateTimer = setTimeout(async () => {
      const path = await (targetPathRef.current ?? Promise.resolve("/login"));
      if (!cancelled) {
        // Keep /home as the WebView first entry so the native mobile shell owns root-exit handling.
        router.replace(path);
      }
    }, 2100);

    return () => {
      cancelled = true;
      clearTimeout(exitTimer);
      clearTimeout(navigateTimer);
    };
  }, [ready, router]);

  return (
    <div
      className={exiting ? "launch-splash launch-splash-exit" : "launch-splash"}
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        // 스플래시(민들레)는 다크모드에서도 항상 라이트 유지 — 사용자 확정 정책
        background: "var(--paper)",
        color: "#342a27",
        fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
      }}
    >
      <style>{`
        .launch-splash {
          isolation: isolate;
          opacity: 1;
          transition: opacity 180ms ease;
        }
        .launch-splash-exit {
          opacity: 0;
        }
        .launch-surface {
          position: absolute;
          inset: 0;
          /* 다크모드 토큰 반전 제외 — 스플래시는 항상 라이트 (라이트 토큰 원값 고정) */
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.62), transparent 42%),
            linear-gradient(180deg, #FBF8F1 0%, #F5F1E8 100%);
        }
        .launch-sheen {
          position: absolute;
          inset: -18%;
          background: linear-gradient(118deg, transparent 35%, rgba(255, 255, 255, 0.84) 49%, transparent 64%);
          transform: translateX(-52%);
          animation: launchSweep 470ms cubic-bezier(.22,.85,.24,1) forwards;
        }
        .corner-mark {
          animation: cornerIn 300ms 50ms cubic-bezier(.2,.9,.2,1) both;
        }
        .seed-scene {
          position: relative;
          width: min(78vw, 360px);
          height: min(78vw, 360px);
        }
        .launch-dandelion {
          position: absolute;
          inset: 50%;
          width: min(78vw, 312px);
          height: min(78vw, 312px);
          object-fit: contain;
          opacity: 0;
          backface-visibility: hidden;
          transform: translate3d(-50%, -50%, 0) scale(0.3) rotate(-32deg);
          transform-origin: 46% 54%;
          will-change: opacity, transform;
          animation:
            dandelionBloom 610ms 20ms cubic-bezier(.42,.02,.16,1) both,
            dandelionVeil 610ms 20ms linear both;
        }
        .launch-tagline {
          margin-top: -18px;
          font-size: clamp(19px, 5.1vw, 24px);
          font-weight: 800;
          line-height: 1.25;
          letter-spacing: 0;
          color: #49382f;
          opacity: 0;
          text-shadow: 0 2px 16px rgba(255, 249, 242, 0.96);
          animation: taglineIn 140ms 550ms cubic-bezier(.2,.9,.2,1) both;
        }
        @keyframes cornerIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.92); }
          to { opacity: 0.74; transform: translateY(0) scale(1); }
        }
        @keyframes launchSweep {
          from { transform: translateX(-52%); }
          to { transform: translateX(52%); }
        }
        @keyframes dandelionBloom {
          from { transform: translate3d(-50%, -50%, 0) scale(0.3) rotate(-32deg); }
          to { transform: translate3d(-50%, -50%, 0) scale(4.5) rotate(18deg); }
        }
        @keyframes dandelionVeil {
          0% { opacity: 0; }
          10% { opacity: 1; }
          66% { opacity: 1; }
          84% { opacity: 0.82; }
          100% { opacity: 0.42; }
        }
        @keyframes taglineIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .launch-splash,
          .corner-mark,
          .launch-dandelion,
          .launch-tagline,
          .launch-sheen {
            animation: none !important;
            transition-duration: 1ms !important;
          }
          .launch-dandelion,
          .launch-tagline {
            opacity: 1;
          }
        }
      `}</style>

      <div className="launch-surface" aria-hidden="true" />
      {ready && (
        <>
          <div className="launch-sheen" aria-hidden="true" />
          <img
            className="corner-mark"
            src="/brand-mark-192.png"
            alt=""
            aria-hidden="true"
            style={{
              position: "absolute",
              zIndex: 1,
              top: 24,
              right: 20,
              width: 38,
              height: 38,
              borderRadius: 10,
              boxShadow: "0 10px 28px rgba(58, 35, 25, 0.08)",
            }}
          />

          <main
            style={{
              position: "relative",
              zIndex: 1,
              minHeight: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                pointerEvents: "none",
              }}
            >
              <div className="seed-scene" aria-hidden="true">
                <img className="launch-dandelion" src={DANDELION_SRC} alt="" />
              </div>
              <div className="launch-tagline">명성교회를 더 스마트하게</div>
            </div>
          </main>
        </>
      )}

    </div>
  );
}
