"use client";

import { useRouter } from "next/navigation";

export default function FindPasswordPage() {
  const router = useRouter();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f0f9ff 0%, #fef3c7 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 16px",
        fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
      }}
    >
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: 24,
          padding: "32px 28px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.1)",
          border: "1px solid rgba(255,255,255,0.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <button
            onClick={() => router.push("/login")}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#f1f5f9",
              border: "none",
              fontSize: 16,
              cursor: "pointer",
              color: "#475569",
            }}
          >
            ←
          </button>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>비밀번호 찾기</div>
        </div>

        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", marginBottom: 12 }}>
            담당자 문의 안내
          </div>
          <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7, marginBottom: 24 }}>
            보안 정책에 따라 비밀번호 찾기는<br />
            <strong>관리자를 통해 처리</strong>됩니다.<br /><br />
            아래 연락처로 문의해 주세요.
          </div>
        </div>

        <div
          style={{
            background: "linear-gradient(135deg, #eef2ff, #ede9fe)",
            border: "1px solid #c7d2fe",
            borderRadius: 16,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 24 }}>📞</div>
            <div>
              <div style={{ fontSize: 11, color: "#6366f1", fontWeight: 700 }}>교회 사무실</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>02-0000-0000</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 24 }}>✉️</div>
            <div>
              <div style={{ fontSize: 11, color: "#6366f1", fontWeight: 700 }}>이메일</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>admin@smartms.kr</div>
            </div>
          </div>
        </div>

        <div
          style={{
            fontSize: 11,
            color: "#94a3b8",
            background: "#fef3c7",
            border: "1px solid #fde68a",
            borderRadius: 10,
            padding: "10px 14px",
            lineHeight: 1.6,
          }}
        >
          ℹ️ 본인 확인 후 임시 비밀번호가 발급되며,
          최초 로그인 시 새 비밀번호로 변경하셔야 합니다.
        </div>

        <button
          onClick={() => router.push("/login")}
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: 14,
            fontWeight: 700,
            color: "#475569",
            background: "#f1f5f9",
            border: "none",
            borderRadius: 12,
            cursor: "pointer",
            marginTop: 16,
            fontFamily: "inherit",
          }}
        >
          로그인 화면으로 돌아가기
        </button>
      </div>
    </div>
  );
}
