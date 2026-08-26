"use client";
import { useCallback, useEffect, useState } from "react";

const KEY = "chflow-weather-effect";
// 같은 탭 안의 다른 컴포넌트(사이드바 버튼 ↔ 오버레이)를 즉시 동기화하기 위한 이벤트
// (storage 이벤트는 같은 탭에서는 발생하지 않음)
const EVENT = "chflow-weather-effect-change";

/** 저장값이 없으면 켜짐이 기본 */
function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function useWeatherEffect() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const sync = () => setEnabled(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !read();
    setEnabled(next);
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // 저장 실패(시크릿 모드 등)해도 현재 화면에는 반영되게 둔다
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { enabled, toggle };
}
