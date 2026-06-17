"use client";

import { useEffect, useState, useMemo } from "react";
import type { WeatherCondition } from "@/app/api/weather/route";

const PARTICLE_COUNT = { rain: 45, snow: 30, cloud: 5 };

function seeded(seed: number) {
  // 단순 LCG — Math.random() 대신 결정론적 난수
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
    const count = PARTICLE_COUNT[condition] ?? 0;
    const rand = seeded(42);
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: rand() * 100,
      delay: rand() * 4,
      duration: condition === "rain" ? 0.6 + rand() * 0.4 : 3 + rand() * 4,
      size: condition === "rain" ? 1 + rand() * 1 : condition === "snow" ? 4 + rand() * 6 : 60 + rand() * 80,
      opacity: condition === "cloud" ? 0.06 + rand() * 0.06 : 0.25 + rand() * 0.25,
      top: condition === "cloud" ? rand() * 60 : undefined,
    }));
  }, [condition]);

  if (!condition || condition === "clear" || particles.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes fall-rain {
          0%   { transform: translateY(-10px) scaleY(1); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 0.8; }
          100% { transform: translateY(100vh) scaleY(1); opacity: 0; }
        }
        @keyframes fall-snow {
          0%   { transform: translateY(-20px) translateX(0); opacity: 0; }
          10%  { opacity: 1; }
          50%  { transform: translateY(50vh) translateX(12px); }
          90%  { opacity: 0.7; }
          100% { transform: translateY(105vh) translateX(0); opacity: 0; }
        }
        @keyframes drift-cloud {
          0%   { transform: translateX(-120px); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateX(120px); opacity: 0; }
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
          condition === "rain" ? (
            <div
              key={p.id}
              style={{
                position: "absolute",
                left: `${p.left}%`,
                top: 0,
                width: `${p.size}px`,
                height: "18px",
                borderRadius: "1px",
                background: "var(--accent, #4a9eff)",
                opacity: p.opacity,
                animation: `fall-rain ${p.duration}s ${p.delay}s linear infinite`,
              }}
            />
          ) : condition === "snow" ? (
            <div
              key={p.id}
              style={{
                position: "absolute",
                left: `${p.left}%`,
                top: 0,
                width: `${p.size}px`,
                height: `${p.size}px`,
                borderRadius: "50%",
                background: "#e8f0fe",
                opacity: p.opacity,
                animation: `fall-snow ${p.duration}s ${p.delay}s ease-in-out infinite`,
              }}
            />
          ) : (
            // cloud
            <div
              key={p.id}
              style={{
                position: "absolute",
                left: p.id % 2 === 0 ? "2%" : "auto",
                right: p.id % 2 !== 0 ? "2%" : "auto",
                top: `${p.top}%`,
                width: `${p.size}px`,
                height: `${p.size * 0.55}px`,
                borderRadius: "50%",
                background: "var(--ink, #1a1a1a)",
                filter: "blur(20px)",
                opacity: p.opacity,
                animation: `drift-cloud ${8 + p.delay * 2}s ${p.delay}s ease-in-out infinite alternate`,
              }}
            />
          )
        )}
      </div>
    </>
  );
}
