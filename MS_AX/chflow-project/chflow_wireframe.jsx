import React, { useState } from "react";

const ROLES = [
  { id: "admin", label: "시스템관리자", icon: "⚙️", color: "#6366f1" },
  { id: "pastor", label: "목회자", icon: "✝️", color: "#8b5cf6" },
  { id: "office", label: "사무", icon: "🏢", color: "#3b82f6" },
  { id: "finance", label: "재정부", icon: "💰", color: "#10b981" },
  { id: "leader", label: "목자", icon: "👥", color: "#f59e0b" },
  { id: "member", label: "일반성도", icon: "🙋", color: "#ef4444" },
];

const sitemapData = [
  { group: "공통", color: "#64748b", pages: [
    { name: "로그인", desc: "이메일/비밀번호" },
    { name: "내 정보", desc: "프로필 조회/수정" },
    { name: "비밀번호 변경", desc: "" },
  ]},
  { group: "교회 소식", color: "#0ea5e9", pages: [
    { name: "주보 보기", desc: "주간 교회 주보 열람" },
    { name: "행사 공지", desc: "교회 행사/공지사항 목록" },
    { name: "행사 달력", desc: "월간 교회 행사 캘린더" },
    { name: "성도 요람 조회", desc: "성도 연락처/사진 검색" },
  ]},
  { group: "성도 관리", color: "#3b82f6", pages: [
    { name: "성도 목록/검색", desc: "이름·목장·상태 필터" },
    { name: "성도 등록 폼", desc: "관리자 직접 입력" },
    { name: "성도 상세/수정", desc: "정보 수정·사진 업로드" },
    { name: "목장 배정 관리", desc: "목장 이동·이력" },
  ]},
  { group: "재정", color: "#10b981", pages: [
    { name: "헌금 입력", desc: "주간 성도별 헌금 입력 폼" },
    { name: "헌금 집계/리포트", desc: "주간·월간·연간 통계" },
    { name: "재정 청구 목록", desc: "신청·승인·반려 현황" },
    { name: "재정 청구 신청 폼", desc: "금액·용도·영수증" },
    { name: "재정 승인 처리", desc: "승인/반려 + 코멘트" },
    { name: "수입/지출 대시보드", desc: "월별 추이 차트" },
  ]},
  { group: "예약", color: "#f59e0b", pages: [
    { name: "시설 이용 신청 폼", desc: "날짜·시간·목적" },
    { name: "차량 이용 신청 폼", desc: "날짜·목적지·인원" },
    { name: "예약 캘린더", desc: "시설/차량별 현황" },
    { name: "예약 승인 처리", desc: "승인/반려" },
    { name: "내 신청 내역", desc: "진행상태 확인" },
  ]},
  { group: "목장 활동", color: "#8b5cf6", pages: [
    { name: "목장원 목록", desc: "연락처·사진 조회" },
    { name: "목장 일정 등록", desc: "날짜·시간·장소 입력" },
    { name: "목장 캘린더", desc: "월간 일정 뷰" },
    { name: "참석 응답", desc: "참석/불참/미정" },
    { name: "참석 현황", desc: "일정별 응답 집계" },
  ]},
  { group: "삶공부", color: "#ec4899", pages: [
    { name: "과정 관리", desc: "과목·학기·기간 설정" },
    { name: "수강 현황", desc: "성도별 이수 현황" },
  ]},
  { group: "시스템", color: "#64748b", pages: [
    { name: "사용자 계정 관리", desc: "계정 생성·역할 부여" },
    { name: "데이터 백업", desc: "수동 CSV/JSON 내보내기" },
    { name: "시스템 설정", desc: "교회 기본정보·목장 설정" },
  ]},
];

const roleAccess = {
  admin: ["로그인","내 정보","비밀번호 변경","주보 보기","행사 공지","행사 달력","성도 요람 조회","성도 목록/검색","성도 등록 폼","성도 상세/수정","목장 배정 관리","헌금 입력","헌금 집계/리포트","재정 청구 목록","재정 청구 신청 폼","재정 승인 처리","수입/지출 대시보드","시설 이용 신청 폼","차량 이용 신청 폼","예약 캘린더","예약 승인 처리","내 신청 내역","목장원 목록","목장 일정 등록","목장 캘린더","참석 응답","참석 현황","과정 관리","수강 현황","사용자 계정 관리","데이터 백업","시스템 설정"],
  pastor: ["로그인","내 정보","비밀번호 변경","주보 보기","행사 공지","행사 달력","성도 요람 조회","성도 목록/검색","성도 상세/수정","목장 배정 관리","헌금 집계/리포트","재정 청구 목록","수입/지출 대시보드","예약 캘린더","목장원 목록","목장 캘린더","참석 현황","과정 관리","수강 현황"],
  office: ["로그인","내 정보","비밀번호 변경","주보 보기","행사 공지","행사 달력","성도 요람 조회","성도 목록/검색","성도 등록 폼","성도 상세/수정","목장 배정 관리","예약 캘린더","예약 승인 처리","시설 이용 신청 폼","차량 이용 신청 폼","내 신청 내역","과정 관리","수강 현황"],
  finance: ["로그인","내 정보","비밀번호 변경","주보 보기","행사 공지","행사 달력","성도 요람 조회","헌금 입력","헌금 집계/리포트","재정 청구 목록","재정 청구 신청 폼","재정 승인 처리","수입/지출 대시보드"],
  leader: ["로그인","내 정보","비밀번호 변경","주보 보기","행사 공지","행사 달력","성도 요람 조회","목장원 목록","목장 일정 등록","목장 캘린더","참석 응답","참석 현황","시설 이용 신청 폼","차량 이용 신청 폼","내 신청 내역","재정 청구 신청 폼","재정 청구 목록"],
  member: ["로그인","내 정보","비밀번호 변경","주보 보기","행사 공지","행사 달력","성도 요람 조회","목장 캘린더","참석 응답","시설 이용 신청 폼","차량 이용 신청 폼","내 신청 내역","재정 청구 신청 폼","재정 청구 목록"],
};

