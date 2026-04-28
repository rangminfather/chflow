"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

// 매주 변하는 핵심 필드만. (강론자처럼 거의 고정인 항목은 별도 설정으로 관리 예정.)
const EMPTY_FORM = {
  date: nextSundayDate(),
  topic: "",          // 주제
  scripture: "",      // 성경본문
  leader: "",         // 예배인도
  praise: "",         // 찬양 (선곡)
  prayer: "",         // 기도 (반별)
  scripture_reader: "", // 성경봉독 (담당 학생)
  sermon_title: "",   // 설교제목
  preacher: "",       // 강론자 (고정에 가깝지만 변경 여지 있음)
  announcement: "",   // 광고/공지
};

type FormState = typeof EMPTY_FORM;

const SUPPORTED_DEPT = "초등1부";

export default function WeeklyBulletinPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [toast, setToast] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      const { data: deptInfo } = await supabase.rpc("get_department_info", { p_dept_id: deptId });
      if (deptInfo && deptInfo[0]) setDeptName(deptInfo[0].name || "");
    })();
  }, []);

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const handleReset = () => {
    if (!confirm("입력한 내용을 모두 지우고 초기화하시겠습니까?")) return;
    setForm({ ...EMPTY_FORM, date: nextSundayDate() });
    showToast("초기화되었습니다");
  };

  const handleRegister = () => {
    // TODO 다음 단계: PDF 생성 → UMS 자동 등록 API 호출
    // 1) 폼 → PDF 렌더링 (pdf-lib/react-pdf 추가 예정)
    // 2) POST /api/ums-bulletin-post  { dept_key, fields, pdf_base64 }
    //    서버: 30분 cooldown 체크 → 통과 시 ums.or.kr 4단계 플로우
    showToast("PDF 생성 및 UMS 등록 기능은 다음 단계에서 추가됩니다");
  };

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  const isSupported = deptName === SUPPORTED_DEPT;

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={headerStyle}>
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>📰 주보 만들기</div>
        <div style={{ width: 60 }} />
      </div>

      <div style={containerStyle}>
        {!isSupported && (
          <div style={warnCardStyle}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🚧</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>현재 {SUPPORTED_DEPT}만 지원합니다</div>
            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
              다른 부서는 주보 양식이 달라 추후 별도로 추가될 예정입니다.<br />
              아래 폼은 미리보기 용도로 입력 가능합니다.
            </div>
          </div>
        )}

        {/* 1) 기본 정보 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>① 기본 정보</div>
          <FormRow label="발행 일자 (주일)">
            <input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              style={inputStyle}
            />
          </FormRow>
        </div>

        {/* 2) 주일예배 순서 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>② 주일예배 순서</div>

          <FormRow label="주제">
            <input
              type="text"
              value={form.topic}
              onChange={(e) => set("topic", e.target.value)}
              placeholder="예: 하나님의 안경으로 세상을 바라보는 어린이!"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="성경본문">
            <input
              type="text"
              value={form.scripture}
              onChange={(e) => set("scripture", e.target.value)}
              placeholder="예: 히 11:3"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="예배인도">
            <input
              type="text"
              value={form.leader}
              onChange={(e) => set("leader", e.target.value)}
              placeholder="인도자 이름"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="찬양 (선곡)">
            <input
              type="text"
              value={form.praise}
              onChange={(e) => set("praise", e.target.value)}
              placeholder="예: 주님의 사랑"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="기도 담당">
            <input
              type="text"
              value={form.prayer}
              onChange={(e) => set("prayer", e.target.value)}
              placeholder="예: 2-3반"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="성경봉독 (학생)">
            <input
              type="text"
              value={form.scripture_reader}
              onChange={(e) => set("scripture_reader", e.target.value)}
              placeholder="봉독 학생 이름"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="설교제목">
            <input
              type="text"
              value={form.sermon_title}
              onChange={(e) => set("sermon_title", e.target.value)}
              placeholder="강론 제목"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="강론자">
            <input
              type="text"
              value={form.preacher}
              onChange={(e) => set("preacher", e.target.value)}
              placeholder="예: 심주석 전도사"
              style={inputStyle}
            />
          </FormRow>
        </div>

        {/* 3) 광고/공지 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>③ 광고 / 공지사항</div>
          <FormRow label="이번 주 광고">
            <textarea
              value={form.announcement}
              onChange={(e) => set("announcement", e.target.value)}
              placeholder={"한 줄에 하나씩 입력하세요.\n예:\n- 다음 주 부활절 분반활동\n- 5/3 야외예배 안내"}
              rows={6}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
          </FormRow>
        </div>

        {/* 4) 액션 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>④ 등록</div>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 12 }}>
            등록 버튼을 누르면 입력한 내용으로 PDF가 생성되고, 명성교회 사무실 게시판에 자동 업로드됩니다.
            <br />
            <span style={{ color: "#b45309", fontWeight: 700 }}>※ 같은 UMS 계정은 30분에 한 번만 등록 가능합니다.</span>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button onClick={handleReset} style={resetBtnStyle}>초기화</button>
            <button onClick={handleRegister} style={registerBtnStyle}>📤 등록</button>
          </div>
        </div>
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

// 다음 주일(일요일) 날짜를 YYYY-MM-DD 로 반환. 오늘이 일요일이면 오늘.
function nextSundayDate(): string {
  const d = new Date();
  const day = d.getDay(); // 0=일
  const diff = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const containerStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const headerStyle: React.CSSProperties = {
  background: "#fff",
  borderBottom: "1px solid #e2e8f0",
  padding: "12px 24px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 14,
  padding: 20,
  boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
};

const warnCardStyle: React.CSSProperties = {
  background: "#fff7ed",
  border: "1.5px solid #fed7aa",
  borderRadius: 14,
  padding: 18,
  textAlign: "center",
  color: "#9a3412",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#94a3b8",
  letterSpacing: 0.5,
  marginBottom: 12,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1.5px solid #e2e8f0",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

const backBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#f1f5f9",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  color: "#475569",
  cursor: "pointer",
  fontFamily: "inherit",
};

const registerBtnStyle: React.CSSProperties = {
  padding: "10px 22px",
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
};

const resetBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "#f1f5f9",
  color: "#475569",
  border: "1.5px solid #e2e8f0",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const toastStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 40,
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(15,23,42,0.88)",
  color: "#fff",
  padding: "12px 24px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  zIndex: 999,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
  maxWidth: "90vw",
  textAlign: "center",
};

const loadingStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};
