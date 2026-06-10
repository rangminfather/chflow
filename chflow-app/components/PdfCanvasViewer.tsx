"use client";

// 모바일(안드로이드 WebView/브라우저)에서 <iframe src="*.pdf"> 는 인라인 렌더링이
// 안 됨. pdf.js 로 각 페이지를 <canvas> 에 직접 그려서 어떤 기기에서도 화면에
// 바로 PDF 가 뜨도록 한다. 워커는 /public/pdf.worker.min.mjs (자체 오리진).

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { ExternalLink } from "lucide-react";

type Props = {
  url: string;
  // 렌더 실패 시 새 탭으로 열 원문/PDF 주소
  fallbackUrl: string;
};

// 캔버스 백킹 스토어 폭(px). CSS 로 컨테이너 폭에 맞춰 축소되므로 폰에서 선명.
const BACKING_WIDTH = 1100;

export default function PdfCanvasViewer({ url, fallbackUrl }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let loadingTask: any = null;
    const container = containerRef.current;

    (async () => {
      setStatus("loading");
      if (container) container.innerHTML = "";
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        loadingTask = pdfjs.getDocument({ url });
        const doc = await loadingTask.promise;
        if (cancelled) return;

        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          const page = await doc.getPage(pageNum);
          if (cancelled) return;

          const base = page.getViewport({ scale: 1 });
          const scale = BACKING_WIDTH / base.width;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          canvas.style.marginBottom = pageNum < doc.numPages ? "10px" : "0";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          if (containerRef.current) containerRef.current.appendChild(canvas);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
        }

        if (!cancelled) setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          console.error("PDF 렌더 실패", e);
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        loadingTask?.destroy?.();
      } catch {
        // ignore
      }
    };
  }, [url]);

  return (
    <div style={viewerStyle}>
      <div ref={containerRef} style={canvasHostStyle} />
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
  );
}

const viewerStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  background: "#fff",
};

const canvasHostStyle: React.CSSProperties = {
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
