"use client";

import { useRouter } from "next/navigation";

interface HeaderLogoProps {
  size?: number;
  showText?: boolean;
}

const LOGO_FILL_RATIO = 1;
const LOGO_RADIUS_RATIO = 0.18;

export default function HeaderLogo({ size = 52, showText = false }: HeaderLogoProps) {
  const router = useRouter();
  const imageSize = Math.round(size * LOGO_FILL_RATIO);
  return (
    <button
      onClick={() => router.push("/home")}
      title="홈으로"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <img
        src="/brand-mark-192.png"
        alt="스마트명성"
        style={{
          width: imageSize,
          height: imageSize,
          maxWidth: size,
          maxHeight: size,
          borderRadius: Math.round(size * LOGO_RADIUS_RATIO),
          objectFit: "contain",
          display: "block",
          flexShrink: 0,
        }}
      />
      {showText && (
        <span style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap" }}>
          스마트명성
        </span>
      )}
    </button>
  );
}
