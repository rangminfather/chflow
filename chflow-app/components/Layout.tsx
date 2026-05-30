// =============================================================
// 공통 Layout / Card / Grid 컴포넌트
// -------------------------------------------------------------
// 목적: 어떤 화면에서도 콘텐츠가 부모 컨테이너를 넘어 가로 스크롤이
//       생기지 않도록 "안전한 폭 계산"을 강제하는 재사용 컴포넌트
// 규칙:
//   1) 최상위는 PageShell (width:100%, max-width:100vw, overflow-x:hidden)
//   2) flex/grid 자식에는 min-width:0 강제
//   3) 그리드는 minmax(0, 1fr) — 2열에서도 안전
//   4) 카드는 width:100%, box-sizing:border-box, 고정 width 금지
//   5) 아이콘 박스는 flex-shrink:0, 텍스트 영역은 flex:1 + min-width:0
// =============================================================
"use client";

import type { CSSProperties, ReactNode, ButtonHTMLAttributes } from "react";

// =============================================================
// 디자인 토큰 (앱 전역 공통)
// =============================================================
// 색은 globals.css 의 CSS 토큰(var)을 단일 소스로 참조.
// 포인트는 세이지(--accent) 1색으로 통일, 파스텔 섹션색은 절제된 세이지 톤으로.
// 상태색(경고/성공/위험)은 의미 전달용이라 그대로 유지.
export const T = {
  bgPage:    "var(--bg)",
  bgCard:    "var(--surface)",
  text:      "var(--ink)",
  textMuted: "var(--ink-soft)",
  border:    "var(--hairline)",
  shadowSubtle: "none",

  // 섹션 톤 — 3색 파스텔 → 세이지 포인트 1색으로 통일
  ministryBg:    "var(--accent-soft)",
  ministryPoint: "var(--accent)",
  mokjangBg:     "var(--accent-soft)",
  mokjangPoint:  "var(--accent)",
  commonBg:      "var(--accent-soft)",
  commonPoint:   "var(--accent)",

  warn:     "#F59E0B",
  warnSoft: "#FFFBEB",
  success:  "#10B981",
  successSoft: "#ECFDF5",
  danger:   "#EF4444",
  dangerSoft:"#FEF2F2",
};

