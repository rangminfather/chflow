"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useFontScale } from "@/lib/useFontScale";

// 왼쪽 미리보기 '가'의 크기가 실제 확대 단계 느낌을 반영하도록 차등 (label 텍스트는 고정 크기)
const OPTIONS = [
  { lv: 1, label: "보통", sample: 16 },
  { lv: 2, label: "크게", sample: 22 },
  { lv: 3, label: "아주 크게", sample: 28 },
];

// 벨(NotificationBell) 위에 얹히는 글자 크기 조절 플로팅 버튼.
// dock(global-notification-dock) 안에 렌더되므로 확대 배율의 영향을 받지 않는다.
export default function FontScaleControl() {
  const { level, setLevel } = useFontScale();
  const [open, setOpen] = useState(false);

  // ESC 로 닫기 (열려 있을 때만)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <style>{`
        .fs-fab{
          width:50px;height:50px;border-radius:50%;
          background:var(--accent-soft);
          border:1px solid var(--accent-line);
          box-shadow:0 6px 16px rgba(43,39,34,0.12);
          cursor:pointer;display:flex;align-items:center;justify-content:center;
          color:var(--accent-strong);font-family:inherit;
          transition:transform .15s ease, background .15s ease, box-shadow .15s ease;
        }
        .fs-fab:hover,.fs-fab:focus-visible{
          transform:scale(1.03);
          background:var(--accent-line);
          box-shadow:0 8px 20px rgba(43,39,34,0.16);
        }
        .fs-fab:focus-visible{
          outline:2px solid color-mix(in srgb, var(--accent) 55%, transparent);
          outline-offset:2px;
        }
        .fs-item{
          display:flex;align-items:center;gap:12px;width:100%;
          min-height:48px;padding:10px 12px;border-radius:10px;
          border:1px solid transparent;background:transparent;
          cursor:pointer;font-family:inherit;color:var(--ink);
          transition:background .12s ease, border-color .12s ease;
          text-align:left;
        }
        .fs-item:hover{ background:var(--bg-soft); }
        .fs-item[aria-checked="true"]{
          background:var(--accent-soft);
          border-color:var(--accent-line);
          color:var(--accent-strong);
        }
        .fs-item:focus-visible{
          outline:2px solid color-mix(in srgb, var(--accent) 50%, transparent);
          outline-offset:-1px;
        }
        .fs-sample{
          width:40px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;
          line-height:1;font-weight:700;
        }
        .fs-label{ flex:1;font-size:15px;font-weight:600; }
      `}</style>

      {open && (
        <>
          {/* 바깥 클릭 시 닫힘 */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1 }} />
          <div
            role="menu"
            aria-label="글자 크기"
            style={{
              position: "absolute",
              bottom: "calc(100% + 10px)",
              right: 0,
              zIndex: 2,
              width: 208,
              background: "var(--surface)",
              border: "1px solid var(--hairline)",
              borderRadius: 16,
              boxShadow: "0 12px 32px rgba(43,39,34,0.14)",
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-faint)", padding: "4px 10px 6px", letterSpacing: 0.4 }}>
              글자 크기
            </div>
            {OPTIONS.map((o) => {
              const sel = level === o.lv;
              return (
                <button
                  key={o.lv}
                  type="button"
                  role="menuitemradio"
                  aria-checked={sel}
                  aria-label={`${o.label} 크기`}
                  className="fs-item"
                  onClick={() => {
                    setLevel(o.lv);
                    setOpen(false);
                  }}
                >
                  <span className="fs-sample" style={{ fontSize: o.sample }} aria-hidden="true">가</span>
                  <span className="fs-label">{o.label}</span>
                  {sel && <Check size={18} strokeWidth={2.4} style={{ color: "var(--accent-strong)", flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </>
      )}

      <button
        type="button"
        className="fs-fab"
        onClick={() => setOpen((v) => !v)}
        aria-label="글자 크기 조절"
        aria-haspopup="menu"
        aria-expanded={open}
        title="글자 크기"
      >
        <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>가</span>
      </button>
    </div>
  );
}
