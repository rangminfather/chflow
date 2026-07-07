"use client";

// 부서 주보 HWP 뷰어 — 초등2부는 주보를 HWP 로 올려서 웹에서 전체 렌더링이 불가능하다.
// HWP 5.x 파일에 내장된 첫 페이지 미리보기 이미지(PrvImage)를 표시하고,
// 전체 내용은 원본 파일 다운로드/원문 링크로 안내한다.

import { useState } from "react";
import type React from "react";
import { Download, ExternalLink, Info } from "lucide-react";

type Props = {
  // /api/dept-bulletin/file?...&as=hwp-preview
  previewUrl: string;
  // /api/dept-bulletin/file?... (원본 다운로드)
  downloadUrl: string;
  // UMS 게시글 주소
  fallbackUrl: string;
};

export default function HwpPreviewViewer({ previewUrl, downloadUrl, fallbackUrl }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  return (
    <div style={rootStyle}>
      <div style={noticeStyle}>
        <Info size={15} strokeWidth={1.8} style={{ flexShrink: 0 }} />
        <span>한글(HWP) 파일이라 첫 페이지만 미리보기됩니다. 전체는 파일 다운로드로 확인하세요.</span>
      </div>
      <div style={viewerStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt="주보 첫 페이지 미리보기"
          style={imageStyle}
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
        />
        {status === "loading" && <div style={overlayStyle}>주보 미리보기를 불러오는 중...</div>}
        {status === "error" && (
          <div style={overlayStyle}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>미리보기를 표시하지 못했습니다</div>
          </div>
        )}
      </div>
      <div style={actionRowStyle}>
        <a href={downloadUrl} style={actionButtonStyle}>
          <Download size={16} strokeWidth={1.8} />
          <span>파일 다운로드</span>
        </a>
        <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" style={secondaryButtonStyle}>
          <ExternalLink size={16} strokeWidth={1.8} />
          <span>원문 보기</span>
        </a>
      </div>
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
};

const noticeStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "9px 12px",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--ink-mid)",
  background: "var(--surface)",
  borderBottom: "1px solid var(--hairline)",
  lineHeight: 1.4,
};

const viewerStyle: React.CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  background: "var(--card)",
};

const imageStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "auto",
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

const actionRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  padding: "10px 12px",
  borderTop: "1px solid var(--hairline)",
  background: "var(--surface)",
};

const actionButtonStyle: React.CSSProperties = {
  flex: 1,
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

const secondaryButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  background: "var(--card)",
  color: "var(--ink)",
  border: "1px solid var(--hairline)",
};
