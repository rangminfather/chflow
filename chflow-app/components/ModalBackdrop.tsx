"use client";

import { useRef, useState, useEffect, ReactNode, CSSProperties, MouseEvent } from "react";
import { createPortal } from "react-dom";

interface Props {
  onClose: () => void;
  style?: CSSProperties;
  children: ReactNode;
}

const DEFAULT_STYLE: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 100, padding: 16,
};

// Closes only when pointer goes down AND up on the backdrop itself.
// Prevents accidental dismiss when user drags from inside the modal (e.g. text selection) and releases outside.
//
// Rendered through a portal into <body> so the overlay escapes #app-zoom-root.
// That wrapper carries `zoom: var(--app-zoom)` (글자 확대 접근성); CSS zoom multiplies a
// position:fixed child's vh/inset sizing, which would push the modal past the viewport and
// make it impossible to scroll to the top/bottom. Portaling to <body> keeps fixed + vh/dvh
// relative to the real viewport regardless of the font-scale setting.
export default function ModalBackdrop({ onClose, style, children }: Props) {
  const downOnBgRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(
    <div
      onMouseDown={(e: MouseEvent<HTMLDivElement>) => {
        downOnBgRef.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e: MouseEvent<HTMLDivElement>) => {
        if (downOnBgRef.current && e.target === e.currentTarget) {
          onClose();
        }
        downOnBgRef.current = false;
      }}
      onTouchStart={(e) => {
        downOnBgRef.current = e.target === e.currentTarget;
      }}
      onTouchEnd={(e) => {
        if (downOnBgRef.current && e.target === e.currentTarget) {
          onClose();
        }
        downOnBgRef.current = false;
      }}
      style={{ ...DEFAULT_STYLE, ...style }}
    >
      {children}
    </div>,
    document.body
  );
}
