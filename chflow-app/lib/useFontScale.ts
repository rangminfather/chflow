"use client";
import { useCallback, useEffect, useState } from "react";

// 글자 크기 비례 확대 (접근성 — 노안 대응)
// level 1/2/3 → 텍스트 100% / 115% / 130%
// 모바일은 text-size-adjust로 글자만 키우고, 넓은 포인터 환경은 기존 화면 확대를 유지한다.
// 다크모드 토글(useTheme)과 동일한 localStorage 패턴.

const KEY = "chflow-font-scale";
export const FONT_SCALE: Record<number, { text: string; desktopZoom: string }> = {
  1: { text: "100%", desktopZoom: "1" },
  2: { text: "115%", desktopZoom: "1.15" },
  3: { text: "130%", desktopZoom: "1.3" },
};

function normalize(v: number): number {
  return FONT_SCALE[v] ? v : 1;
}

function applyScale(level: number) {
  const scale = FONT_SCALE[level];
  document.documentElement.style.setProperty("--app-font-scale", scale.text);
  document.documentElement.style.setProperty("--app-zoom", scale.desktopZoom);
}

export function useFontScale() {
  const [level, setLevelState] = useState(1);

  useEffect(() => {
    const saved = normalize(parseInt(localStorage.getItem(KEY) || "1", 10));
    setLevelState(saved);
    applyScale(saved);
  }, []);

  const setLevel = useCallback((next: number) => {
    const v = normalize(next);
    setLevelState(v);
    localStorage.setItem(KEY, String(v));
    applyScale(v);
  }, []);

  return { level, setLevel };
}
