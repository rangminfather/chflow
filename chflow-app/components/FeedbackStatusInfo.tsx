"use client";

// 불편신고/건의 처리 상태 공용 정의 + 모바일 대응 설명 UI.
//  - StatusBadge: 배지를 탭하면 설명이 하단 말풍선(토스트)으로 표시 (PC는 hover 툴팁도 동작)
//  - StatusGuideButton: ℹ️ 버튼 → 5개 상태 설명을 한번에 보여주는 안내 모달

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";
import ModalBackdrop from "@/components/ModalBackdrop";

export type FeedbackStatus = "submitted" | "received" | "reviewing" | "resolved" | "rejected";

export const STATUS_META: Record<FeedbackStatus, { label: string; desc: string; bg: string; fg: string }> = {
  submitted: { label: "미접수", desc: "접수된 내용을 운영자가 확인하기 전 입니다.", bg: "var(--danger-soft)", fg: "var(--danger)" },
  received:  { label: "접수",   desc: "접수된 내용을 운영자가 확인했습니다.", bg: "var(--warning-soft)", fg: "var(--warning)" },
  reviewing: { label: "검토중", desc: "접수된 내용에 대해 조치중입니다.", bg: "var(--accent-soft)", fg: "var(--accent-strong)" },
  resolved:  { label: "처리완료", desc: "접수된 내용에 대한 처리가 완료되었습니다.", bg: "var(--success-soft)", fg: "var(--success)" },
  rejected:  { label: "처리불가", desc: "접수된 내용에 대해 처리가 불가합니다.", bg: "var(--hairline)", fg: "var(--ink-mid)" },
};

export const FEEDBACK_STATUSES: FeedbackStatus[] = ["submitted", "received", "reviewing", "resolved", "rejected"];

// 탭 시 하단 말풍선으로 설명 표시하는 상태 배지
export function StatusBadge({ status, style }: { status: FeedbackStatus; style?: React.CSSProperties }) {
  const meta = STATUS_META[status];
  const [toast, setToast] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const show = (e: React.MouseEvent) => {
    // 목록 행 전체가 버튼이므로 행 이동으로 전파되지 않게 차단
    e.preventDefault();
    e.stopPropagation();
    setToast(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(false), 2600);
  };

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        title={meta.desc}
        onClick={show}
        style={{ ...badgeBaseStyle, background: meta.bg, color: meta.fg, ...style }}
      >
        {meta.label}
      </span>
      {mounted && toast && createPortal(
        <div style={toastStyle}>
          <b style={{ marginRight: 6 }}>{meta.label}</b>
          {meta.desc}
        </div>,
        document.body,
      )}
    </>
  );
}

// 상태 설명 전체 안내 모달을 여는 ℹ️ 버튼
export function StatusGuideButton({ style }: { style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="처리 상태 안내"
        title="처리 상태 안내"
        style={{ ...guideBtnStyle, ...style }}
      >
        <Info size={15} strokeWidth={1.9} />
        <span>상태 안내</span>
      </button>
      {open && (
        <ModalBackdrop onClose={() => setOpen(false)}>
          <div style={guideCardStyle}>
            <div style={guideHeaderStyle}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>처리 상태 안내</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="닫기" style={guideCloseStyle}>
                <X size={17} strokeWidth={1.9} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {FEEDBACK_STATUSES.map((s) => {
                const m = STATUS_META[s];
                return (
                  <div key={s} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ ...badgeBaseStyle, background: m.bg, color: m.fg, flexShrink: 0, cursor: "default" }}>
                      {m.label}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.55, paddingTop: 2 }}>{m.desc}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </ModalBackdrop>
      )}
    </>
  );
}

const badgeBaseStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 800,
  whiteSpace: "nowrap",
  cursor: "pointer",
  userSelect: "none",
};

const toastStyle: React.CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: 28,
  transform: "translateX(-50%)",
  maxWidth: "calc(100vw - 40px)",
  padding: "10px 16px",
  borderRadius: 12,
  background: "color-mix(in srgb, var(--ink) 88%, transparent)",
  color: "var(--bg)",
  fontSize: 12.5,
  lineHeight: 1.5,
  zIndex: 1200,
  boxShadow: "0 8px 24px color-mix(in srgb, var(--ink) 30%, transparent)",
  wordBreak: "keep-all",
};

const guideBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  minHeight: 32,
  padding: "0 10px",
  borderRadius: 9,
  border: "1px solid var(--hairline)",
  background: "var(--card)",
  color: "var(--ink-soft)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const guideCardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 380,
  borderRadius: 14,
  background: "var(--card)",
  padding: "14px 16px 16px",
  boxShadow: "0 18px 48px color-mix(in srgb, var(--ink) 28%, transparent)",
};

const guideHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 12,
};

const guideCloseStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "1px solid var(--hairline)",
  background: "var(--card)",
  color: "var(--ink)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};
