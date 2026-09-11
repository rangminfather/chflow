"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { CSSProperties } from "react";
import type { BibleVersion } from "@/lib/bible/versions";

/**
 * 성경 본문이 나오는 모든 화면(성경책 메뉴·예배인도 대본 등)에서 공통으로 쓰는 저작권 안내.
 * bible_versions.copyright_slug 가 채워진 역본만 안내·링크를 보여준다 — 저작권 걱정이 없는
 * 역본(개역한글 등 is_public_domain=true)은 slug가 없어 자동으로 아무것도 뜨지 않는다.
 * 새 역본을 저작권 허락을 받아 추가할 때 이 컴포넌트를 다시 손댈 필요는 없다 —
 * bible_versions.copyright_slug 와 copyright_items.slug 만 맞춰 두면 된다.
 */
export default function BibleAttribution({
  version,
}: {
  version: Pick<BibleVersion, "name_ko" | "copyright_slug"> | null | undefined;
}) {
  if (!version?.copyright_slug) return null;
  return (
    <Link href={`/copyright?slug=${encodeURIComponent(version.copyright_slug)}`} style={linkStyle}>
      <ShieldCheck size={12} strokeWidth={2} />
      {version.name_ko} 저작권 안내 및 사용 허가 보기
    </Link>
  );
}

const linkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  marginTop: 10,
  fontSize: 11.5,
  color: "var(--ink-faint)",
  textDecoration: "none",
  borderBottom: "1px dotted var(--hairline-strong)",
  paddingBottom: 1,
  width: "fit-content",
};