const dashboards = {
  admin: {
    stats: [
      { label: "전체 성도", value: "487", sub: "+3 이번 달", icon: "👤" },
      { label: "활성 목장", value: "24", sub: "목장", icon: "🏘️" },
      { label: "미처리 신청", value: "5", sub: "승인 대기", icon: "📋" },
      { label: "이번 달 헌금", value: "₩32.5M", sub: "+8% 전월대비", icon: "💵" },
    ],
    quickMenu: ["사용자 계정 관리", "시스템 설정", "데이터 백업", "성도 등록"],
    widgets: [
      { title: "최근 활동 로그", type: "list", items: ["김철수 사무 - 성도 3명 등록", "이영희 재정부 - 주간 헌금 입력", "박목자 - 4목장 일정 등록", "시스템 - 자동 백업 완료"] },
      { title: "역할별 사용자 현황", type: "bar" },
    ]
  },
  pastor: {
    stats: [
      { label: "전체 성도", value: "487", sub: "활동 452 / 비활동 35", icon: "👤" },
      { label: "삶공부 이수율", value: "68%", sub: "332명 / 487명", icon: "📖" },
      { label: "이번 주 출석", value: "423", sub: "86.9%", icon: "✅" },
      { label: "목장 참석률", value: "72%", sub: "지난 달 기준", icon: "🤝" },
    ],
    quickMenu: ["성도 검색", "목장별 현황", "삶공부 현황", "재정 리포트"],
    widgets: [
      { title: "목장별 참석 현황", type: "bar" },
      { title: "새신자 / 등록 추이", type: "chart" },
    ]
  },
  office: {
    stats: [
      { label: "전체 성도", value: "487", sub: "관리 중", icon: "👤" },
      { label: "미승인 예약", value: "3", sub: "시설2 / 차량1", icon: "📅" },
      { label: "이번 달 등록", value: "3", sub: "신규 성도", icon: "✨" },
      { label: "삶공부 진행", value: "4", sub: "과정 운영 중", icon: "📖" },
    ],
    quickMenu: ["성도 등록", "성도 검색", "예약 승인", "목장 배정"],
    widgets: [
      { title: "최근 등록 성도", type: "list", items: ["홍길동 (3/28)", "김미영 (3/25)", "박철수 (3/22)"] },
      { title: "예약 승인 대기", type: "list", items: ["교육관 - 청년부 (3/31)", "차량1 - 봉사팀 (4/2)", "체육관 - 체육부 (4/5)"] },
    ]
  },
  finance: {
    stats: [
      { label: "이번 주 헌금", value: "₩8.2M", sub: "입력 완료", icon: "💰" },
      { label: "이번 달 누계", value: "₩32.5M", sub: "+8% 전월대비", icon: "📈" },
      { label: "미승인 청구", value: "2", sub: "건 대기 중", icon: "📋" },
      { label: "이번 달 지출", value: "₩5.8M", sub: "예산 대비 48%", icon: "💳" },
    ],
    quickMenu: ["헌금 입력", "헌금 집계", "재정 청구 승인", "수입/지출 현황"],
    widgets: [
      { title: "월별 헌금 추이", type: "chart" },
      { title: "재정 청구 대기", type: "list", items: ["청년부 수련회 ₩1,200,000", "주방용품 구매 ₩350,000"] },
    ]
  },
  leader: {
    stats: [
      { label: "목장원", value: "12", sub: "4목장 소속", icon: "👥" },
      { label: "다음 모임", value: "4/3", sub: "목요일 7시", icon: "📅" },
      { label: "참석 응답", value: "8/12", sub: "66% 응답", icon: "✋" },
      { label: "미응답", value: "4", sub: "명", icon: "❓" },
    ],
    quickMenu: ["목장원 목록", "일정 등록", "참석 현황", "시설 신청"],
    widgets: [
      { title: "목장원 응답 현황", type: "members", items: ["김성도 참석", "이믿음 참석", "박소망 불참", "최사랑 참석", "정은혜 미정", "홍축복 미정"] },
      { title: "이번 달 일정", type: "calendar" },
    ]
  },
  member: {
    stats: [
      { label: "내 목장", value: "4목장", sub: "목자: 박목자", icon: "🏘️" },
      { label: "다음 모임", value: "4/3", sub: "목요일 7시", icon: "📅" },
      { label: "내 신청", value: "1", sub: "건 진행 중", icon: "📋" },
      { label: "삶공부", value: "2/4", sub: "과정 수료", icon: "📖" },
    ],
    quickMenu: ["주보 보기", "행사 달력", "참석 응답", "시설/차량 신청"],
    widgets: [
      { title: "교회 소식", type: "list", items: ["이번 주 주보 (3/30)", "부활절 연합예배 안내", "봄 수련회 4/18~19"] },
      { title: "목장 일정 & 내 신청", type: "list", items: ["목장 모임 4/3(목) 7시", "교육관 예약 (3/31) - 승인 대기", "재정 청구 ₩50,000 - 승인 완료"] },
    ]
  },
};

function WireBox({ children, style, ...props }) {
  return (
    <div style={{ border: "1.5px dashed #cbd5e1", borderRadius: 8, padding: 12, background: "#f8fafc", ...style }} {...props}>{children}</div>
  );
}

function InputField({ label, required, style }) {
  return (
    <div style={style}>
      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>{label}{required && " *"}</div>
      <div style={{ height: 28, background: "#f1f5f9", borderRadius: 4, border: "1px solid #e2e8f0" }} />
    </div>
  );
}

function Btn({ children, color, outline, style }) {
  return (
    <div style={{ padding: "6px 16px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", ...(outline ? { border: "1px solid #e2e8f0", color: "#64748b" } : { background: color || "#3b82f6", color: "#fff" }), ...style }}>{children}</div>
  );
}

function Badge({ label, color }) {
  return <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: color + "18", color, fontWeight: 600 }}>{label}</span>;
}

function StatCard({ stat }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, marginBottom: 4 }}>{stat.label}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1e293b", letterSpacing: -0.5 }}>{stat.value}</div>
          <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 2 }}>{stat.sub}</div>
        </div>
        <span style={{ fontSize: 24 }}>{stat.icon}</span>
      </div>
    </div>
  );
}

