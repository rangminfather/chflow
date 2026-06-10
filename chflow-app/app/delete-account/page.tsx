"use client";

import { useRouter } from "next/navigation";

export default function DeleteAccountPage() {
  const router = useRouter();

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

          <h3 style={h3Style}>2. 일부만 삭제할 수도 있나요?</h3>
          <p style={pStyle}>
            네, 가능합니다. 요청 시 다음 중 선택할 수 있습니다.
          </p>
          <ul style={ulStyle}>
            <li><strong>전체 삭제</strong>: 계정과 모든 관련 데이터 영구 삭제</li>
            <li><strong>일부 삭제</strong>: 특정 정보(예: 휴대폰 번호, 사진 등)만 선택적으로 삭제</li>
          </ul>

          <h3 style={h3Style}>3. 신청 방법</h3>
          <p style={pStyle}>
            아래 방법 중 한 가지로 신청해 주세요. 본인 확인 후 처리됩니다.
          </p>
          <ul style={ulStyle}>
            <li>
              <strong>이메일</strong>: <a href="mailto:sunsetrome@naver.com" style={linkStyle}>sunsetrome@naver.com</a>
              <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 4 }}>
                제목에 "[탈퇴 요청]" 또는 "[데이터 삭제 요청]"을 적어주세요.
              </div>
            </li>
            <li>
              <strong>관리자 연락처</strong>: 010-2527-2064
            </li>
            <li>
              <strong>앱 내 관리자 문의</strong>: 로그인 후 설정 화면의 관리자 연락처로 문의
            </li>
          </ul>

          <h3 style={h3Style}>4. 처리 기간</h3>
          <ul style={ulStyle}>
            <li>본인 확인 완료 후 <strong>14일 이내</strong> 처리 완료</li>
            <li>처리 완료 시 신청자에게 이메일 또는 문자로 통지</li>
          </ul>

          <h3 style={h3Style}>5. 보존이 필요한 일부 정보</h3>
          <p style={pStyle}>
            관계 법령에 따라 일정 기간 보관이 필요한 정보(예: 부정 이용 방지 기록 등)는 해당 법령이
            정한 기간 동안 보관 후 자동 파기됩니다. 이러한 보존 정보는 다른 목적으로 사용되지 않습니다.
          </p>

          <h3 style={h3Style}>6. 만 14세 미만 아동의 경우</h3>
          <p style={pStyle}>
            만 14세 미만 아동의 계정은 법정대리인(보호자)이 직접 위 방법으로 신청해야 합니다.
            아동 본인이 신청한 경우 보호자 확인 절차가 추가됩니다.
          </p>

          <p style={{ ...pStyle, marginTop: 24, fontSize: 11, color: "var(--ink-faint)" }}>
            본 안내는 2026년 4월 27일부터 적용됩니다. 자세한 개인정보 처리 사항은{" "}
            <a href="/privacy" style={linkStyle}>개인정보 처리방침</a>을 참고하세요.
          </p>
        </div>

        <button
          onClick={() => router.back()}
          style={{
            width: "100%",
            marginTop: 24,
            padding: "14px 16px",
            fontSize: 14,
            fontWeight: 700,
            color: "#fff",
            background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
            border: "none",
            borderRadius: 12,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          확인
        </button>
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
