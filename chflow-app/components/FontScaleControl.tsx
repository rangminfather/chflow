"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useFontScale } from "@/lib/useFontScale";

const OPTIONS = [
  { lv: 1, label: "보통", demo: 14 },
  { lv: 2, label: "크게", demo: 17 },
  { lv: 3, label: "더 크게", demo: 20 },
];

// 벨(NotificationBell) 위에 얹히는 글자 크기 조절 플로팅 버튼.
// dock(global-notification-dock) 안에 렌더되므로 확대 배율의 영향을 받지 않는다.
export default function FontScaleControl() {
  const { level, setLevel } = useFontScale();
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      {open && (
        <>
          {/* 바깥 클릭 시 닫힘 */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1 }} />
          <div
            role="menu"
            style={{
              position: "absolute",
              bottom: "calc(100% + 8px)",
              right: 0,
              zIndex: 2,
              width: 172,
              background: "var(--card)",
              border: "1px solid var(--hairline)",
              borderRadius: 14,
              boxShadow: "0 16px 40px rgba(43,39,34,0.22)",
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-faint)", padding: "4px 8px 2px", letterSpacing: 0.5 }}>
              글자 크기
            </div>
            {OPTIONS.map((o) => {
              const sel = level === o.lv;
              return (
                <button
                  key={o.lv}
                  onClick={() => {
                    setLevel(o.lv);
                    setOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    border: sel ? "1px solid var(--accent)" : "1px solid transparent",
                    background: sel ? "var(--accent-soft)" : "transparent",
                    borderRadius: 9,
                    padding: "9px 10px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: sel ? "var(--accent-strong)" : "var(--ink)",
                    fontWeight: 700,
                  }}
                >
                  <span style={{ fontSize: o.demo, lineHeight: 1 }}>가 · {o.label}</span>
                  {sel && <Check size={16} strokeWidth={2.4} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="글자 크기 조절"
        title="글자 크기"
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "1px solid rgba(43,39,34,0.1)",
          background: "var(--surface)",
          boxShadow: "0 14px 34px rgba(43,39,34,0.18)",
          cursor: "pointer",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          color: "var(--accent-strong)",
          fontFamily: "inherit",
          padding: "9px 0 0",
        }}
      >
        <span style={{ fontSize: 19, fontWeight: 800, lineHeight: 1 }}>가</span>
        <span style={{ fontSize: 11, fontWeight: 800, lineHeight: 1, marginTop: -2 }}>＋</span>
      </button>
    </div>
  );
}
