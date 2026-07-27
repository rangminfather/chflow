"use client";

import { useRouter } from "next/navigation";

export default function PrivacyPage() {
  const router = useRouter();

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) router.back();
            else router.push("/signup");
          }} style={{
            width: 36, height: 36, borderRadius: 10, background: "var(--bg-soft)",
            border: "none", fontSize: 16, cursor: "pointer", color: "var(--ink-mid)",
          }}>←</button>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>개인정보 처리방침</div>
        </div>

        <div style={{ fontSize: 13, color: "var(--ink-mid)", lineHeight: 1.75 }}>
          <p style={pStyle}>
            <strong>스마트명성</strong>(이하 &ldquo;서비스&rdquo;)은 명성교회 회원 관리 및 사역 지원을 목적으로
            아래와 같이 개인정보를 수집·이용하며, 회원의 개인정보를 중요시하고 「개인정보 보호법」을 준수합니다.
          </p>

          <h3 style={h3Style}>1. 수집하는 개인정보 항목</h3>
          <p style={pStyle}>
            서비스는 회원가입, 본인 확인, 교회 사역 운영을 위해 다음과 같은 개인정보를 수집합니다.
          </p>
          <ul style={ulStyle}>
            <li><strong>필수 항목</strong>: 이름, 휴대폰 번호, 아이디, 비밀번호, 직분(세부직분 포함)</li>
            <li><strong>매칭 시 자동 연결</strong>: 가정교회(평원·초원·목장), 주소, 가족 관계 정보</li>
            <li><strong>만 14세 미만 회원</strong>: 본인 정보 외에 보호자(부모) 이름, 보호자 휴대폰 번호</li>
            <li><strong>알림 서비스 이용 시</strong>: 기기 푸시 알림 토큰, 기기 운영체제(OS) 정보</li>
          </ul>
          <p style={{ ...pStyle, fontSize: 12, color: "var(--ink-soft)" }}>
            ※ 회원은 위 개인정보 수집·이용에 대한 동의를 거부할 권리가 있습니다.
            다만 필수 항목에 대한 동의를 거부하시는 경우 회원가입 및 서비스 이용이 제한됩니다.
          </p>

          <h3 style={h3Style}>2. 개인정보의 수집 및 이용 목적</h3>
          <ul style={ulStyle}>
            <li>회원 가입 및 본인 확인</li>
            <li>교적 관리, 출석 관리, 사역 배정 등 교회 통합 관리</li>
            <li>가족·목장 단위 커뮤니케이션 및 공지 전달</li>
            <li>서비스 운영, 부정 이용 방지, 문의 응대</li>
          </ul>

          <h3 style={h3Style}>3. 보유 및 이용 기간</h3>
          <ul style={ulStyle}>
            <li>회원 탈퇴 또는 교적 이전 시 즉시 파기</li>
            <li>관계 법령에 따라 보존이 필요한 경우 해당 법령에서 정한 기간 동안 보관</li>
          </ul>

          <h3 style={h3Style}>4. 만 14세 미만 아동의 개인정보</h3>
          <p style={pStyle}>
            만 14세 미만 아동의 회원가입 시 법정대리인(부모 등 보호자)의 동의를 필수로 받습니다.
            동의 확인을 위해 보호자의 이름과 연락처를 함께 수집·이용하며, 이는 본인 확인 외의 목적으로
            사용되지 않습니다.
          </p>

          <h3 style={h3Style}>5. 개인정보의 제3자 제공</h3>
          <p style={pStyle}>
            서비스는 원칙적으로 회원의 개인정보를 외부에 제공하지 않습니다. 다만, 법령에 의하거나
            수사 기관의 적법한 요청이 있는 경우에 한하여 제공할 수 있습니다.
          </p>

          <h3 style={h3Style}>6. 개인정보 처리위탁 및 국외 이전</h3>
          <p style={pStyle}>
            서비스는 원활한 운영을 위해 아래와 같이 개인정보 처리를 위탁하고 있으며,
            일부 정보는 국외 서버에 저장·처리됩니다.
          </p>
          <p style={{ ...pStyle, fontWeight: 700, color: "var(--ink)" }}>국내 위탁</p>
          <ul style={ulStyle}>
            <li>본인확인(본인인증 방식 가입 시): 네이버, 카카오 — 이름, 휴대폰 번호</li>
          </ul>
          <p style={{ ...pStyle, fontWeight: 700, color: "var(--ink)" }}>국외 이전</p>
          <ul style={ulStyle}>
            <li><strong>Supabase</strong>: 회원정보 전체 / 데이터 저장·인증·파일 보관 / 이전 국가: 일본(도쿄)</li>
            <li><strong>Vercel</strong>: 서비스 처리 중 경유하는 정보 / 서비스 호스팅 / 이전 국가: 미국</li>
            <li><strong>Cloudflare(R2)</strong>: 첨부파일·사진 / 파일 저장 / 이전 국가: 미국</li>
            <li><strong>Google(Firebase)·Expo</strong>: 기기 푸시 알림 토큰 / 알림 발송 / 이전 국가: 미국</li>
          </ul>
          <p style={{ ...pStyle, fontSize: 12, color: "var(--ink-soft)" }}>
            ※ 이전 방법: 서비스 이용 과정에서 정보통신망을 통해 전송 · 보유·이용 기간: 회원 탈퇴 또는 위탁계약 종료 시까지
          </p>

          <h3 style={h3Style}>7. 개인정보의 안전성 확보 조치</h3>
          <ul style={ulStyle}>
            <li>비밀번호 단방향 암호화 저장</li>
            <li>전송 구간 HTTPS 암호화</li>
            <li>관리자 권한 분리 및 접근 통제</li>
          </ul>

          <h3 style={h3Style}>8. 이용자 권리</h3>
          <p style={pStyle}>
            회원은 언제든지 본인의 개인정보를 조회·수정·삭제할 수 있으며, 가입 동의를 철회(회원 탈퇴)할 수 있습니다.
            요청은 앱 내 설정 메뉴 또는 관리자에게 문의하여 처리할 수 있습니다.
          </p>

          <h3 style={h3Style}>9. 개인정보 보호책임자</h3>
          <ul style={ulStyle}>
            <li>소속: 명성교회</li>
            <li>문의: 교회 사무실 또는 앱 관리자</li>
          </ul>

          <p style={{ ...pStyle, marginTop: 24, fontSize: 11, color: "var(--ink-faint)" }}>
            본 방침은 2026년 7월 27일부터 적용됩니다.
          </p>
        </div>

        <button
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) router.back();
            else router.push("/signup");
          }}
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
