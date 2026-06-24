"use client";
import { useCallback, useEffect, useState } from "react";

// 글자 크기 비례 확대 (접근성 — 노안 대응)
// level 1/2/3 → 화면 전체 배율 100% / 115% / 130%
// 다크모드 토글(useTheme)과 동일한 localStorage 패턴.
// 실제 배율 적용은 :root 의 --app-zoom 변수 → globals.css 의 #app-zoom-root { zoom: var(--app-zoom) }

const KEY = "chflow-font-scale";
export const FONT_SCALE: Record<number, string> = { 1: "1", 2: "1.15", 3: "1.3" };

function normalize(v: number): number {
  return FONT_SCALE[v] ? v : 1;
}

export function useFontScale() {
  const [level, setLevelState] = useState(1);

  useEffect(() => {
    const saved = normalize(parseInt(localStorage.getItem(KEY) || "1", 10));
    setLevelState(saved);
    document.documentElement.style.setProperty("--app-zoom", FONT_SCALE[saved]);
  }, []);

  const setLevel = useCallback((next: number) => {
    const v = normalize(next);
    setLevelState(v);
    localStorage.setItem(KEY, String(v));
    document.documentElement.style.setProperty("--app-zoom", FONT_SCALE[v]);
  }, []);

  return { level, setLevel };
}
