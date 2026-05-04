"use client";

import { useRef, ReactNode, CSSProperties, MouseEvent } from "react";

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
export default function ModalBackdrop({ onClose, style, children }: Props) {
  const downOnBgRef = useRef(false);
  return (
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
    </div>
  );
}