function MiniChart({ type }) {
  if (type === "bar") {
    return (
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 60, padding: "8px 0" }}>
        {[40, 65, 55, 80, 70, 90, 45].map((h, i) => (
          <div key={i} style={{ flex: 1, height: `${h}%`, background: "linear-gradient(to top, #6366f1, #818cf8)", borderRadius: "3px 3px 0 0", opacity: 0.7 + i * 0.04 }} />
        ))}
      </div>
    );
  }
  if (type === "chart") {
    return (
      <svg viewBox="0 0 200 60" style={{ width: "100%", height: 60 }}>
        <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity="0.2" /><stop offset="100%" stopColor="#6366f1" stopOpacity="0" /></linearGradient></defs>
        <polyline points="0,50 30,40 60,45 90,30 120,35 150,20 180,25 200,15" fill="none" stroke="#6366f1" strokeWidth="2" />
        <polyline points="0,50 30,40 60,45 90,30 120,35 150,20 180,25 200,15 200,60 0,60" fill="url(#cg)" stroke="none" />
      </svg>
    );
  }
  if (type === "calendar") {
    const days = ["일","월","화","수","목","금","토"];
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
          {days.map(d => <div key={d} style={{ fontSize: 9, textAlign: "center", color: "#94a3b8", fontWeight: 600 }}>{d}</div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
          {Array.from({ length: 30 }, (_, i) => (
            <div key={i} style={{ fontSize: 9, textAlign: "center", padding: "3px 0", borderRadius: 4, background: [2,9,16,23].includes(i) ? "#6366f1" : "transparent", color: [2,9,16,23].includes(i) ? "#fff" : "#64748b", fontWeight: [2,9,16,23].includes(i) ? 700 : 400 }}>{i + 1}</div>
          ))}
        </div>
      </div>
    );
  }
  if (type === "members") return null;
  return null;
}

function WidgetCard({ widget }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 3, height: 14, borderRadius: 2, background: "#6366f1" }} />
        {widget.title}
      </div>
      {widget.items && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {widget.items.map((item, i) => (
            <div key={i} style={{ fontSize: 11, color: "#475569", padding: "6px 8px", background: "#f8fafc", borderRadius: 6, border: "1px solid #f1f5f9" }}>{item}</div>
          ))}
        </div>
      )}
      {widget.type !== "list" && widget.type !== "members" && <MiniChart type={widget.type} />}
      {widget.type === "members" && widget.items && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {widget.items.map((m, i) => {
            const c = m.includes("참석") ? "#10b981" : m.includes("불참") ? "#ef4444" : "#f59e0b";
            return <div key={i} style={{ fontSize: 10, padding: "4px 6px", borderRadius: 4, background: c + "10", color: c, fontWeight: 500 }}>{m}</div>;
          })}
        </div>
      )}
    </div>
  );
}

function DashboardView({ roleId, roleColor }) {
  const dash = dashboards[roleId];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10 }}>{dash.stats.map((s, i) => <StatCard key={i} stat={s} />)}</div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 8, letterSpacing: 0.5 }}>빠른 메뉴</div>
        <div style={{ display: "flex", gap: 8 }}>
          {dash.quickMenu.map((m, i) => (
            <div key={i} style={{ flex: 1, padding: "10px 8px", background: "#fff", border: `1.5px solid ${roleColor}22`, borderRadius: 8, fontSize: 11.5, fontWeight: 600, color: roleColor, textAlign: "center", cursor: "pointer" }}>{m}</div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 12 }}>{dash.widgets.map((w, i) => <WidgetCard key={i} widget={w} />)}</div>
    </div>
  );
}

