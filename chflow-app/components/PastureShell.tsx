"use client";

// 목장 화면 공용 껍데기 — 헤더·본문 폭·빈 상태를 4개 화면이 공유한다.

import type React from "react";
import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";

export function PastureShell({
  eyebrow,
  title,
  chip,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  chip?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <main style={pageStyle}>
      <section style={shellStyle}>
        <header className="app-subpage-header" style={headerStyle}>
          <button
            className="app-header-back"
            type="button"
            onClick={() => router.back()}
            aria-label="뒤로가기"
            style={{ ...iconButtonStyle, width: "auto", padding: "0 12px", whiteSpace: "nowrap" }}
          >
            ← 뒤로
          </button>
          <HeaderLogo />
          <div style={{ minWidth: 0, flex: 1 }}>
            {eyebrow && <div style={eyebrowStyle}>{eyebrow}</div>}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <h1 style={titleStyle}>{title}</h1>
              {chip && <span style={chipStyle}>{chip}</span>}
            </div>
          </div>
          {actions && <div className="app-header-actions">{actions}</div>}
        </header>
        {children}
      </section>
    </main>
  );
}

export function PastureEmpty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div style={emptyStyle}>
      <div style={{ fontSize: 16, fontWeight: 800 }}>{title}</div>
      {hint && <div style={{ maxWidth: 460, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.6 }}>{hint}</div>}
      {action}
    </div>
  );
}

export const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg)",
  color: "var(--ink)",
  fontFamily: "'Noto Sans KR', var(--app-sans), sans-serif",
  padding: "clamp(12px, 4vw, 24px)",
};

export const shellStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 720,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 16,
};

export const iconButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  color: "var(--ink)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "var(--accent)",
  lineHeight: 1.2,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  lineHeight: 1.25,
  fontWeight: 800,
};

const chipStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "var(--accent)",
};

export const cardStyle: React.CSSProperties = {
  border: "1px solid var(--hairline)",
  borderRadius: 12,
  background: "var(--card)",
  padding: 16,
  marginBottom: 12,
};

export const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "var(--ink-faint)",
  letterSpacing: "0.02em",
  marginBottom: 8,
};

const emptyStyle: React.CSSProperties = {
  minHeight: 200,
  borderRadius: 14,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: 20,
  textAlign: "center",
};

export const primaryButtonStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "0 16px",
  borderRadius: 10,
  border: "none",
  background: "var(--accent)",
  color: "var(--on-accent, #fff)",
  fontSize: 14,
  fontWeight: 800,
  cursor: "pointer",
};

export const ghostButtonStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  color: "var(--ink)",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};