// =============================================================
// PageShell — 모든 최상위 페이지가 사용해야 하는 안전 컨테이너
// =============================================================
export function PageShell({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      className="app-shell"
      style={{
        minHeight: "100vh",
        background: T.bgPage,
        color: T.text,
        fontFamily: "var(--app-sans)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// =============================================================
// PageContent — 가운데 정렬 + 좌우 padding (모바일 16px, 데스크탑 24px)
//   maxWidth로 콘텐츠 폭 제한, 절대 부모 폭을 넘지 않음
// =============================================================
export function PageContent({
  children,
  maxWidth = 920,
  pad = true,
  style,
}: {
  children: ReactNode;
  maxWidth?: number;
  pad?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        ...(pad ? { paddingLeft: "clamp(12px, 4vw, 24px)", paddingRight: "clamp(12px, 4vw, 24px)" } : null),
        paddingTop: 16,
        paddingBottom: 24,
        ...style,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth,
          margin: "0 auto",
          minWidth: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// =============================================================
// Section — tinted container (제목/설명 + 콘텐츠 묶음)
// =============================================================
export function Section({
  bg,
  children,
  style,
}: {
  bg?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        background: bg ?? T.bgCard,
        border: `1px solid ${T.border}`,
        borderRadius: 20,
        padding: "clamp(14px, 4vw, 20px)",
        marginBottom: 20,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

// =============================================================
// SectionHeader — 작은 아이콘 박스 + 제목 + 보조설명 (통일된 헤더)
// =============================================================
export function SectionHeader({
  icon,
  iconColor,
  title,
  subtitle,
}: {
  icon: string;
  iconColor: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div style={{ marginBottom: 14, minWidth: 0 }}>
      <div className="safe-row">
        <span
          className="safe-shrink-0"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "rgba(255,255,255,0.7)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: iconColor,
            fontSize: 16,
          }}
        >{icon}</span>
        <div className="safe-grow kr-keep" style={{ fontSize: 17, fontWeight: 800, color: T.text }}>
          {title}
        </div>
      </div>
      {subtitle && (
        <div
          className="kr-keep"
          style={{
            fontSize: 12,
            color: T.textMuted,
            marginTop: 6,
            paddingLeft: 36,
            lineHeight: 1.5,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

// =============================================================
// SafeCard — 100% 폭 카드 (button 또는 div 모드)
//   - 카드 내부에서 .safe-row 와 함께 쓰면 자식이 부모를 넘기지 않음
// =============================================================
type SafeCardCommon = {
  children: ReactNode;
  style?: CSSProperties;
  padding?: number | string;
  noBorder?: boolean;
};
export function SafeCard({
  children,
  style,
  padding = 16,
  noBorder,
  onClick,
  type = "button",
  ...rest
}: SafeCardCommon & ButtonHTMLAttributes<HTMLButtonElement>) {
  const isInteractive = !!onClick;
  const sx: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
    minWidth: 0,
    background: T.bgCard,
    border: noBorder ? "none" : `1px solid ${T.border}`,
    borderRadius: 16,
    padding,
    boxShadow: T.shadowSubtle,
    textAlign: "left" as const,
    fontFamily: "inherit",
    color: T.text,
    cursor: isInteractive ? "pointer" : "default",
    ...style,
  };
  if (isInteractive) {
    return (
      <button onClick={onClick} type={type} style={sx} {...rest}>
        {children}
      </button>
    );
  }
  return <div style={sx}>{children}</div>;
}

// =============================================================
// SafeRow / SafeGrow / SafeShrink — flex 안전 wrapper
// =============================================================
export function SafeRow({
  children,
  gap = 12,
  align = "center",
  style,
}: {
  children: ReactNode;
  gap?: number;
  align?: "center" | "flex-start" | "flex-end" | "stretch";
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: align,
        gap,
        minWidth: 0,
        width: "100%",
        maxWidth: "100%",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SafeGrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ flex: 1, minWidth: 0, ...style }}>
      {children}
    </div>
  );
}

export function SafeShrink({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ flexShrink: 0, ...style }}>
      {children}
    </div>
  );
}

// =============================================================
// SafeGrid — 2열 모바일 그리드 (repeat(2, minmax(0, 1fr)))
//   cols=1 이면 1열, 2 이면 2열
// =============================================================
export function SafeGrid({
  cols = 2,
  gap = 12,
  children,
  style,
}: {
  cols?: 1 | 2;
  gap?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// =============================================================
// IconBox — 카드 좌측의 정사각형 아이콘 영역
// =============================================================
export function IconBox({
  bg,
  size = 48,
  children,
}: {
  bg: string;
  size?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

// =============================================================
// Badge — 상태 배지 (둥근 pill)
// =============================================================
export function Badge({
  tone,
  label,
}: {
  tone: "success" | "warn" | "info" | "neutral";
  label: string;
}) {
  const map = {
    success: { bg: T.successSoft, fg: T.success },
    warn:    { bg: T.warnSoft,    fg: T.warn },
    info:    { bg: T.ministryBg,  fg: T.ministryPoint },
    neutral: { bg: T.commonBg,    fg: T.textMuted },
  } as const;
  const m = map[tone];
  return (
    <span
      style={{
        flexShrink: 0,
        padding: "4px 10px",
        borderRadius: 999,
        background: m.bg,
        color: m.fg,
        fontSize: 11,
        fontWeight: 800,
        whiteSpace: "nowrap",
        maxWidth: "100%",
      }}
    >
      {label}
    </span>
  );
}

// =============================================================
// CTA buttons — 폭 100% 솔리드 / outline
// =============================================================
export function SolidButton({
  label,
  color,
  onClick,
  style,
}: {
  label: string;
  color: string;
  onClick: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        maxWidth: "100%",
        padding: "14px 16px",
        minHeight: 52,
        background: color,
        color: "#fff",
        border: "none",
        borderRadius: 14,
        fontSize: 14,
        fontWeight: 800,
        cursor: "pointer",
        fontFamily: "inherit",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {label}
    </button>
  );
}

export function OutlineButton({
  label,
  color,
  onClick,
  style,
}: {
  label: string;
  color: string;
  onClick: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        maxWidth: "100%",
        padding: "14px 16px",
        minHeight: 52,
        background: T.bgCard,
        color,
        border: `1.5px solid ${color}`,
        borderRadius: 14,
        fontSize: 14,
        fontWeight: 800,
        cursor: "pointer",
        fontFamily: "inherit",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {label}
    </button>
  );
}
