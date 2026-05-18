"use client";

import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";

export default function AdminReviewMdbPage() {
  const router = useRouter();

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <HeaderLogo />
        <div style={titleStyle}>MDB 병합검수 종료</div>
        <div style={bodyStyle}>
          MDB 병합과 보류 정리가 완료되어 이 페이지는 운영 메뉴에서 닫았습니다.
          이후 수정은 회원관리에서 개별 회원 기준으로 진행합니다.
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
  background: "#f8fafc",
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
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: 28,
  boxShadow: "0 12px 30px rgba(15,23,42,0.08)",
};

const titleStyle: React.CSSProperties = {
  marginTop: 18,
  fontSize: 22,
  fontWeight: 900,
  color: "#0f172a",
};

const bodyStyle: React.CSSProperties = {
  marginTop: 10,
  fontSize: 14,
  lineHeight: 1.7,
  color: "#475569",
};

const buttonStyle: React.CSSProperties = {
  marginTop: 22,
  padding: "10px 14px",
  border: 0,
  borderRadius: 6,
  background: "#2563eb",
  color: "#fff",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};
