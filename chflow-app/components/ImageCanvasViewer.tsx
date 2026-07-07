"use client";

// 부서 주보 이미지 뷰어 — 주보를 JPG/PNG 등 이미지로 올리는 경우 대응.
// 세로 스크롤 + 원본 링크 폴백. (파일 유형 표준 체계: image)

import { useState } from "react";
import type React from "react";
import { ExternalLink } from "lucide-react";

type Props = {
  url: string;
  // 표시 실패 시 새 탭으로 열 원문 주소
  fallbackUrl: string;
};

export default function ImageCanvasViewer({ url, fallbackUrl }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  return (
    <div style={rootStyle}>
      <div style={viewerStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="주보 이미지"
          style={imageStyle}
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
        />
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
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
};

const viewerStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  background: "var(--card)",
};

const imageStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "auto",
  background: "var(--paper)",
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
