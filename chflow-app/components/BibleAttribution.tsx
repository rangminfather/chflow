"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * ============================================================================
 * 저작권 있는 성경 역본 본문이 나오는 모든 화면의 표준 안내 배너.
 *
 * 이 컴포넌트 하나가 "표시 의무"를 전담한다 — 새 화면에 NKRV(또는 앞으로 허락받는
 * 다른 역본) 본문을 보여줄 때는:
 *   1) list_bible_versions() 로 그 역본의 copyright_slug 를 받아오고
 *   2) <BibleAttribution slug={그 값} /> 하나만 본문 아래에 붙인다.
 * 문구·색·링크를 화면마다 따로 만들지 않는다 — 저작권자·자료명이 바뀌어도
 * (/admin/copyright 에서 수정) 이 컴포넌트를 쓰는 모든 화면에 자동 반영된다.
 * slug가 없는 역본(저작권 걱정 없는 공개 역본)은 아무것도 렌더링하지 않는다.
 * ============================================================================
 */
export default function BibleAttribution({ slug }: { slug: string | null | undefined }) {
  const [notice, setNotice] = useState<{ assetName: string; rightsHolder: string; slug: string } | null>(null);

  useEffect(() => {
    if (!slug) { setNotice(null); return; }
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = new Headers();
      if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
      const res = await fetch(`/api/copyright-notice?slug=${encodeURIComponent(slug)}`, { headers });
      const json = await res.json().catch(() => null) as { ok?: boolean; items?: Array<{ assetName: string; rightsHolder: string; slug: string | null }> } | null;
      if (cancelled) return;
      const item = json?.ok ? json.items?.[0] : undefined;
      setNotice(item ? { assetName: item.assetName, rightsHolder: item.rightsHolder, slug: item.slug ?? slug } : null);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (!slug || !notice) return null;

  return (
    <div style={bannerStyle}>
      <ShieldCheck size={17} strokeWidth={2.2} style={{ flexShrink: 0, color: "var(--warning)", marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={ownerStyle}>저작권 소유: {notice.rightsHolder}</strong>
        <div style={subStyle}>{notice.assetName} — 허락받은 범위 안에서 사용 중입니다</div>
      </div>
      <Link href={`/copyright?slug=${encodeURIComponent(notice.slug)}`} style={linkStyle}>
        사용 허가 내용 보기 →
      </Link>
    </div>
  );
}

const bannerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  marginTop: 14,
  padding: "11px 13px",
  borderRadius: 8,
  background: "color-mix(in srgb, var(--warning) 14%, var(--surface))",
  border: "1px solid color-mix(in srgb, var(--warning) 45%, transparent)",
  flexWrap: "wrap",
};

const ownerStyle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 800,
  color: "var(--ink)",
};

const subStyle: CSSProperties = {
  fontSize: 11.5,
  color: "var(--ink-soft)",
  marginTop: 2,
};

const linkStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 12,
  fontWeight: 800,
  color: "var(--warning)",
  textDecoration: "none",
  whiteSpace: "nowrap",
  marginLeft: "auto",
};
