"use client";

import { useRouter } from "next/navigation";

interface HeaderLogoProps {
  size?: number;
  showText?: boolean;
}

export default function HeaderLogo({ size = 40, showText = false }: HeaderLogoProps) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push("/home")}
      title="홈으로"
      style={{
        display: "flex",
        alignItems: "center",
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
          width: size,
          height: size,
          borderRadius: Math.round(size / 4),
          flexShrink: 0,
        }}
      />
      {showText && (
        <span style={{ fontSize: 14, fontWeight: 800, color: "#1e293b", whiteSpace: "nowrap" }}>
          스마트명성
        </span>
      )}
    </button>
  );
}
