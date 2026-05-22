"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const seedFlights = [
  { left: "45%", top: "43%", x: "72px", y: "-118px", mx: "22px", my: "-44px", rotate: "24deg", scale: 0.42, delay: "140ms", duration: "1180ms" },
  { left: "48%", top: "45%", x: "118px", y: "-94px", mx: "54px", my: "-34px", rotate: "-12deg", scale: 0.34, delay: "220ms", duration: "1220ms" },
  { left: "50%", top: "40%", x: "146px", y: "-152px", mx: "62px", my: "-62px", rotate: "36deg", scale: 0.3, delay: "300ms", duration: "1320ms" },
  { left: "43%", top: "47%", x: "44px", y: "-168px", mx: "8px", my: "-62px", rotate: "-26deg", scale: 0.28, delay: "370ms", duration: "1280ms" },
  { left: "52%", top: "48%", x: "170px", y: "-124px", mx: "86px", my: "-46px", rotate: "18deg", scale: 0.26, delay: "450ms", duration: "1380ms" },
  { left: "46%", top: "51%", x: "102px", y: "-196px", mx: "38px", my: "-84px", rotate: "44deg", scale: 0.22, delay: "540ms", duration: "1440ms" },
  { left: "53%", top: "44%", x: "198px", y: "-176px", mx: "96px", my: "-70px", rotate: "-18deg", scale: 0.2, delay: "610ms", duration: "1480ms" },
  { left: "40%", top: "49%", x: "70px", y: "-92px", mx: "18px", my: "-22px", rotate: "8deg", scale: 0.2, delay: "690ms", duration: "1160ms" },
];

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
    }, 1540);

    const navigateTimer = setTimeout(async () => {
      const path = await targetPath;
      if (!cancelled) {
        // /home must be the webview first entry for the TWA exit behavior.
        router.replace(path);
      }
    }, 1960);

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
        .seed-origin {
          position: absolute;
          inset: 50%;
          width: min(44vw, 202px);
          height: min(44vw, 202px);
          object-fit: contain;
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.92) rotate(-6deg);
          animation: originBreathe 1380ms 80ms cubic-bezier(.2,.88,.2,1) both;
        }
        .wind-seed {
          position: absolute;
          width: min(35vw, 148px);
          height: min(35vw, 148px);
          object-fit: contain;
          opacity: 0;
          transform: translate(-50%, -50%) scale(var(--scale)) rotate(-18deg);
          transform-origin: center;
          animation: seedLift var(--duration) var(--delay) cubic-bezier(.2,.78,.26,1) both;
        }
        .launch-tagline {
          margin-top: -30px;
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
        @keyframes originBreathe {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.86) rotate(-8deg); }
          18% { opacity: 0.86; }
          58% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(-4deg); }
          100% { opacity: 0.38; transform: translate(-50%, -50%) scale(1.035) rotate(-1deg); }
        }
        @keyframes seedLift {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(calc(var(--scale) * 0.82)) rotate(-22deg);
          }
          14% { opacity: 0.96; }
          46% {
            opacity: 1;
            transform:
              translate(calc(-50% + var(--mx)), calc(-50% + var(--my)))
              scale(var(--scale))
              rotate(calc(var(--rotate) * 0.42));
          }
          100% {
            opacity: 0;
            transform:
              translate(calc(-50% + var(--x)), calc(-50% + var(--y)))
              scale(calc(var(--scale) * 0.94))
              rotate(var(--rotate));
          }
        }
        @keyframes taglineIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .launch-splash,
          .corner-mark,
          .seed-origin,
          .wind-seed,
          .launch-tagline,
          .launch-sheen {
            animation: none !important;
            transition-duration: 1ms !important;
          }
          .seed-origin,
          .launch-tagline {
            opacity: 1;
          }
          .wind-seed {
            display: none;
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
            <img className="seed-origin" src="/launch-seed-origin.png" alt="" />
            {seedFlights.map((seed, index) => (
              <img
                key={`${seed.x}-${seed.y}-${index}`}
                className="wind-seed"
                src="/launch-seed.png"
                alt=""
                style={{
                  left: seed.left,
                  top: seed.top,
                  "--x": seed.x,
                  "--y": seed.y,
                  "--mx": seed.mx,
                  "--my": seed.my,
                  "--rotate": seed.rotate,
                  "--scale": seed.scale,
                  "--delay": seed.delay,
                  "--duration": seed.duration,
                } as React.CSSProperties}
              />
            ))}
          </div>
          <div className="launch-tagline">명성교회를 더 스마트하게</div>
        </div>
      </main>

    </div>
  );
}
