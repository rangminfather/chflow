"use client";

import { Inbox } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

/* ============================================================
   상태 공용 컴포넌트 — 로딩 스피너 / 스켈레톤 / 빈 상태
   "로딩 중..." 텍스트만 띄우던 자리를 대체한다.
   ============================================================ */

export function Spinner({ size = 28 }: { size?: number }) {
  return (
    <span
      className="chflow-spinner"
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 10)) }}
      aria-label="로딩 중"
      role="status"
    />
  );
}

export function LoadingView({
  label = "로딩 중...",
  full = false,
  padding = 48,
}: {
  label?: string;
  full?: boolean;
  padding?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding,
        ...(full ? { minHeight: "100vh", background: "var(--bg)" } : {}),
      }}
    >
      <Spinner />
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-faint)" }}>{label}</div>
    </div>
  );
}

export function Skeleton({
  width = "100%",
  height = 14,
  radius = 8,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return <div className="chflow-skeleton" style={{ width, height, borderRadius: radius, ...style }} />;
}

export function EmptyState({
  icon,
  message,
  hint,
  padding = 44,
}: {
  icon?: ReactNode;
  message: string;
  hint?: string;
  padding?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          display: "grid",
          placeItems: "center",
          borderRadius: "50%",
          background: "var(--bg-soft)",
          color: "var(--ink-faint)",
        }}
      >
        {icon ?? <Inbox size={24} strokeWidth={1.6} />}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", wordBreak: "keep-all" }}>{message}</div>
      {hint && <div style={{ fontSize: 12, color: "var(--ink-faint)", wordBreak: "keep-all" }}>{hint}</div>}
    </div>
  );
}
