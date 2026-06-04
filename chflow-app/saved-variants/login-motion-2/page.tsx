"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const flyingSeeds = [
  { src: "seed-1.png", size: 76, delay: 220, dur: 1120, sx: 8, sy: 8, ex: 86, ey: -22, r0: -28, r1: 44, scale: 0.9 },
  { src: "seed-2.png", size: 68, delay: 280, dur: 1180, sx: 2, sy: 34, ex: 134, ey: 4, r0: -14, r1: 78, scale: 0.8 },
  { src: "seed-3.png", size: 70, delay: 340, dur: 1220, sx: -4, sy: 64, ex: 118, ey: 52, r0: 6, r1: 96, scale: 0.76 },
  { src: "seed-4.png", size: 64, delay: 410, dur: 1160, sx: 12, sy: 92, ex: 188, ey: 86, r0: 18, r1: 132, scale: 0.72 },
  { src: "seed-5.png", size: 82, delay: 470, dur: 1260, sx: 18, sy: -14, ex: 226, ey: -48, r0: -36, r1: 60, scale: 0.76 },
  { src: "seed-1.png", size: 60, delay: 540, dur: 1140, sx: 30, sy: 44, ex: 238, ey: 28, r0: 22, r1: 124, scale: 0.68 },
  { src: "seed-2.png", size: 56, delay: 620, dur: 1080, sx: 20, sy: 78, ex: 206, ey: 112, r0: -6, r1: 88, scale: 0.64 },
  { src: "seed-3.png", size: 58, delay: 700, dur: 1120, sx: 42, sy: 18, ex: 266, ey: -6, r0: -18, r1: 116, scale: 0.62 },
  { src: "seed-4.png", size: 54, delay: 780, dur: 1060, sx: 34, sy: 112, ex: 258, ey: 92, r0: 10, r1: 148, scale: 0.6 },
  { src: "seed-5.png", size: 62, delay: 840, dur: 1100, sx: 56, sy: -2, ex: 286, ey: -48, r0: -30, r1: 92, scale: 0.6 },
];

function seedStyle(seed: (typeof flyingSeeds)[number]): CSSProperties {
  return {
    "--seed-size": `${seed.size}px`,
    "--seed-delay": `${seed.delay}ms`,
    "--seed-duration": `${seed.dur}ms`,
    "--seed-sx": `${seed.sx}px`,
    "--seed-sy": `${seed.sy}px`,
    "--seed-ex": `${seed.ex}px`,
    "--seed-ey": `${seed.ey}px`,
    "--seed-r0": `${seed.r0}deg`,
    "--seed-r1": `${seed.r1}deg`,
    "--seed-scale": `${seed.scale}`,
  } as CSSProperties;
}

