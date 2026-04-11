"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SplashPage() {
  const router = useRouter();
  // stage: 0 = icon + heaven, 1 = icon fading out, 2 = heaven only, 3 = navigating
  const [stage, setStage] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // 1초: 아이콘 페이드아웃 시작
    const t1 = setTimeout(() => !cancelled && setStage(1), 1000);
    // 1.5초: 아이콘 완전히 사라짐 (천국 이미지만)
    const t2 = setTimeout(() => !cancelled && setStage(2), 1500);
    // 3초: 화면 전환 시작
    const t3 = setTimeout(async () => {
      if (cancelled) return;
      setStage(3);

      const { data: { session } } = await supabase.auth.getSession();
      setTimeout(() => {
        if (cancelled) return;
        if (session) {
          supabase.rpc("get_my_status").then(({ data }) => {
            const profile = data?.[0];
            if (profile?.status === "active") {
              // /home을 webview 첫 entry로 만들기 위해 replace 사용
              // (뒤로가기 종료 시 canGoBack=false → TWA Activity 종료)
              router.replace("/home");
            } else {
              router.replace("/login?notice=pending");
            }
          });
        } else {
          router.replace("/login");
        }
      }, 500);
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [router]);

  const heavenOpacity = stage >= 3 ? 0 : 1;
  const iconOpacity = stage >= 1 ? 0 : 1;
  const iconScale = stage >= 1 ? 1.1 : 1;

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        background: "#000",
        fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap"
        rel="stylesheet"
      />

      {/* 천국 이미지 - 항상 풀 표시 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url(/splash-bg.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: heavenOpacity,
          transition: "opacity 0.5s ease-out",
        }}
      />

      {/* 아주 가벼운 비네팅 (텍스트 가독성용) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.15) 100%)",
          opacity: heavenOpacity,
          transition: "opacity 0.5s ease-out",
          pointerEvents: "none",
        }}
      />

      {/* 아이콘 - 1초 노출 후 페이드아웃 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: iconOpacity,
          transform: `scale(${iconScale})`,
          transition: "opacity 0.5s ease-out, transform 0.5s ease-out",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 18,
            padding: "32px 44px",
            background: "rgba(255,255,255,0.55)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderRadius: 28,
            border: "1px solid rgba(255,255,255,0.7)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          }}
        >
          <img
            src="/icon-192.png"
            alt="스마트명성"
            style={{
              width: 88,
              height: 88,
              borderRadius: 20,
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            }}
          />
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 26,
                fontWeight: 900,
                color: "#1e293b",
                letterSpacing: -1,
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
                letterSpacing: 0.5,
              }}
            >
              Smart Myungsung
            </div>
          </div>
        </div>
      </div>

      {/* 하단 카피라이트 - 천국 이미지와 함께 유지 */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 11,
          color: "#fff",
          fontWeight: 600,
          letterSpacing: 0.5,
          textShadow: "0 2px 8px rgba(0,0,0,0.5)",
          opacity: heavenOpacity,
          transition: "opacity 0.5s ease-out",
          pointerEvents: "none",
        }}
      >
        © 2026 Smart Myungsung Church
      </div>
    </div>
  );
}
