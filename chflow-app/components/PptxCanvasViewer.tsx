"use client";

// 부서 주보 PPTX 뷰어 — 유치부·청소년부는 주보를 PPTX 로 올려서 PDF 뷰어로 못 본다.
// pptx-preview 로 각 슬라이드를 브라우저에서 직접 HTML 렌더링한다 (설치·외부 서비스 불필요).

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { ExternalLink, ArrowUp } from "lucide-react";

type Props = {
  url: string;
  // 렌더 실패 시 새 탭으로 열 원문 주소
  fallbackUrl: string;
};

// 슬라이드 렌더 폭(px) 상한 — 컨테이너가 더 좁으면 컨테이너 폭에 맞춤
const MAX_RENDER_WIDTH = 1100;

export default function PptxCanvasViewer({ url, fallbackUrl }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let previewer: any = null;
    const container = containerRef.current;

    (async () => {
      setStatus("loading");
      if (container) container.innerHTML = "";
      try {
        const [{ init }, res] = await Promise.all([
          import("pptx-preview"),
          fetch(url, { cache: "no-store" }),
        ]);
        if (!res.ok) throw new Error(`파일 응답 ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled || !containerRef.current) return;

        const width = Math.min(containerRef.current.clientWidth || MAX_RENDER_WIDTH, MAX_RENDER_WIDTH);
        previewer = init(containerRef.current, { width, mode: "list" });
        await previewer.preview(buf);
        if (!cancelled) setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          console.error("PPTX 렌더 실패", e);
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        previewer?.destroy?.();
      } catch {
        // ignore
      }
    };
  }, [url]);

  return (
    <div style={rootStyle}>
      <div
        ref={scrollRef}
        style={viewerStyle}
        onScroll={(e) => setShowTop(e.currentTarget.scrollTop > 200)}
      >
        <div ref={containerRef} style={slideHostStyle} />
        {status === "loading" && <div style={overlayStyle}>주보를 불러오는 중...</div>}
        {status === "error" && (
          <div style={overlayStyle}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>주보를 표시하지 못했습니다</div>
            <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" style={openButtonStyle}>
              <span>원문 보기</span>
              <ExternalLink size={16} strokeWidth={1.8} />
            </a>
          </div>
        )}
      </div>
      {showTop && (
        <button
          type="button"
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="맨 위로"
          style={scrollTopStyle}
        >
          <ArrowUp size={22} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
};

const scrollTopStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 16,
  right: 16,
  width: 44,
  height: 44,
  borderRadius: 999,
  border: "none",
  background: "var(--accent)",
  color: "#FFFDF7",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  boxShadow: "0 6px 18px color-mix(in srgb, var(--ink) 28%, transparent)",
  zIndex: 5,
};

const viewerStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflowY: "auto",
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  background: "var(--card)",
};

const slideHostStyle: React.CSSProperties = {
  width: "100%",
};

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  background: "var(--surface)",
  color: "var(--ink-soft)",
  fontSize: 13,
  textAlign: "center",
  padding: 16,
};

const openButtonStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "0 14px",
  borderRadius: 10,
  background: "#3E5A4A",
  color: "#FFFDF7",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  fontSize: 13,
  fontWeight: 800,
};
