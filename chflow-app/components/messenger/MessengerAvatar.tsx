import type { CSSProperties } from "react";
import Image from "next/image";

export default function MessengerAvatar({ title, src }: { title: string; src?: string | null }) {
  const initial = (title || "M").trim().slice(0, 1).toUpperCase();
  if (src) return <Image src={src} alt="" width={42} height={42} unoptimized style={avatarStyle} />;
  return <div style={avatarFallbackStyle}>{initial}</div>;
}

const avatarStyle: CSSProperties = { width: 42, height: 42, borderRadius: "50%", objectFit: "cover", background: "var(--bg-soft)", flexShrink: 0, boxShadow: "inset 0 0 0 1px rgba(43,39,34,0.06)" };
const avatarFallbackStyle: CSSProperties = { ...avatarStyle, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent)", fontSize: 15, fontWeight: 900 };
