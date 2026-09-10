"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import ModalBackdrop from "@/components/ModalBackdrop";
import { supabase } from "@/lib/supabase";

type CopyrightStatus = "approved" | "licensed" | "pending" | "unconfirmed";

interface CopyrightItem {
  id: string;
  category: string;
  assetName: string;
  rightsHolder: string;
  status: CopyrightStatus;
  scope: string;
  approvalMethod: string;
  approvalDate: string;
  requiredNotice: string;
  evidenceImage?: string;
  evidenceCaption?: string;
  notes?: string;
}

// 새 저작권/라이선스 건은 이 배열에 항목을 추가하면 자동으로 카드가 늘어난다.
const COPYRIGHT_ITEMS: CopyrightItem[] = [
  {
    id: "nkrv-bskorea",
    category: "성경 본문",
    assetName: "개역개정 (NKRV, New Korean Revised Version)",
    rightsHolder: "(재)대한성서공회",
    status: "approved",
    scope: "울산동구 명성교회 성도용 앱에 한해 무료 사용 허가 (불특정 다수 대상 배포·상업적 목적 아님을 전제)",
    approvalMethod: "이메일 승인 — (재)대한성서공회 저작권부(kbscopyright@bskorea.or.kr)",
    approvalDate: "2026-09-09",
    requiredNotice: "본문 표기를 정확히 하고, 성경전서 개역개정의 저작권이 (재)대한성서공회에 있음을 저작권 표시로 명시할 것",
    evidenceImage: "/copyright/nkrv-bskorea-approval-redacted.png",
    evidenceCaption: "대한성서공회 저작권부 승인 이메일 (2026-09-09 · 수신자 개인 이메일 주소는 가림 처리)",
    notes: "승인 범위가 '교회 성도 특정 앱'으로 한정되어 있으므로, 추후 앱 공개 범위·배포 방식이 바뀌면 재확인이 필요하다.",
  },
];

const STATUS_LABEL: Record<CopyrightStatus, string> = {
  approved: "정식 승인",
  licensed: "라이선스 구매",
  pending: "검토·확인 중",
  unconfirmed: "미확인",
};

const STATUS_COLOR: Record<CopyrightStatus, { fg: string; bg: string }> = {
  approved: { fg: "var(--success)", bg: "var(--success-soft)" },
  licensed: { fg: "var(--info)", bg: "var(--info-soft)" },
  pending: { fg: "var(--warning)", bg: "var(--warning-soft)" },
  unconfirmed: { fg: "var(--danger)", bg: "var(--danger-soft)" },
};

export default function AdminCopyrightPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role !== "admin") {
        router.replace("/home");
        return;
      }
      setAuthChecked(true);
    })();
  }, [router]);

  if (!authChecked) {
    return <div style={loadingPageStyle}>권한 확인 중...</div>;
  }

  return (
    <div style={pageStyle}>
      <div style={wrapStyle}>
        <header style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HeaderLogo />
            <div>
              <h1 style={titleStyle}>저작권 관련</h1>
              <div style={subTitleStyle}>외부 연동 콘텐츠의 저작권 허가·라이선스 대응 현황</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => router.push("/home")} style={ghostButtonStyle}>홈</button>
          </div>
        </header>

        <section style={noticeStyle}>
          이 페이지는 이 시스템에 연동하는 저작권 보호 콘텐츠(성경 번역본, 폰트, 외부 자료 등)에 대해
          정식 허가·라이선스 구매·기타 대응 근거를 남기기 위한 기록입니다. 항목은 계속 추가됩니다.
        </section>

        <section style={{ display: "grid", gap: 14 }}>
          {COPYRIGHT_ITEMS.map((item) => (
            <CopyrightCard key={item.id} item={item} onPreview={setPreviewSrc} />
          ))}
        </section>
      </div>

      {previewSrc && (
        <ModalBackdrop onClose={() => setPreviewSrc(null)} style={{ zIndex: 200 }}>
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

function CopyrightCard({ item, onPreview }: { item: CopyrightItem; onPreview: (src: string) => void }) {
  const color = STATUS_COLOR[item.status];
  return (
    <section style={cardStyle}>
      <div style={cardHeaderStyle}>
        <div>
          <div style={categoryStyle}>{item.category}</div>
          <h2 style={assetNameStyle}>{item.assetName}</h2>
          <div style={rightsHolderStyle}>저작권자·공급자: {item.rightsHolder}</div>
        </div>
        <span style={{ ...badgeStyle, color: color.fg, background: color.bg }}>
          {STATUS_LABEL[item.status]}
        </span>
      </div>

      <div style={fieldGridStyle}>
        <Field label="허용 범위">{item.scope}</Field>
        <Field label="승인 방식">{item.approvalMethod}</Field>
        <Field label="승인 일자">{item.approvalDate}</Field>
        <Field label="표시 의무 사항">{item.requiredNotice}</Field>
        {item.notes && <Field label="비고">{item.notes}</Field>}
      </div>

      {item.evidenceImage && (
        <div style={evidenceWrapStyle}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.evidenceImage}
            alt={item.evidenceCaption ?? "증빙 이미지"}
            style={evidenceThumbStyle}
            onClick={() => onPreview(item.evidenceImage!)}
          />
          <div style={evidenceCaptionStyle}>{item.evidenceCaption}</div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={fieldLabelStyle}>{label}</div>
      <div style={fieldValueStyle}>{children}</div>
    </div>
  );
}

const loadingPageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--bg-soft)",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-soft)",
  fontFamily: "'Noto Sans KR', sans-serif",
  padding: 16,
};

const wrapStyle: React.CSSProperties = {
  maxWidth: 900,
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

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 800,
  color: "var(--ink)",
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
  fontWeight: 800,
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

const cardStyle: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: 18,
};

const cardHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 14,
  paddingBottom: 14,
  borderBottom: "1px solid var(--hairline)",
};

const categoryStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  color: "var(--accent)",
  marginBottom: 2,
};

const assetNameStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 800,
  color: "var(--ink)",
};

const rightsHolderStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--ink-soft)",
  marginTop: 4,
};

const badgeStyle: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const fieldGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  color: "var(--ink-soft)",
  marginBottom: 2,
};

const fieldValueStyle: React.CSSProperties = {
  fontSize: 13.5,
  color: "var(--ink-mid)",
  lineHeight: 1.55,
};

const evidenceWrapStyle: React.CSSProperties = {
  marginTop: 14,
  paddingTop: 14,
  borderTop: "1px solid var(--hairline)",
};

const evidenceThumbStyle: React.CSSProperties = {
  maxWidth: "100%",
  maxHeight: 220,
  borderRadius: 6,
  border: "1px solid var(--hairline-strong)",
  cursor: "zoom-in",
  display: "block",
};

const evidenceCaptionStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--ink-soft)",
  marginTop: 6,
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
