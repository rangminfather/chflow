"use client";

import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";

export default function AdminPhotoReviewClosedPage() {
  const router = useRouter();

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <HeaderLogo />
        <div style={titleStyle}>사진 검수 종료</div>
        <div style={bodyStyle}>
          요람 사진 매칭 검수는 완료되어 운영 메뉴에서 닫았습니다.
          이후 사진 변경은 회원관리의 성도 카드에서 개별 회원 기준으로 진행합니다.
        </div>
        <button onClick={() => router.push("/admin/members")} style={buttonStyle}>
          회원관리로 이동
        </button>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--surface)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  fontFamily: "'Noto Sans KR', sans-serif",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 520,
  background: "#fff",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: 28,
  boxShadow: "0 12px 30px rgba(43, 39, 34,0.08)",
};

const titleStyle: React.CSSProperties = {
  marginTop: 18,
  fontSize: 22,
  fontWeight: 800,
  color: "var(--ink)",
};

const bodyStyle: React.CSSProperties = {
  marginTop: 10,
  fontSize: 14,
  lineHeight: 1.7,
  color: "var(--ink-mid)",
};

const buttonStyle: React.CSSProperties = {
  marginTop: 22,
  minHeight: 40,
  padding: "0 14px",
  border: 0,
  borderRadius: 6,
  background: "var(--accent)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
};
