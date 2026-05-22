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
    }, 1200);

    const navigateTimer = setTimeout(async () => {
      const path = await targetPath;
      if (!cancelled) {
        // /home must be the webview first entry for the TWA exit behavior.
        router.replace(path);
      }
    }, 1680);

    return () => {
      cancelled = true;
      clearTimeout(exitTimer);
      clearTimeout(navigateTimer);
    };
  }, [router]);

  return (
    <div
      className={exiting ? "brand-splash brand-splash-exit" : "brand-splash"}
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        background: "#f3f6f8",
        color: "#0f172a",
        fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap"
        rel="stylesheet"
      />

      <style>{`
        .brand-splash {
          isolation: isolate;
          opacity: 1;
          transition: opacity 420ms ease, transform 420ms ease;
        }
        .brand-splash-exit {
          opacity: 0;
          transform: scale(1.015);
        }
        .brand-surface {
          position: absolute;
          inset: 0;
          background:
            repeating-linear-gradient(90deg, rgba(37, 99, 235, 0.06) 0 1px, transparent 1px 92px),
            repeating-linear-gradient(0deg, rgba(15, 118, 110, 0.05) 0 1px, transparent 1px 92px);
          -webkit-mask-image: radial-gradient(circle at center, black 0%, rgba(0, 0, 0, 0.96) 38%, transparent 82%);
          mask-image: radial-gradient(circle at center, black 0%, rgba(0, 0, 0, 0.96) 38%, transparent 82%);
          opacity: 0.9;
        }
        .brand-sheen {
          position: absolute;
          inset: -18%;
          background: linear-gradient(115deg, transparent 36%, rgba(255, 255, 255, 0.76) 49%, transparent 62%);
          transform: translateX(-52%);
          animation: brandSweep 1500ms cubic-bezier(.22,.85,.24,1) forwards;
        }
        .brand-mark {
          animation: brandRise 620ms cubic-bezier(.2,.9,.2,1) both;
        }
        .brand-name {
          animation: brandRise 620ms 90ms cubic-bezier(.2,.9,.2,1) both;
        }
        .brand-progress span {
          animation: brandFill 1180ms 180ms cubic-bezier(.2,.8,.2,1) both;
        }
        @keyframes brandRise {
          from { opacity: 0; transform: translateY(14px) scale(0.965); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes brandSweep {
          from { transform: translateX(-52%); }
          to { transform: translateX(52%); }
        }
        @keyframes brandFill {
          from { transform: scaleX(0); opacity: 0.24; }
          to { transform: scaleX(1); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .brand-splash,
          .brand-mark,
          .brand-name,
          .brand-progress span,
          .brand-sheen {
            animation: none !important;
            transition-duration: 1ms !important;
          }
        }
      `}</style>

      <div className="brand-surface" aria-hidden="true" />
      <div className="brand-sheen" aria-hidden="true" />

      <main
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <img
            className="brand-mark"
            src="/icon-192.png"
            alt="스마트명성"
            style={{
              width: 112,
              height: 112,
              borderRadius: 28,
              border: "1px solid rgba(255,255,255,0.92)",
              boxShadow: "0 22px 56px rgba(15,23,42,0.18)",
            }}
          />
          <div className="brand-name">
            <div
              style={{
                fontSize: 28,
                fontWeight: 900,
                color: "#1e293b",
                letterSpacing: 0,
                lineHeight: 1.2,
              }}
            >
              스마트명성
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "#64748b",
                marginTop: 4,
                letterSpacing: 0,
              }}
            >
              Smart Myungsung
            </div>
          </div>
          <div
            className="brand-progress"
            aria-hidden="true"
            style={{
              width: 118,
              height: 3,
              marginTop: 8,
              borderRadius: 999,
              background: "rgba(148,163,184,0.28)",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                borderRadius: "inherit",
                transformOrigin: "left center",
                background: "#2563eb",
              }}
            />
          </div>
        </div>
      </main>

    </div>
  );
}
