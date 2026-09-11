"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type LucideIcon,
  ShieldCheck,
  ScrollText,
  ShieldAlert,
  X,
  ChevronRight,
} from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import ModalBackdrop from "@/components/ModalBackdrop";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { supabase } from "@/lib/supabase";
import {
  COPYRIGHT_STATUS_LABEL,
  isLegacyPublicEvidencePath,
  type PublicCopyrightNotice,
  type CopyrightStatus,
} from "@/lib/copyright";

// 승인/라이선스 구매만 내려오므로(get_public_copyright_notices) 두 상태만 다룬다.
const STATUS_META: Record<string, { label: string; color: string; soft: string; icon: LucideIcon }> = {
  approved: { label: COPYRIGHT_STATUS_LABEL.approved, color: "var(--success)", soft: "var(--success-soft)", icon: ShieldCheck },
  licensed: { label: COPYRIGHT_STATUS_LABEL.licensed, color: "var(--info)", soft: "var(--info-soft)", icon: ScrollText },
};

function evidenceSrc(path: string) {
  return isLegacyPublicEvidencePath(path) ? path : `/api/copyright-notice/evidence?path=${encodeURIComponent(path)}`;
}

async function authedFetch(input: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers();
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(input, { headers });
}

function CopyrightNoticeView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authChecked, setAuthChecked] = useState(false);
  const [items, setItems] = useState<PublicCopyrightNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PublicCopyrightNotice | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      setAuthChecked(true);
    })();
  }, [router]);

  useEffect(() => {
    if (!authChecked) return;
    (async () => {
      setLoading(true);
      const res = await authedFetch("/api/copyright-notice");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setLoadError(json?.error || "저작권 안내를 불러오지 못했습니다");
      } else {
        const list = json.items as PublicCopyrightNotice[];
        setItems(list);
        const wantedSlug = searchParams.get("slug");
        if (wantedSlug) {
          const matched = list.find((item) => item.slug === wantedSlug);
          if (matched) setSelected(matched);
        }
      }
      setLoading(false);
    })();
  }, [authChecked, searchParams]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.assetName.localeCompare(b.assetName)),
    [items]
  );

  if (!authChecked) return <LoadingView label="확인 중..." full />;

  return (
    <div style={pageStyle}>
      <div style={wrapStyle}>
        <header style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HeaderLogo />
            <div>
              <div style={kickerStyle}>COPYRIGHT &amp; LICENSE NOTICE</div>
              <h1 style={titleStyle}>저작권·라이선스 안내</h1>
              <div style={subTitleStyle}>이 앱이 사용 중인 외부 콘텐츠의 저작권 허가 현황입니다</div>
            </div>
          </div>
          <button onClick={() => router.push("/home")} style={ghostButtonStyle}>홈</button>
        </header>

        <section style={noticeStyle}>
          이 앱에서 사용하는 성경 본문·폰트·이미지 등 외부 저작물은 저작권자의 허가를 받아 사용합니다.
          아래 항목을 눌러 저작권자, 허용 범위, 표시 의무 사항을 확인할 수 있습니다.
        </section>

        {loading && <LoadingView label="불러오는 중..." />}
        {!loading && loadError && (
          <EmptyState icon={<ShieldAlert size={22} strokeWidth={1.6} />} message={loadError} />
        )}
        {!loading && !loadError && sorted.length === 0 && (
          <EmptyState icon={<ScrollText size={22} strokeWidth={1.6} />} message="등록된 안내가 없습니다" />
        )}
        {!loading && !loadError && sorted.length > 0 && (
          <section style={gridStyle}>
            {sorted.map((item) => (
              <NoticeCard key={item.id} item={item} onOpen={() => setSelected(item)} />
            ))}
          </section>
        )}
      </div>

      {selected && (
        <NoticeDetailModal item={selected} onClose={() => setSelected(null)} onPreview={setPreviewSrc} />
      )}

      {previewSrc && (
        <ModalBackdrop onClose={() => setPreviewSrc(null)} style={{ zIndex: 300 }}>
          <div onClick={(e) => e.stopPropagation()} style={previewCardStyle}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewSrc} alt="증빙 이미지" style={previewImgStyle} />
            <button onClick={() => setPreviewSrc(null)} style={previewCloseStyle}>닫기</button>
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}

export default function CopyrightNoticePage() {
  return (
    <Suspense fallback={<LoadingView full />}>
      <CopyrightNoticeView />
    </Suspense>
  );
}

function NoticeCard({ item, onOpen }: { item: PublicCopyrightNotice; onOpen: () => void }) {
  const meta = STATUS_META[item.status as CopyrightStatus] ?? STATUS_META.approved;
  const Icon = meta.icon;
  return (
    <button onClick={onOpen} style={cardButtonStyle}>
      <div style={{ ...cardAccentBarStyle, background: meta.color }} />
      <div style={cardBodyStyle}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ ...sealStyle, background: meta.soft, color: meta.color }}>
            <Icon size={20} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={categoryStyle}>{item.category}</div>
            <h2 style={assetNameStyle}>{item.assetName}</h2>
            <div style={rightsHolderStyle}>{item.rightsHolder}</div>
          </div>
          <ChevronRight size={18} style={{ color: "var(--ink-faint)", flexShrink: 0, marginTop: 4 }} />
        </div>
        <span style={{ ...badgeStyle, color: meta.color, background: meta.soft, alignSelf: "flex-start" }}>
          {meta.label}
        </span>
      </div>
    </button>
  );
}