export default function SplashPage() {
  const router = useRouter();
  const [exiting, setExiting] = useState(false);
  const [previewRun, setPreviewRun] = useState(0);

  useEffect(() => {
    if (window.location.search.includes("splashPreview=1")) {
      const replayTimer = setInterval(() => {
        setPreviewRun((run) => run + 1);
      }, 2600);

      return () => clearInterval(replayTimer);
    }

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
    }, 1920);

    const navigateTimer = setTimeout(async () => {
      const path = await targetPath;
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
  }, [router]);

  return (
    <div
      className={[
        "launch-splash",
        exiting ? "launch-splash-exit" : "",
      ].filter(Boolean).join(" ")}
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
          transition: opacity 180ms ease;
        }
        .launch-splash-exit {
          opacity: 0;
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
          animation: launchSweep 470ms cubic-bezier(.22,.85,.24,1) forwards;
        }
        .corner-mark {
          animation: cornerIn 300ms 50ms cubic-bezier(.2,.9,.2,1) both;
        }
        .seed-scene {
          position: relative;
          width: min(112vw, 560px);
          height: clamp(300px, 86vw, 430px);
          overflow: visible;
        }
        .launch-wind {
          position: absolute;
          z-index: 1;
          top: 26%;
          left: 24%;
          width: 86%;
          height: 34%;
          opacity: 0;
          transform: translate3d(-56px, 0, 0) skewX(-12deg);
          background:
            linear-gradient(10deg, transparent 4%, rgba(255, 255, 255, 0.72) 5%, transparent 20%),
            linear-gradient(8deg, transparent 24%, rgba(255, 255, 255, 0.58) 25%, transparent 38%),
            linear-gradient(12deg, transparent 48%, rgba(255, 255, 255, 0.48) 49%, transparent 60%);
          filter: blur(1px);
          mix-blend-mode: screen;
          pointer-events: none;
          animation: windSweep 780ms 260ms cubic-bezier(.18,.82,.22,1) both;
        }
        .launch-dandelion-head {
          position: absolute;
          z-index: 2;
          left: clamp(18px, 8vw, 70px);
          bottom: -2px;
          width: clamp(160px, 42vw, 222px);
          height: auto;
          object-fit: contain;
          opacity: 0;
          backface-visibility: hidden;
          transform: translate3d(-18px, 18px, 0) scale(0.92) rotate(-7deg);
          transform-origin: 48% 84%;
          will-change: opacity, transform, filter;
          animation: dandelionHeadIn 720ms 80ms cubic-bezier(.17,.84,.2,1) both;
        }
        .launch-seed-field {
          position: absolute;
          z-index: 3;
          left: clamp(112px, 29vw, 190px);
          top: clamp(118px, 34vw, 162px);
          width: 1px;
          height: 1px;
          overflow: visible;
        }
        .launch-seed {
          position: absolute;
          left: 0;
          top: 0;
          width: var(--seed-size);
          max-width: none;
          height: auto;
          display: block;
          opacity: 0;
          backface-visibility: hidden;
          transform-origin: 48% 68%;
          filter: drop-shadow(0 1px 3px rgba(125, 97, 65, 0.12));
          will-change: opacity, transform, filter;
          animation: seedFly var(--seed-duration) var(--seed-delay) cubic-bezier(.14,.76,.2,1) both;
        }
        .launch-tagline {
          margin-top: clamp(-22px, -5vw, -10px);
          font-size: clamp(21px, 5.6vw, 28px);
          font-weight: 800;
          line-height: 1.25;
          letter-spacing: 0;
          color: #49382f;
          opacity: 0;
          text-shadow: 0 2px 16px rgba(255, 249, 242, 0.96);
          animation: taglineIn 320ms 860ms cubic-bezier(.2,.9,.2,1) both;
        }
        @keyframes cornerIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.92); }
          to { opacity: 0.74; transform: translateY(0) scale(1); }
        }
        @keyframes launchSweep {
          from { transform: translateX(-52%); }
          to { transform: translateX(52%); }
        }
        @keyframes dandelionHeadIn {
          0% {
            opacity: 0;
            filter: blur(3px);
            transform: translate3d(-18px, 18px, 0) scale(0.92) rotate(-7deg);
          }
          34% {
            opacity: 1;
          }
          100% {
            opacity: 0.98;
            filter: blur(0);
            transform: translate3d(0, 0, 0) scale(1) rotate(0deg);
          }
        }
        @keyframes seedFly {
          0% {
            opacity: 0;
            filter: blur(5px);
            transform: translate3d(var(--seed-sx), var(--seed-sy), 0) scale(0.18) rotate(var(--seed-r0));
          }
          12% {
            opacity: 0;
          }
          28% {
            opacity: 1;
            filter: blur(1px);
          }
          72% {
            opacity: 0.96;
          }
          100% {
            opacity: 0.78;
            filter: blur(0);
            transform: translate3d(var(--seed-ex), var(--seed-ey), 0) scale(var(--seed-scale)) rotate(var(--seed-r1));
          }
        }
        @keyframes windSweep {
          0% {
            opacity: 0;
            transform: translate3d(-72px, 0, 0) skewX(-12deg);
          }
          32% {
            opacity: 0.72;
          }
          100% {
            opacity: 0;
            transform: translate3d(86px, -10px, 0) skewX(-12deg);
          }
        }
        @keyframes taglineIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .launch-splash,
          .corner-mark,
          .launch-wind,
          .launch-dandelion-head,
          .launch-seed,
          .launch-tagline,
          .launch-sheen {
            animation: none !important;
            transition-duration: 1ms !important;
          }
          .launch-dandelion-head,
          .launch-seed,
          .launch-tagline {
            opacity: 1;
          }
          .launch-dandelion-head {
            transform: translate3d(0, 0, 0) scale(1) rotate(0deg);
          }
          .launch-seed {
            transform: translate3d(var(--seed-ex), var(--seed-ey), 0) scale(var(--seed-scale)) rotate(var(--seed-r1));
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
          <div key={previewRun} className="seed-scene" aria-hidden="true">
            <div className="launch-wind" aria-hidden="true" />
            <img className="launch-dandelion-head" src="/launch-dandelion-sprites/dandelion-head.png" alt="" />
            <div className="launch-seed-field" aria-hidden="true">
              {flyingSeeds.map((seed, index) => (
                <img
                  key={`${seed.src}-${index}`}
                  className="launch-seed"
                  src={`/launch-dandelion-sprites/${seed.src}`}
                  alt=""
                  style={seedStyle(seed)}
                />
              ))}
            </div>
          </div>
          <div className="launch-tagline">명성교회를 더 스마트하게</div>
        </div>
      </main>

    </div>
  );
}
