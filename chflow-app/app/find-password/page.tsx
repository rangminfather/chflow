"use client";

import { useRouter } from "next/navigation";

export default function FindPasswordPage() {
  const router = useRouter();

  return (
    <main className="login-screen">

      <section className="login-panel">
        <div className="auth-topbar">
          <button
            onClick={() => router.push("/login")}
            className="auth-back-button"
            aria-label="로그인으로 돌아가기"
          >
            ←
          </button>
          <div className="auth-page-title">비밀번호 찾기</div>
        </div>

        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
          <div style={{ fontSize: 17, fontWeight: 850, color: "var(--ink)", marginBottom: 12 }}>
            담당자 문의 안내
          </div>
          <div className="auth-copy" style={{ marginBottom: 24 }}>
            보안 정책에 따라 비밀번호 찾기는<br />
            <strong>관리자를 통해 처리</strong>됩니다.<br /><br />
            아래 연락처로 문의해 주세요.
          </div>
        </div>

        <div
          style={{
            background: "#f3f7f1",
            border: "1px solid rgba(62, 90, 74, 0.16)",
            borderRadius: 8,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 24 }}>📞</div>
            <div>
              <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 800 }}>관리자 연락처</div>
              <div style={{ fontSize: 16, fontWeight: 850, color: "var(--ink)" }}>010-2527-2064</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 24 }}>✉️</div>
            <div>
              <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 800 }}>이메일</div>
              <div style={{ fontSize: 14, fontWeight: 750, color: "var(--ink)" }}>sunsetrome@naver.com</div>
            </div>
          </div>
        </div>

        <div
          style={{
            fontSize: 11,
            color: "var(--ink-soft)",
            background: "rgba(234, 239, 232, 0.72)",
            border: "1px solid rgba(62, 90, 74, 0.14)",
            borderRadius: 8,
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
            height: 54,
            padding: "0 16px",
            fontSize: 15,
            fontWeight: 800,
            color: "var(--accent)",
            background: "var(--accent-soft)",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            marginTop: 16,
            fontFamily: "inherit",
          }}
        >
          로그인 화면으로 돌아가기
        </button>
      </section>
    </main>
  );
}
