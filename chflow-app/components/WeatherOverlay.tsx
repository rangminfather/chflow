"use client";

import { useEffect, useState, useMemo } from "react";
import type { WeatherCondition } from "@/app/api/weather/route";

const CONFIG = {
  rain:   { count: 15, minDur: 2.2, maxDur: 1.2, angle: 8,  minW: 1.5, maxW: 0,   minH: 14, maxH: 14 },
  shower: { count: 38, minDur: 0.85, maxDur: 0.45, angle: 12, minW: 1.5, maxW: 0.8, minH: 16, maxH: 18 },
  snow:   { count: 30, minDur: 4,   maxDur: 5,   angle: 0,  minW: 4,   maxW: 6,   minH: 4,  maxH: 6  },
};

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export default function WeatherOverlay() {
  const [condition, setCondition] = useState<WeatherCondition | null>(null);

  useEffect(() => {
    fetch("/api/weather")
      .then((r) => r.json())
      .then((d) => setCondition(d.condition ?? "clear"))
      .catch(() => {});
  }, []);

  const particles = useMemo(() => {
    if (!condition || condition === "clear") return [];
    const cfg = CONFIG[condition];
    if (!cfg) return [];
    const rand = seeded(42);
    return Array.from({ length: cfg.count }, (_, i) => ({
      id: i,
      left:    rand() * 100,
      delay:   -(rand() * 5),
      dur:     cfg.minDur + rand() * cfg.maxDur,
      width:   cfg.minW + rand() * cfg.maxW,
      height:  cfg.minH + rand() * cfg.maxH,
      opacity: condition === "snow" ? 0.5 + rand() * 0.4 : 0.2 + rand() * 0.35,
    }));
  }, [condition]);

  if (!condition || condition === "clear" || particles.length === 0) return null;

  const isSnow = condition === "snow";
  const angle  = condition === "shower" ? 12 : 8;

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
      `}</style>
      <div
        aria-hidden="true"
        style={{
          position: "fixed", inset: 0, pointerEvents: "none",
          zIndex: 50, overflow: "hidden",
        }}
      >
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
