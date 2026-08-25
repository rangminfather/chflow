"use client";

import { useEffect } from "react";

// 안드로이드 셸의 하드웨어 뒤로가기 위임 핸들러.
// 셸이 window.__chflowHardwareBack() 를 호출하면:
//  - 루트(홈/로그인)면 셸에 종료 확인 요청(CHFLOW_BACK_AT_ROOT)
//  - 그 외 화면이면 웹 자체 history.back() 으로 한 단계 뒤로
// WebView의 canGoBack 추적이 SPA pushState 를 못 잡는 문제를 우회한다.
declare global {
  interface Window {
    __chflowHardwareBack?: () => void;
    ReactNativeWebView?: { postMessage: (msg: string) => void };
  }
}

const ROOT_PATHS = new Set(["/", "/home", "/login"]);

export default function HardwareBackBridge() {
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const backDept = searchParams.get("backDept");
    const backMenu = searchParams.get("backMenu");
    const backSection = searchParams.get("backSection");
    if (backDept && backMenu && backSection) {
      try {
        const serialized = JSON.stringify({ categoryId: backMenu, sectionId: backSection });
        window.localStorage.setItem(`dept-menu-location:${backDept}`, serialized);
        window.sessionStorage.setItem(`dept-menu-location:${backDept}`, serialized);
      } catch {
        // 저장소가 차단된 환경에서는 부서 화면 URL의 검색 매개변수로 복원한다.
      }
    }

    window.__chflowHardwareBack = () => {
      const p = window.location.pathname;
      const atRoot = ROOT_PATHS.has(p);
      if (!atRoot && window.history.length > 1) {
        window.history.back();
      } else if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: "CHFLOW_BACK_AT_ROOT" }));
      }
    };
    return () => { delete window.__chflowHardwareBack; };
  }, []);

  return null;
}
