"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SplashPage() {
  const router = useRouter();
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const targetPath = (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return "/login";

      const { data } = await supabase.rpc("get_my_status");
      const profile = data?.[0];
      return profile?.status === "active" ? "/home" : "/login?notice=pending";
    })();

    const exitTimer = setTimeout(() => {
      if (!cancelled) setExiting(true);
    }, 2040);

    const navigateTimer = setTimeout(async () => {
      const path = await targetPath;
      if (!cancelled) {
        // /home must be the webview first entry for the TWA exit behavior.
        router.replace(path);
      }
    }, 2460);

    return () => {
      cancelled = true;
      clearTimeout(exitTimer);
      clearTimeout(navigateTimer);
    };
  }, [router]);

  return (
    <div
      className={exiting ? "launch-splash launch-splash-exit" : "launch-splash"}
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        background: "#fff9f2",
        color: "#342a27",
        fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap"
        rel="stylesheet"
      />

      <style>{`
        .launch-splash {
          isolation: isolate;
          opacity: 1;
          transition: opacity 420ms ease, transform 420ms ease, filter 420ms ease;
        }
        .launch-splash-exit {
          opacity: 0;
          transform: scale(1.018);
          filter: saturate(1.03) brightness(1.02);
        }
        .launch-surface {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.62), transparent 42%),
            linear-gradient(180deg, #fffaf5 0%, #fff7ee 100%);
        }
        .launch-sheen {
          position: absolute;
          inset: -18%;
          background: linear-gradient(118deg, transparent 35%, rgba(255, 255, 255, 0.84) 49%, transparent 64%);
          transform: translateX(-52%);
          animation: launchSweep 1740ms cubic-bezier(.22,.85,.24,1) forwards;
        }
        .corner-mark {
          animation: cornerIn 720ms 120ms cubic-bezier(.2,.9,.2,1) both;
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
          transform: translate(-50%, -50%) scale(0.9) rotate(-6deg);
          transform-origin: 46% 54%;
          will-change: opacity, transform, filter;
          animation: dandelionSpread 2140ms 80ms both;
        }
        .launch-tagline {
          margin-top: -18px;
          font-size: clamp(19px, 5.1vw, 24px);
          font-weight: 800;
          line-height: 1.25;
          letter-spacing: 0;
          color: #49382f;
          opacity: 0;
          animation: taglineIn 860ms 540ms cubic-bezier(.2,.9,.2,1) both;
        }
        @keyframes cornerIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.92); }
          to { opacity: 0.74; transform: translateY(0) scale(1); }
        }
        @keyframes launchSweep {
          from { transform: translateX(-52%); }
          to { transform: translateX(52%); }
        }
        @keyframes dandelionSpread {
          0% {
            opacity: 0;
            filter: blur(2px);
            transform: translate(-50%, -50%) scale(0.84) rotate(-8deg);
            animation-timing-function: cubic-bezier(.12,.82,.18,1);
          }
          18% {
            opacity: 1;
            filter: blur(0);
            transform: translate(-50%, -50%) scale(1.025) rotate(-1.6deg);
            animation-timing-function: cubic-bezier(.14,.72,.24,1);
          }
          48% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1.012) rotate(-0.35deg);
            animation-timing-function: cubic-bezier(.2,.75,.28,1);
          }
          74% {
            opacity: 0.98;
            transform: translate(-50%, -50%) scale(1) rotate(0deg);
          }
          100% {
            opacity: 0.98;
            filter: blur(0);
            transform: translate(-50%, -50%) scale(1) rotate(0deg);
          }
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
            <img className="launch-dandelion" src="/launch-dandelion.png" alt="" />
          </div>
          <div className="launch-tagline">명성교회를 더 스마트하게</div>
        </div>
      </main>

    </div>
  );
}