function NoticeDetailModal({
  item, onClose, onPreview,
}: {
  item: PublicCopyrightNotice;
  onClose: () => void;
  onPreview: (src: string) => void;
}) {
  const meta = STATUS_META[item.status as CopyrightStatus] ?? STATUS_META.approved;
  const Icon = meta.icon;
  return (
    <ModalBackdrop onClose={onClose} style={{ zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={certOuterStyle}>
        <div style={certInnerStyle}>
          <button onClick={onClose} style={certCloseStyle} aria-label="닫기"><X size={18} /></button>

          <div style={certHeadStyle}>
            <div style={{ ...sealStyle, width: 56, height: 56, background: meta.soft, color: meta.color }}>
              <Icon size={28} strokeWidth={2} />
            </div>
            <span style={{ ...badgeStyle, color: meta.color, background: meta.soft }}>{meta.label}</span>
            <div style={certKickerStyle}>{item.category}</div>
            <h2 style={certTitleStyle}>{item.assetName}</h2>
            <div style={rightsHolderStyle}>저작권자·공급자 — {item.rightsHolder}</div>
          </div>

          <div style={ornamentDividerStyle}>
            <span style={ornamentLineStyle} /><span style={ornamentDotStyle} /><span style={ornamentLineStyle} />
          </div>

          <div style={fieldGridStyle}>
            <Field label="허용 범위">{item.scope || "—"}</Field>
            <Field label="승인 방식">{item.approvalMethod || "—"}</Field>
            <Field label="승인 일자">{item.approvalDate || "—"}</Field>
            <Field label="표시 의무 사항">{item.requiredNotice || "—"}</Field>
          </div>

          {item.evidenceImagePath && (
            <div style={evidenceWrapStyle}>
              <button
                type="button"
                onClick={() => onPreview(evidenceSrc(item.evidenceImagePath!))}
                style={evidenceFrameButtonStyle}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={evidenceSrc(item.evidenceImagePath)} alt={item.evidenceCaption ?? "증빙 이미지"} style={evidenceThumbStyle} />
              </button>
              {item.evidenceCaption && <div style={evidenceCaptionStyle}>{item.evidenceCaption}</div>}
            </div>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={fieldLabelStyle}>{label}</div>
      <div style={fieldValueStyle}>{children}</div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-soft)",
  fontFamily: "'Noto Sans KR', sans-serif",
  padding: 16,
};

const wrapStyle: React.CSSProperties = {
  maxWidth: 920,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: "16px 18px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 14,
};

const kickerStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.14em",
  color: "var(--brass)",
};

const titleStyle: React.CSSProperties = {
  margin: "2px 0 0",
  fontSize: 20,
  fontWeight: 800,
  color: "var(--ink)",
  fontFamily: "var(--app-serif)",
};

const subTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--ink-soft)",
  marginTop: 3,
};

const ghostButtonStyle: React.CSSProperties = {
  padding: "9px 13px",
  background: "var(--surface)",
  color: "var(--ink-mid)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const noticeStyle: React.CSSProperties = {
  background: "var(--info-soft)",
  color: "var(--info)",
  border: "1px solid var(--info-soft)",
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 12.5,
  lineHeight: 1.6,
  marginBottom: 14,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
  gap: 12,
};

const cardButtonStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  textAlign: "left",
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 10,
  padding: 0,
  overflow: "hidden",
  cursor: "pointer",
  fontFamily: "inherit",
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const cardAccentBarStyle: React.CSSProperties = {
  height: 4,
  width: "100%",
};

const cardBodyStyle: React.CSSProperties = {
  padding: "14px 16px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const sealStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
};

const categoryStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: "0.06em",
  color: "var(--accent)",
  marginBottom: 2,
  textTransform: "uppercase",
};

const assetNameStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 800,
  color: "var(--ink)",
  fontFamily: "var(--app-serif)",
  lineHeight: 1.35,
};

const rightsHolderStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--ink-soft)",
  marginTop: 4,
};

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 12px",
  borderRadius: 999,
  fontSize: 11.5,
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const certOuterStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 560,
  maxHeight: "92vh",
  overflow: "auto",
  borderRadius: 16,
  padding: 6,
  background: "color-mix(in srgb, var(--brass) 30%, transparent)",
};

const certInnerStyle: React.CSSProperties = {
  position: "relative",
  background: "var(--card)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 12,
  padding: "28px 26px 22px",
};

const certCloseStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  display: "grid",
  placeItems: "center",
  width: 28,
  height: 28,
  background: "var(--surface)",
  color: "var(--ink-mid)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 999,
  cursor: "pointer",
};

const certHeadStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 9,
  textAlign: "center",
};

const certKickerStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.08em",
  color: "var(--accent)",
  textTransform: "uppercase",
  marginTop: 4,
};

const certTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 21,
  fontWeight: 800,
  color: "var(--ink)",
  fontFamily: "var(--app-serif)",
  lineHeight: 1.4,
};

const ornamentDividerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  margin: "20px 0 18px",
};

const ornamentLineStyle: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: "var(--hairline-strong)",
};

const ornamentDotStyle: React.CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: "50%",
  background: "var(--brass)",
  flexShrink: 0,
};

const fieldGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: "0.04em",
  color: "var(--ink-faint)",
  textTransform: "uppercase",
  marginBottom: 3,
};

const fieldValueStyle: React.CSSProperties = {
  fontSize: 13.5,
  color: "var(--ink-mid)",
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
};

const evidenceWrapStyle: React.CSSProperties = {
  marginTop: 18,
  paddingTop: 16,
  borderTop: "1px solid var(--hairline)",
};

const evidenceFrameButtonStyle: React.CSSProperties = {
  display: "block",
  padding: 4,
  background: "var(--surface)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 8,
  cursor: "zoom-in",
  width: "100%",
};

const evidenceThumbStyle: React.CSSProperties = {
  maxWidth: "100%",
  maxHeight: 220,
  borderRadius: 5,
  display: "block",
  margin: "0 auto",
};

const evidenceCaptionStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--ink-faint)",
  marginTop: 8,
  textAlign: "center",
};

const previewCardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 10,
  padding: 12,
  maxWidth: "min(1100px, 96vw)",
  maxHeight: "92vh",
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const previewImgStyle: React.CSSProperties = {
  maxWidth: "100%",
  borderRadius: 6,
};

const previewCloseStyle: React.CSSProperties = {
  alignSelf: "flex-end",
  padding: "8px 14px",
  background: "var(--surface)",
  color: "var(--ink-mid)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
};