function SitemapView({ selectedRole }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "12px 16px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
        <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginRight: 4 }}>범례:</span>
        {ROLES.map(r => (
          <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: selectedRole === r.id ? r.color : "#94a3b8", fontWeight: selectedRole === r.id ? 700 : 400 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: selectedRole === r.id ? r.color : "#cbd5e1", display: "inline-block" }} />
            {r.label}
          </label>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {sitemapData.map((group, gi) => (
          <div key={gi} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", background: group.color, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{group.group}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>{group.pages.length}개 화면</span>
            </div>
            <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {group.pages.map((page, pi) => {
                const accessible = selectedRole ? roleAccess[selectedRole]?.includes(page.name) : true;
                return (
                  <div key={pi} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, background: accessible ? "#f0fdf4" : "#fef2f2", border: `1px solid ${accessible ? "#bbf7d0" : "#fecaca"}`, opacity: accessible ? 1 : 0.5 }}>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>{accessible ? "✅" : "🔒"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>{page.name}</div>
                      {page.desc && <div style={{ fontSize: 10, color: "#64748b" }}>{page.desc}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 2 }}>
                      {ROLES.filter(r => roleAccess[r.id]?.includes(page.name)).map(r => (
                        <div key={r.id} style={{ width: 6, height: 6, borderRadius: "50%", background: r.color, opacity: selectedRole && selectedRole !== r.id ? 0.2 : 1 }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarGrid({ events }) {
  const days = ["일","월","화","수","목","금","토"];
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 1, marginBottom: 2 }}>
        {days.map(d => <div key={d} style={{ fontSize: 10, textAlign: "center", color: "#94a3b8", fontWeight: 600, padding: 4 }}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 1 }}>
        {Array.from({ length: 35 }, (_, i) => {
          const day = i - 2;
          const valid = day >= 1 && day <= 30;
          const ev = events && events[day];
          return (
            <div key={i} style={{ minHeight: 44, padding: 3, background: valid ? "#fff" : "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 2 }}>
              {valid && <div style={{ fontSize: 9, color: i % 7 === 0 ? "#ef4444" : "#64748b", fontWeight: 500 }}>{day}</div>}
              {ev && <div style={{ fontSize: 7.5, color: ev.color || "#3b82f6", marginTop: 1, lineHeight: 1.3, fontWeight: 500 }}>{ev.label}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const pageDetails = {
  "로그인": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 320, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#1e293b" }}>chflow</div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>교회 통합 관리 시스템</div>
      </div>
      <InputField label="이메일" />
      <InputField label="비밀번호" />
      <Btn color="#6366f1" style={{ textAlign: "center", padding: "10px 0", width: "100%" }}>로그인</Btn>
      <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center" }}>비밀번호를 잊으셨나요?</div>
    </div>
  ),
  "내 정보": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>내 정보</div>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <WireBox style={{ width: 100, height: 120, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          <span style={{ fontSize: 32 }}>👤</span>
          <span style={{ fontSize: 9, color: "#94a3b8", marginTop: 4 }}>프로필 사진</span>
        </WireBox>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {["이름", "이메일", "연락처", "목장"].map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", width: 50, textAlign: "right" }}>{f}</div>
              <div style={{ fontSize: 12, color: "#1e293b", fontWeight: 500 }}>{["홍길동","hong@email.com","010-1234-5678","4목장"][i]}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn color="#3b82f6">정보 수정</Btn>
      </div>
    </div>
  ),
  "비밀번호 변경": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360, margin: "0 auto" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>비밀번호 변경</div>
      <InputField label="현재 비밀번호" required />
      <InputField label="새 비밀번호" required />
      <InputField label="새 비밀번호 확인" required />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn outline>취소</Btn>
        <Btn color="#6366f1">변경</Btn>
      </div>
    </div>
  ),
  "주보 보기": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>교회 주보</div>
      <div style={{ display: "flex", gap: 8 }}>
        {["2026.4.5","2026.3.29","2026.3.22"].map((d, i) => (
          <div key={i} style={{ padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: i === 0 ? 700 : 400, background: i === 0 ? "#0ea5e9" : "#f1f5f9", color: i === 0 ? "#fff" : "#64748b", cursor: "pointer" }}>{d}</div>
        ))}
      </div>
      <WireBox style={{ minHeight: 180, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#1e293b", textAlign: "center" }}>OO교회 주보</div>
        <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center" }}>2026년 4월 5일 주일</div>
        <div style={{ height: 1, background: "#e2e8f0" }} />
        <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.8 }}>
          예배순서 · 찬양 · 기도 · 설교 · 봉헌 · 광고<br/>설교: "믿음의 여정" (히브리서 11:1-6)<br/>광고: 부활절 연합예배, 봄 수련회 안내
        </div>
      </WireBox>
    </div>
  ),
  "행사 공지": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>행사 공지</div>
        <div style={{ display: "flex", gap: 6 }}>
          {["전체","예배","행사","교육"].map((c, i) => (
            <div key={i} style={{ padding: "4px 10px", borderRadius: 12, fontSize: 10, background: i === 0 ? "#0ea5e9" : "#f1f5f9", color: i === 0 ? "#fff" : "#64748b", fontWeight: 500 }}>{c}</div>
          ))}
        </div>
      </div>
      {[
        { title: "부활절 연합예배 안내", cat: "예배", pin: true, date: "4/5" },
        { title: "봄 수련회 참가 신청", cat: "행사", pin: true, date: "4/18~19" },
        { title: "삶공부 2학기 개강 안내", cat: "교육", pin: false, date: "4/12" },
        { title: "주차장 이용 안내", cat: "공지", pin: false, date: "3/28" },
      ].map((n, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
          {n.pin && <span style={{ fontSize: 10, color: "#ef4444" }}>📌</span>}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>{n.title}</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>{n.date}</div>
          </div>
          <Badge label={n.cat} color="#0ea5e9" />
        </div>
      ))}
    </div>
  ),
  "행사 달력": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>행사 달력</div>
        <div style={{ fontSize: 11, color: "#64748b" }}>2026년 4월</div>
      </div>
      <CalendarGrid events={{ 5: { label: "부활절예배", color: "#ef4444" }, 12: { label: "삶공부개강", color: "#ec4899" }, 18: { label: "봄수련회", color: "#f59e0b" }, 19: { label: "봄수련회", color: "#f59e0b" }, 26: { label: "성가대공연", color: "#8b5cf6" }}} />
    </div>
  ),
  "성도 요람 조회": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>성도 요람</div>
      <InputField label="이름 검색" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[{ name: "김철수", group: "4목장", phone: "010-1234-****" },{ name: "이영희", group: "7목장", phone: "010-5678-****" },{ name: "박민수", group: "2목장", phone: "010-9012-****" }].map((m, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>👤</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>{m.name}</div>
              <div style={{ fontSize: 10, color: "#64748b" }}>{m.group} · {m.phone}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>* 개인정보 보호를 위해 연락처 일부가 마스킹됩니다</div>
    </div>
  ),
  "성도 목록/검색": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>성도 목록</div>
        <Btn color="#3b82f6">+ 성도 등록</Btn>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}><InputField label="이름 검색" /></div>
        <div style={{ width: 120 }}><InputField label="목장 필터" /></div>
        <div style={{ width: 100 }}><InputField label="상태" /></div>
      </div>
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "40px 1.5fr 1fr 1fr 80px", background: "#f8fafc", padding: "8px 10px", gap: 8 }}>
          {["#","이름","목장","상태","관리"].map((h, i) => <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#475569" }}>{h}</div>)}
        </div>
        {[["1","김철수","4목장","활동"],["2","이영희","7목장","활동"],["3","박민수","2목장","비활동"],["4","최은정","4목장","활동"]].map((row, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "40px 1.5fr 1fr 1fr 80px", padding: "8px 10px", gap: 8, borderTop: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{row[0]}</div>
            <div style={{ fontSize: 11, color: "#1e293b", fontWeight: 500 }}>{row[1]}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{row[2]}</div>
            <Badge label={row[3]} color={row[3] === "활동" ? "#10b981" : "#94a3b8"} />
            <div style={{ fontSize: 10, color: "#3b82f6", cursor: "pointer" }}>상세보기</div>
          </div>
        ))}
      </div>
    </div>
  ),
  "성도 등록 폼": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>성도 등록</div>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "start" }}>
        <WireBox style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 28 }}>📷</span>
          <span style={{ fontSize: 9, color: "#94a3b8" }}>증명사진 (옵션)</span>
        </WireBox>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {["이름","연락처","생년월일","주소"].map((f, i) => <InputField key={i} label={f} required={i < 2} />)}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <InputField label="이메일" />
        <InputField label="목장 배정" />
      </div>
      <div>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>비고</div>
        <div style={{ height: 48, background: "#f1f5f9", borderRadius: 4, border: "1px solid #e2e8f0" }} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn outline>취소</Btn>
        <Btn color="#3b82f6">등록</Btn>
      </div>
    </div>
  ),
  "성도 상세/수정": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>성도 상세 정보</div>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "start" }}>
        <WireBox style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 32 }}>👤</span>
          <span style={{ fontSize: 9, color: "#94a3b8" }}>사진 변경</span>
        </WireBox>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {["이름","연락처","생년월일","주소"].map((f, i) => <InputField key={i} label={f} required={i < 2} />)}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <InputField label="이메일" />
        <InputField label="목장" />
        <InputField label="상태" />
      </div>
      <div>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>비고</div>
        <div style={{ height: 48, background: "#f1f5f9", borderRadius: 4, border: "1px solid #e2e8f0" }} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn outline>취소</Btn>
        <Btn color="#3b82f6">저장</Btn>
      </div>
    </div>
  ),
  "목장 배정 관리": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>목장 배정 관리</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 40px 1fr", gap: 8, alignItems: "start" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>미배정 성도</div>
          <WireBox style={{ minHeight: 160 }}>
            {["홍길동","김미영","박철수"].map((n, i) => (
              <div key={i} style={{ padding: "6px 8px", fontSize: 11, color: "#475569", borderBottom: "1px solid #e2e8f0", cursor: "grab" }}>{n}</div>
            ))}
          </WireBox>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 40, fontSize: 16, color: "#94a3b8" }}>→</div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>목장 선택</div>
          {["1목장 (목자: 김OO) - 8명","2목장 (목자: 이OO) - 10명","4목장 (목자: 박OO) - 12명"].map((g, i) => (
            <div key={i} style={{ padding: "8px 10px", fontSize: 11, color: "#1e293b", border: "1px solid #e2e8f0", borderRadius: 6, marginBottom: 4, background: i === 2 ? "#eff6ff" : "#fff", cursor: "pointer" }}>{g}</div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn color="#3b82f6">배정 저장</Btn>
      </div>
    </div>
  ),
  "헌금 입력": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>주간 헌금 입력</div>
        <div style={{ fontSize: 10, color: "#64748b", background: "#f1f5f9", padding: "4px 10px", borderRadius: 4 }}>2026년 4월 1주차</div>
      </div>
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", background: "#f8fafc", padding: "8px 10px", gap: 8 }}>
          {["성도명","십일조","감사","주일","건축"].map((h, i) => <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#475569" }}>{h}</div>)}
        </div>
        {["김철수","이영희","박민수","최은정"].map((name, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", padding: "8px 10px", gap: 8, borderTop: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
            <div style={{ fontSize: 11, color: "#1e293b", fontWeight: 500 }}>{name}</div>
            {[0,1,2,3].map(j => <div key={j} style={{ height: 24, background: "#f1f5f9", borderRadius: 4, border: "1px solid #e2e8f0" }} />)}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn color="#10b981">저장</Btn>
      </div>
    </div>
  ),
  "헌금 집계/리포트": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>헌금 집계 / 리포트</div>
        <div style={{ display: "flex", gap: 6 }}>
          {["주간","월간","연간"].map((t, i) => (
            <div key={i} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 10, background: i === 0 ? "#10b981" : "#f1f5f9", color: i === 0 ? "#fff" : "#64748b", fontWeight: 500, cursor: "pointer" }}>{t}</div>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[{ l: "십일조", v: "₩18,500,000" },{ l: "감사헌금", v: "₩8,200,000" },{ l: "주일헌금", v: "₩5,800,000" }].map((s, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>{s.l}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", marginTop: 4 }}>{s.v}</div>
          </div>
        ))}
      </div>
      <WireBox style={{ padding: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>월별 헌금 추이</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 80 }}>
          {[60,70,65,80,75,90,85,95,88,92,78,82].map((h, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{ width: "100%", height: `${h}%`, background: "linear-gradient(to top, #10b981, #34d399)", borderRadius: "2px 2px 0 0" }} />
              <div style={{ fontSize: 7, color: "#94a3b8" }}>{i + 1}월</div>
            </div>
          ))}
        </div>
      </WireBox>
    </div>
  ),
  "재정 청구 목록": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>재정 청구 목록</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[
          { title: "청년부 수련회 지원", amount: "₩1,200,000", status: "대기", color: "#f59e0b", by: "김목자" },
          { title: "주방용품 구매", amount: "₩350,000", status: "승인", color: "#10b981", by: "이사무" },
          { title: "성가대 악보 구입", amount: "₩180,000", status: "반려", color: "#ef4444", by: "박성도" },
          { title: "교육관 프로젝터 수리", amount: "₩450,000", status: "대기", color: "#f59e0b", by: "최사무" },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>{item.title}</div>
              <div style={{ fontSize: 10, color: "#64748b" }}>신청자: {item.by} · {item.amount}</div>
            </div>
            <Badge label={item.status} color={item.color} />
          </div>
        ))}
      </div>
    </div>
  ),
  "재정 청구 신청 폼": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>재정 청구 신청</div>
      <InputField label="금액" required />
      <InputField label="용도 / 사유" required />
      <div>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>상세 내용</div>
        <div style={{ height: 48, background: "#f1f5f9", borderRadius: 4, border: "1px solid #e2e8f0" }} />
      </div>
      <WireBox style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <span style={{ fontSize: 18 }}>📎</span>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>영수증 첨부 (이미지/PDF)</span>
      </WireBox>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn outline>취소</Btn>
        <Btn color="#10b981">신청</Btn>
      </div>
    </div>
  ),
  "재정 승인 처리": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>재정 승인 처리</div>
      <WireBox style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>청년부 수련회 지원</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>신청자: 김목자 · 2026.4.1</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#10b981", marginTop: 6 }}>₩1,200,000</div>
          </div>
          <Badge label="대기" color="#f59e0b" />
        </div>
        <div style={{ fontSize: 10, color: "#475569", marginTop: 8, lineHeight: 1.5 }}>용도: 청년부 봄 수련회 숙소 및 식비 지원</div>
      </WireBox>
      <div>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>코멘트</div>
        <div style={{ height: 40, background: "#f1f5f9", borderRadius: 4, border: "1px solid #e2e8f0" }} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn color="#ef4444">반려</Btn>
        <Btn color="#10b981">승인</Btn>
      </div>
    </div>
  ),
  "수입/지출 대시보드": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>수입/지출 대시보드</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 12, textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#10b981" }}>이번 달 수입</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#059669", marginTop: 4 }}>₩32,500,000</div>
        </div>
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 12, textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#ef4444" }}>이번 달 지출</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#dc2626", marginTop: 4 }}>₩5,800,000</div>
        </div>
      </div>
      <WireBox style={{ padding: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>월별 수입 vs 지출 추이</div>
        <svg viewBox="0 0 300 80" style={{ width: "100%", height: 80 }}>
          <polyline points="0,60 50,50 100,55 150,40 200,45 250,30 300,35" fill="none" stroke="#10b981" strokeWidth="2" />
          <polyline points="0,70 50,68 100,65 150,60 200,62 250,58 300,55" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="4,2" />
        </svg>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#64748b" }}><div style={{ width: 12, height: 2, background: "#10b981" }} /> 수입</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#64748b" }}><div style={{ width: 12, height: 2, background: "#ef4444", borderTop: "1px dashed #ef4444" }} /> 지출</div>
        </div>
      </WireBox>
    </div>
  ),
  "시설 이용 신청 폼": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>시설 이용 신청</div>
      {["시설 선택","이용 날짜","시작 시간","종료 시간","이용 목적"].map((f, i) => <InputField key={i} label={f} />)}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn outline>취소</Btn>
        <Btn color="#f59e0b">신청</Btn>
      </div>
    </div>
  ),
  "차량 이용 신청 폼": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>차량 이용 신청</div>
      {["차량 선택","이용 날짜","시작 시간","종료 시간","목적지","탑승 인원"].map((f, i) => <InputField key={i} label={f} />)}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn outline>취소</Btn>
        <Btn color="#f59e0b">신청</Btn>
      </div>
    </div>
  ),
  "예약 캘린더": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>예약 캘린더</div>
        <div style={{ display: "flex", gap: 6 }}>
          {["시설","차량"].map((t, i) => (
            <div key={i} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 10, background: i === 0 ? "#f59e0b" : "#f1f5f9", color: i === 0 ? "#fff" : "#64748b", fontWeight: 500 }}>{t}</div>
          ))}
        </div>
      </div>
      <CalendarGrid events={{ 3: { label: "교육관-청년부", color: "#3b82f6" }, 8: { label: "체육관-체육부", color: "#8b5cf6" }, 15: { label: "교육관-여전도회", color: "#3b82f6" }, 22: { label: "본당-성가대", color: "#ef4444" }}} />
    </div>
  ),
  "예약 승인 처리": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>예약 승인 처리</div>
      {[
        { title: "교육관 - 청년부 모임", date: "4/3 14:00~17:00", by: "김OO", status: "대기" },
        { title: "차량1 - 봉사팀 이동", date: "4/5 09:00~12:00", by: "이OO", status: "대기" },
      ].map((item, i) => (
        <WireBox key={i} style={{ padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>{item.title}</div>
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{item.date} · 신청자: {item.by}</div>
            </div>
            <Badge label={item.status} color="#f59e0b" />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
            <Btn color="#ef4444" style={{ padding: "4px 12px", fontSize: 10 }}>반려</Btn>
            <Btn color="#10b981" style={{ padding: "4px 12px", fontSize: 10 }}>승인</Btn>
          </div>
        </WireBox>
      ))}
    </div>
  ),
  "내 신청 내역": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>내 신청 내역</div>
      {[
        { title: "교육관 이용 신청", type: "시설", date: "3/31", status: "승인", color: "#10b981" },
        { title: "차량1 이용 신청", type: "차량", date: "4/5", status: "대기", color: "#f59e0b" },
        { title: "재정 청구 ₩50,000", type: "재정", date: "3/28", status: "승인", color: "#10b981" },
        { title: "체육관 이용 신청", type: "시설", date: "3/15", status: "반려", color: "#ef4444" },
      ].map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
          <Badge label={item.type} color="#64748b" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>{item.title}</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>{item.date}</div>
          </div>
          <Badge label={item.status} color={item.color} />
        </div>
      ))}
    </div>
  ),
  "목장원 목록": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>목장원 목록</div>
      <div style={{ fontSize: 11, color: "#64748b" }}>4목장 · 목자: 박OO · 12명</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[
          { name: "김성도", phone: "010-1234-5678", role: "목자" },
          { name: "이믿음", phone: "010-2345-6789", role: "" },
          { name: "박소망", phone: "010-3456-7890", role: "" },
          { name: "최사랑", phone: "010-4567-8901", role: "" },
          { name: "정은혜", phone: "010-5678-9012", role: "" },
        ].map((m, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>👤</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>{m.name} {m.role && <Badge label={m.role} color="#8b5cf6" />}</div>
              <div style={{ fontSize: 10, color: "#64748b" }}>{m.phone}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
  "목장 일정 등록": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>목장 일정 등록</div>
      <InputField label="날짜" required />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <InputField label="시작 시간" required />
        <InputField label="종료 시간" />
      </div>
      <InputField label="장소" required />
      <div>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>메모</div>
        <div style={{ height: 48, background: "#f1f5f9", borderRadius: 4, border: "1px solid #e2e8f0" }} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn outline>취소</Btn>
        <Btn color="#8b5cf6">등록</Btn>
      </div>
    </div>
  ),
  "목장 캘린더": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>목장 캘린더</div>
        <div style={{ fontSize: 11, color: "#64748b" }}>4목장 · 2026년 4월</div>
      </div>
      <CalendarGrid events={{ 3: { label: "정기모임 7시", color: "#8b5cf6" }, 10: { label: "정기모임 7시", color: "#8b5cf6" }, 17: { label: "정기모임 7시", color: "#8b5cf6" }, 24: { label: "정기모임 7시", color: "#8b5cf6" }}} />
    </div>
  ),
  "참석 응답": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>목장 모임 참석 응답</div>
      <WireBox style={{ padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>4목장 정기 모임</div>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>4월 3일 (목) 오후 7:00 · 목자 박OO 집</div>
      </WireBox>
      <div style={{ display: "flex", gap: 8 }}>
        {[{ label: "참석", color: "#10b981", bg: "#f0fdf4" },{ label: "불참", color: "#ef4444", bg: "#fef2f2" },{ label: "미정", color: "#f59e0b", bg: "#fffbeb" }].map((opt, i) => (
          <div key={i} style={{ flex: 1, padding: "12px 8px", borderRadius: 8, textAlign: "center", border: `2px solid ${opt.color}`, background: i === 0 ? opt.bg : "#fff", fontSize: 13, fontWeight: 700, color: opt.color, cursor: "pointer" }}>{opt.label}</div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#64748b" }}>현재 응답: 참석 8 · 불참 2 · 미정 2</div>
    </div>
  ),
  "참석 현황": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>참석 현황</div>
      <div style={{ fontSize: 11, color: "#64748b" }}>4목장 정기 모임 · 4월 3일 (목)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[{ l: "참석", v: "8", c: "#10b981" },{ l: "불참", v: "2", c: "#ef4444" },{ l: "미정", v: "2", c: "#f59e0b" }].map((s, i) => (
          <div key={i} style={{ background: s.c + "10", border: `1px solid ${s.c}33`, borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: 10, color: s.c }}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {[
          { name: "김성도", r: "참석", c: "#10b981" },{ name: "이믿음", r: "참석", c: "#10b981" },
          { name: "박소망", r: "불참", c: "#ef4444" },{ name: "최사랑", r: "참석", c: "#10b981" },
          { name: "정은혜", r: "미정", c: "#f59e0b" },{ name: "홍축복", r: "미정", c: "#f59e0b" },
        ].map((m, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#fff", border: "1px solid #f1f5f9", borderRadius: 6 }}>
            <span style={{ fontSize: 11, color: "#1e293b" }}>{m.name}</span>
            <Badge label={m.r} color={m.c} />
          </div>
        ))}
      </div>
    </div>
  ),
  "과정 관리": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>삶공부 과정 관리</div>
        <Btn color="#ec4899">+ 과정 추가</Btn>
      </div>
      {[
        { name: "새가족반", semester: "2026년 1학기", period: "3/1 ~ 5/31", count: 12, status: "진행중" },
        { name: "성경통독반", semester: "2026년 1학기", period: "3/1 ~ 6/30", count: 18, status: "진행중" },
        { name: "제자훈련", semester: "2025년 2학기", period: "9/1 ~ 11/30", count: 8, status: "완료" },
        { name: "리더십반", semester: "2025년 2학기", period: "9/1 ~ 11/30", count: 6, status: "완료" },
      ].map((c, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>{c.name}</div>
            <div style={{ fontSize: 10, color: "#64748b" }}>{c.semester} · {c.period} · {c.count}명</div>
          </div>
          <Badge label={c.status} color={c.status === "진행중" ? "#ec4899" : "#94a3b8"} />
        </div>
      ))}
    </div>
  ),
  "수강 현황": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>삶공부 수강 현황</div>
      <InputField label="과정 선택" />
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 80px", background: "#f8fafc", padding: "8px 10px", gap: 8 }}>
          {["성도명","과정","출석률","상태"].map((h, i) => <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#475569" }}>{h}</div>)}
        </div>
        {[
          ["김철수","새가족반","100%","수료"],
          ["이영희","성경통독반","85%","수강중"],
          ["박민수","새가족반","70%","수강중"],
          ["최은정","제자훈련","95%","수료"],
        ].map((row, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 80px", padding: "8px 10px", gap: 8, borderTop: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
            <div style={{ fontSize: 11, color: "#1e293b", fontWeight: 500 }}>{row[0]}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{row[1]}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{row[2]}</div>
            <Badge label={row[3]} color={row[3] === "수료" ? "#10b981" : "#ec4899"} />
          </div>
        ))}
      </div>
    </div>
  ),
  "사용자 계정 관리": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>사용자 계정 관리</div>
        <Btn color="#6366f1">+ 계정 생성</Btn>
      </div>
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1.5fr 1fr 80px", background: "#f8fafc", padding: "8px 10px", gap: 8 }}>
          {["이름","이메일","역할","관리"].map((h, i) => <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#475569" }}>{h}</div>)}
        </div>
        {[
          ["김관리자","admin@church.com","시스템관리자","#6366f1"],
          ["이목사","pastor@church.com","목회자","#8b5cf6"],
          ["박사무","office@church.com","사무","#3b82f6"],
          ["최재정","finance@church.com","재정부","#10b981"],
          ["정목자","leader@church.com","목자","#f59e0b"],
        ].map((row, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.5fr 1.5fr 1fr 80px", padding: "8px 10px", gap: 8, borderTop: "1px solid #f1f5f9" }}>
            <div style={{ fontSize: 11, color: "#1e293b", fontWeight: 500 }}>{row[0]}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{row[1]}</div>
            <Badge label={row[2]} color={row[3]} />
            <div style={{ fontSize: 10, color: "#3b82f6", cursor: "pointer" }}>수정</div>
          </div>
        ))}
      </div>
    </div>
  ),
  "데이터 백업": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>데이터 백업</div>
      <div style={{ fontSize: 11, color: "#64748b" }}>수동으로 데이터를 내보내기할 수 있습니다.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          { label: "성도 데이터", desc: "487명 · 최근 백업: 4/1", icon: "👤" },
          { label: "헌금 데이터", desc: "2026년 · 최근 백업: 4/1", icon: "💰" },
          { label: "예약 데이터", desc: "전체 이력 · 최근 백업: 3/28", icon: "📅" },
          { label: "목장 활동", desc: "전체 이력 · 최근 백업: 3/28", icon: "🏘️" },
        ].map((item, i) => (
          <WireBox key={i} style={{ padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>{item.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#1e293b" }}>{item.label}</div>
              <div style={{ fontSize: 9, color: "#94a3b8" }}>{item.desc}</div>
            </div>
          </WireBox>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn color="#6366f1">CSV 내보내기</Btn>
        <Btn color="#64748b">JSON 내보내기</Btn>
      </div>
    </div>
  ),
  "시스템 설정": (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>시스템 설정</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginTop: 4 }}>교회 기본 정보</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <InputField label="교회 이름" />
        <InputField label="담임목사" />
        <InputField label="연락처" />
        <InputField label="주소" />
      </div>
      <div style={{ height: 1, background: "#e2e8f0", margin: "4px 0" }} />
      <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>목장 설정</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {["1목장 · 목자: 김OO","2목장 · 목자: 이OO","3목장 · 목자: 박OO","4목장 · 목자: 최OO"].map((g, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#f8fafc", borderRadius: 6, fontSize: 11, color: "#475569" }}>
            {g}
            <span style={{ fontSize: 10, color: "#3b82f6", cursor: "pointer" }}>수정</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn color="#6366f1">저장</Btn>
      </div>
    </div>
  ),
};

function BrowserChrome({ url, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#fca5a5" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#fde047" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#86efac" }} />
        </div>
        <div style={{ flex: 1, background: "#fff", borderRadius: 4, padding: "4px 12px", fontSize: 11, color: "#94a3b8", border: "1px solid #e2e8f0" }}>{url}</div>
      </div>
      {children}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [selectedRole, setSelectedRole] = useState("office");
  const [detailPage, setDetailPage] = useState(null);
  const currentRole = ROLES.find(r => r.id === selectedRole);

  const allPageNames = sitemapData.flatMap(g => g.pages.map(p => p.name));
  const accessiblePages = allPageNames.filter(p => roleAccess[selectedRole]?.includes(p));

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', -apple-system, sans-serif", color: "#1e293b" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", letterSpacing: -0.5 }}>chflow · 교회 통합 관리 시스템</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>와이어프레임 · Wireframe v2.0</div>
        </div>
        <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 8, padding: 3 }}>
          {[
            { id: "dashboard", label: "역할별 대시보드" },
            { id: "sitemap", label: "전체 페이지 흐름도" },
            { id: "screens", label: "주요 화면" },
          ].map(t => (
            <div key={t.id} onClick={() => { setTab(t.id); setDetailPage(null); }} style={{
              padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
              background: tab === t.id ? "#fff" : "transparent", color: tab === t.id ? "#1e293b" : "#94a3b8",
              boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            }}>{t.label}</div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", minHeight: "calc(100vh - 65px)" }}>
        <div style={{ width: 200, background: "#fff", borderRight: "1px solid #e2e8f0", padding: "20px 12px", flexShrink: 0, overflowY: "auto" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, marginBottom: 12, paddingLeft: 8 }}>역할 선택</div>
          {ROLES.map(role => (
            <div key={role.id} onClick={() => setSelectedRole(role.id)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, marginBottom: 4,
              cursor: "pointer", transition: "all 0.2s",
              background: selectedRole === role.id ? `${role.color}10` : "transparent",
              border: selectedRole === role.id ? `1.5px solid ${role.color}33` : "1.5px solid transparent",
            }}>
              <span style={{ fontSize: 18 }}>{role.icon}</span>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: selectedRole === role.id ? 700 : 500, color: selectedRole === role.id ? role.color : "#475569" }}>{role.label}</div>
              </div>
              {selectedRole === role.id && <div style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: role.color }} />}
            </div>
          ))}
          {tab === "screens" && (
            <>
              <div style={{ height: 1, background: "#e2e8f0", margin: "16px 0" }} />
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, marginBottom: 8, paddingLeft: 8 }}>화면 목록</div>
              {sitemapData.map((group, gi) => (
                <div key={gi} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: group.color, paddingLeft: 8, marginBottom: 4, letterSpacing: 0.5 }}>{group.group}</div>
                  {group.pages.map((page, pi) => {
                    const accessible = roleAccess[selectedRole]?.includes(page.name);
                    return (
                      <div key={pi} onClick={() => accessible && setDetailPage(page.name)} style={{
                        padding: "5px 12px", borderRadius: 6, marginBottom: 2, fontSize: 10.5, cursor: accessible ? "pointer" : "default",
                        fontWeight: detailPage === page.name ? 600 : 400,
                        color: !accessible ? "#cbd5e1" : detailPage === page.name ? group.color : "#64748b",
                        background: detailPage === page.name ? group.color + "10" : "transparent",
                      }}>
                        {!accessible && "🔒 "}{page.name}
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>

        <div style={{ flex: 1, padding: 24, overflow: "auto" }}>
          {tab === "dashboard" && (
            <div style={{ maxWidth: 960, margin: "0 auto" }}>
              <BrowserChrome url="chflow.vercel.app/dashboard">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid #f1f5f9" }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: currentRole.color }}>{currentRole.icon} {currentRole.label} 대시보드</div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>🔔</span>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>👤</div>
                  </div>
                </div>
                <div style={{ padding: 20 }}><DashboardView roleId={selectedRole} roleColor={currentRole.color} /></div>
              </BrowserChrome>
              <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: "#94a3b8" }}>왼쪽에서 역할을 선택하면 해당 역할의 대시보드를 미리 볼 수 있습니다</div>
            </div>
          )}
          {tab === "sitemap" && (
            <div style={{ maxWidth: 960, margin: "0 auto" }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>전체 페이지 흐름도</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>✅ 접근 가능 · 🔒 접근 불가 · 색상 점은 접근 가능한 역할 표시</div>
              </div>
              <SitemapView selectedRole={selectedRole} />
            </div>
          )}
          {tab === "screens" && (
            <div style={{ maxWidth: 640, margin: "0 auto" }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>주요 화면</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>왼쪽에서 화면을 선택하세요 · 현재 역할: <span style={{ color: currentRole.color, fontWeight: 600 }}>{currentRole.label}</span></div>
              </div>
              <BrowserChrome url={`chflow.vercel.app/${detailPage ? detailPage.replace(/\s/g, '-') : '...'}`}>
                <div style={{ padding: 24 }}>
                  {detailPage && pageDetails[detailPage]
                    ? pageDetails[detailPage]
                    : <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}><div style={{ fontSize: 32, marginBottom: 8 }}>📱</div><div style={{ fontSize: 13 }}>왼쪽에서 화면을 선택하세요</div><div style={{ fontSize: 11, marginTop: 8 }}>접근 가능한 화면: {accessiblePages.length}개 / 전체: {allPageNames.length}개</div></div>
                  }
                </div>
              </BrowserChrome>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
