"use client";

import { useEffect, useState, useMemo } from "react";
import type { WeatherCondition } from "@/app/api/weather/route";
import { useWeatherEffect } from "@/lib/useWeatherEffect";

const CONFIG = {
  rain:         { count: 16, minDur: 1.2, durSpan: 1.0, minW: 1.5, wSpan: 0,   minH: 14, hSpan: 6 },
  shower:       { count: 40, minDur: 0.55, durSpan: 0.4, minW: 1.5, wSpan: 0.8, minH: 16, hSpan: 8 },
  thunderstorm: { count: 46, minDur: 0.5, durSpan: 0.35, minW: 1.8, wSpan: 0.9, minH: 18, hSpan: 8 },
  snow:         { count: 30, minDur: 4,   durSpan: 5,   minW: 4,   wSpan: 6,   minH: 4,  hSpan: 6 },
} as const;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export default function WeatherOverlay() {
  const [condition, setCondition] = useState<WeatherCondition | null>(null);
  const [reduced, setReduced] = useState(false);
  // 사이드바의 "날씨 반영" 스위치 — OFF 면 조회도 하지 않고 아무것도 그리지 않음
  const { enabled } = useWeatherEffect();

  // 날씨 조회 — 마운트 시 + 10분 주기 + 앱 복귀(포커스) 시
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      fetch("/api/weather")
        .then((r) => r.json())
        .then((d) => { if (alive) setCondition(d.condition ?? "clear"); })
        .catch(() => {});
    load();
    const iv = setInterval(load, 10 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [enabled]);

  // 접근성: 모션 최소화 설정이면 번개 플래시 생략
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(m.matches);
    apply();
    m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, []);

  const particles = useMemo(() => {
    if (!condition || condition === "clear") return [];
    const cfg = CONFIG[condition as keyof typeof CONFIG];
    if (!cfg) return [];
    const rand = seeded(42);
    return Array.from({ length: cfg.count }, (_, i) => ({
      id: i,
      left:    rand() * 100,
      delay:   -(rand() * 5),
      dur:     cfg.minDur + rand() * cfg.durSpan,
      width:   cfg.minW + rand() * cfg.wSpan,
      height:  cfg.minH + rand() * cfg.hSpan,
      opacity: condition === "snow" ? 0.5 + rand() * 0.4 : 0.2 + rand() * 0.35,
    }));
  }, [condition]);

  if (!enabled) return null;
  if (!condition || condition === "clear" || particles.length === 0) return null;

  const isSnow = condition === "snow";
  const isThunder = condition === "thunderstorm";
  const angle = condition === "rain" ? 8 : 12; // 소나기·뇌우는 좀 더 사선

  return (
    <>
      <style>{`
        @keyframes fall-rain {
          0%   { transform: translateY(-10px) rotate(${angle}deg); opacity: 0; }
          5%   { opacity: 1; }
          90%  { opacity: 0.6; }
          100% { transform: translateY(100vh) rotate(${angle}deg); opacity: 0; }
        }
        @keyframes fall-snow {
          0%   { transform: translateY(-20px) translateX(0); opacity: 0; }
          10%  { opacity: 1; }
          50%  { transform: translateY(50vh) translateX(12px); }
          90%  { opacity: 0.7; }
          100% { transform: translateY(105vh) translateX(0); opacity: 0; }
        }
        /* 번개 섬광 — 두 겹을 서로 다른 주기로 돌려 불규칙한 뇌우 리듬 */
        @keyframes storm-flash {
          0%, 91%, 100% { opacity: 0; }
          92%   { opacity: 0.6; }
          93.5% { opacity: 0.12; }
          95%   { opacity: 0.68; }
          97%   { opacity: 0; }
        }
        /* 실제 낙뢰 줄기 — 섬광과 동기 */
        @keyframes storm-bolt {
          0%, 91%, 100% { opacity: 0; }
          92%   { opacity: 1; }
          93.5% { opacity: 0.15; }
          95%   { opacity: 0.95; }
          97%   { opacity: 0; }
        }
      `}</style>
      <div
        aria-hidden="true"
        style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 50, overflow: "hidden" }}
      >
        {isThunder && (
          <>
            {/* 폭풍 먹구름 틴트 — 위쪽을 어둑하게 깔아 번개가 도드라지게 (모션 무관, 항상) */}
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(to bottom, rgba(16,20,36,0.34), rgba(16,20,36,0.05) 45%, transparent 70%)",
            }} />
            {!reduced && (
              <>
                {/* 은은한 배경 섬광(주기 5.5s) + 강한 스트라이크 섬광(주기 8.7s) → 합쳐져 불규칙 */}
                <div style={{
                  position: "absolute", inset: 0,
                  background: "radial-gradient(ellipse at 62% 0%, #eef4ff, #c7d8ff)",
                  animation: "storm-flash 5.5s ease-out infinite",
                }} />
                <div style={{
                  position: "absolute", inset: 0,
                  background: "radial-gradient(ellipse at 30% 5%, #ffffff, transparent 68%)",
                  animation: "storm-flash 8.7s ease-out infinite 2s",
                }} />
                {/* 낙뢰 줄기(스트라이크 섬광과 동기) */}
                <svg
                  viewBox="0 0 100 300" preserveAspectRatio="none"
                  style={{
                    position: "absolute", top: 0, left: "56%",
                    width: 70, height: "60%",
                    filter: "drop-shadow(0 0 7px #dbe9ff) drop-shadow(0 0 16px #9cc0ff)",
                    animation: "storm-bolt 8.7s ease-out infinite 2s",
                  }}
                >
                  <polyline
                    points="56,0 40,88 64,88 30,190 52,190 22,300"
                    fill="none" stroke="#f2f7ff" strokeWidth="3.4"
                    strokeLinejoin="round" strokeLinecap="round"
                  />
                </svg>
              </>
            )}
          </>
        )}
        {particles.map((p) =>
          isSnow ? (
            <div key={p.id} style={{
              position: "absolute",
              left: `${p.left}%`, top: 0,
              width: `${p.height}px`, height: `${p.height}px`,
              borderRadius: "50%",
              background: "#e8f0fe",
              opacity: p.opacity,
              animation: `fall-snow ${p.dur}s ${p.delay}s ease-in-out infinite`,
            }} />
          ) : (
            <div key={p.id} style={{
              position: "absolute",
              left: `${p.left}%`, top: 0,
              width: `${p.width}px`, height: `${p.height}px`,
              borderRadius: "2px",
              background: "linear-gradient(to bottom, transparent, #7ab3e0, #4a90d9)",
              opacity: p.opacity,
              animation: `fall-rain ${p.dur}s ${p.delay}s linear infinite`,
            }} />
          )
        )}
      </div>
    </>
  );
}
