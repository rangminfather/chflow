"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function DeleteAccountPage() {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleWithdraw = async () => {
    if (!window.confirm("탈퇴하면 로그인 계정은 삭제되고, 소속 부서에서는 자동 탈퇴됩니다. 작성 글과 생성물은 보존됩니다. 계속하시겠습니까?")) return;
    setBusy(true);
    setError("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setBusy(false);
      setError("로그인 세션을 확인할 수 없습니다.");
      return;
    }

    const response = await fetch("/api/account/withdraw", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ reason }),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      setBusy(false);
      setError(result?.error || "탈퇴 처리에 실패했습니다.");
      return;
    }

    await supabase.auth.signOut();
    router.replace("/login?withdrawn=1");
  };

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button onClick={() => router.back()} style={{
            width: 36, height: 36, borderRadius: 10, background: "var(--bg-soft)",
            border: "none", fontSize: 16, cursor: "pointer", color: "var(--ink-mid)",
          }}>←</button>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>계정 및 데이터 삭제 요청</div>
        </div>

        <div style={{ fontSize: 13, color: "var(--ink-mid)", lineHeight: 1.75 }}>
          <p style={pStyle}>
            <strong>스마트명성</strong>은 이용자가 언제든지 본인의 계정과 관련된 개인정보의 삭제를 요청할 수 있도록 합니다.
            아래 안내에 따라 신청하시면 처리해 드립니다.
          </p>

          <h3 style={h3Style}>1. 어떤 데이터가 삭제되나요?</h3>
          <ul style={ulStyle}>
            <li>로그인 계정 (아이디, 암호화된 비밀번호)</li>
            <li>본인의 이름, 휴대폰 번호, 이메일</li>
            <li>가입 시 자동 매칭된 교적 정보 연결 (개인 사용 이력)</li>
            <li>앱 내 활동 기록 (로그인 이력, 알림 설정 등)</li>
          </ul>
          <p style={pStyle}>
            교회 공동체의 교적 자체(가족 구성·목장 소속 등 교적 원본)는 교회 사역 운영 목적으로 별도 보관될 수 있으며,
            이는 교회 사무실에 직접 문의하셔야 합니다.
          </p>

          <h3 style={h3Style}>2. 탈퇴 시 기본 처리</h3>
          <p style={pStyle}>
            회원 탈퇴는 아래 기준으로 처리됩니다. 작성 콘텐츠는 다른 자료와 연결될 수 있어 자동으로 지우지 않습니다.
          </p>
          <ul style={ulStyle}>
            <li><strong>삭제</strong>: 로그인 아이디와 인증 계정, 개인 앱 활동 정보</li>
            <li><strong>자동 탈퇴</strong>: 학부모·교사·사역 역할을 포함한 모든 부서 소속</li>
            <li><strong>보존</strong>: 교적 원본과 작성 글·댓글·생성물은 탈퇴 회원으로 관리</li>
          </ul>

          <h3 style={h3Style}>3. 탈퇴 방법</h3>
          <p style={pStyle}>
            아래 버튼으로 본인 계정에서 즉시 탈퇴할 수 있습니다. 탈퇴 시 로그인 계정은 삭제되고,
            모든 부서 소속과 교사·학부모 등 역할은 자동 해제됩니다.
          </p>
          <ul style={ulStyle}>
            <li>교적 원본은 탈퇴 회원으로 보관될 수 있습니다.</li>
            <li>작성 글·댓글·생성물은 파생 자료와의 연결을 위해 자동 삭제하지 않습니다.</li>
            <li>관리자는 별도 관리 화면에서 탈퇴 회원과 콘텐츠를 보관·정리할 수 있습니다.</li>
          </ul>

          <h3 style={h3Style}>4. 탈퇴 사유 (선택)</h3>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="탈퇴 사유를 남기실 수 있습니다."
            style={{ width: "100%", minHeight: 84, resize: "vertical", padding: 10, border: "1px solid var(--hairline)", borderRadius: 10, background: "var(--card)", color: "var(--ink)", font: "inherit", boxSizing: "border-box" }}
          />

          <h3 style={h3Style}>5. 처리 기간</h3>
          <ul style={ulStyle}>
            <li>버튼을 누르면 즉시 처리됩니다.</li>
            <li>처리 후에는 같은 아이디로 로그인할 수 없습니다.</li>
          </ul>

          <h3 style={h3Style}>6. 보존이 필요한 일부 정보</h3>
          <p style={pStyle}>
            관계 법령에 따라 일정 기간 보관이 필요한 정보(예: 부정 이용 방지 기록 등)는 해당 법령이
            정한 기간 동안 보관 후 자동 파기됩니다. 이러한 보존 정보는 다른 목적으로 사용되지 않습니다.
          </p>

          <h3 style={h3Style}>7. 만 14세 미만 아동의 경우</h3>
          <p style={pStyle}>
            만 14세 미만 아동의 계정은 법정대리인(보호자)이 직접 위 방법으로 신청해야 합니다.
            아동 본인이 신청한 경우 보호자 확인 절차가 추가됩니다.
          </p>

          <p style={{ ...pStyle, marginTop: 24, fontSize: 11, color: "var(--ink-faint)" }}>
            본 안내는 2026년 4월 27일부터 적용됩니다. 자세한 개인정보 처리 사항은{" "}
            <a href="/privacy" style={linkStyle}>개인정보 처리방침</a>을 참고하세요.
          </p>
        </div>

        {error && <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 10, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
          <button onClick={() => router.back()} disabled={busy} style={{ flex: 1, padding: "14px 16px", fontSize: 14, fontWeight: 700, color: "var(--ink-mid)", background: "var(--bg-soft)", border: "none", borderRadius: 12, cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}>
            돌아가기
          </button>
          <button onClick={handleWithdraw} disabled={busy} style={{ flex: 1, padding: "14px 16px", fontSize: 14, fontWeight: 700, color: "#fff", background: busy ? "var(--ink-faint)" : "var(--danger)", border: "none", borderRadius: 12, cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}>
            {busy ? "탈퇴 처리 중…" : "회원 탈퇴"}
          </button>
        </div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(135deg, var(--info-soft) 0%, var(--warning-soft) 100%)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "20px 16px",
  fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 560,
  background: "color-mix(in srgb, var(--card) 95%, transparent)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  borderRadius: 24,
  padding: "28px 24px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.1)",
  border: "1px solid rgba(255,255,255,0.6)",
};

const h3Style: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: "var(--ink)",
  marginTop: 18,
  marginBottom: 8,
};

const pStyle: React.CSSProperties = {
  margin: "8px 0",
};

const ulStyle: React.CSSProperties = {
  margin: "8px 0",
  paddingLeft: 20,
};

const linkStyle: React.CSSProperties = {
  color: "var(--accent)",
  textDecoration: "underline",
  fontWeight: 600,
};
