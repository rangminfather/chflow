"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";

interface DeptInfo {
  id: string;
  category: string;
  name: string;
  description: string | null;
  icon: string | null;
  member_count: number;
  is_member: boolean;
  my_status: string | null;
  is_admin: boolean;
}

// ─────────────────────────────────────────────────────────────────
// 메뉴 정의 — 사용자 xlsx (초등1 메뉴구성) 기반 4 대분류 + 소분류
// 등급:
//   0 = 전도사, 교육사 / 1 = 부장 / 2 = 부부장·총무·서기 / 3 = 교사 / 4 = 학부모
// ─────────────────────────────────────────────────────────────────

interface MenuItem {
  id: string;            // route slug ("journal" 등). null 이면 placeholder (라우트 없음)
  label: string;
  icon: string;
  desc: string;
  color: string;
  implemented: boolean;  // 구현 안 된 페이지는 클릭 시 "준비 중" 토스트
  onlyForDept?: string;
}

interface MenuCategory {
  id: string;
  label: string;
  icon: string;
  maxGrade: number;       // 이 등급 이하만 표시 (예: 행정관리 maxGrade=2 → 0/1/2 만 보임)
  desc: string;
  items: MenuItem[];
  /** 일부 부서만 표시 (없으면 모두) */
  onlyForDept?: string;
}

const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: "notices",
    label: "공지사항",
    icon: "📢",
    maxGrade: 4,
    desc: "부서 공지 / 알림 / 댓글",
    items: [
      { id: "notices", label: "공지 게시판", icon: "📢", desc: "부서 공지·알림·댓글", color: "#0ea5e9", implemented: false },
    ],
  },
  {
    id: "students",
    label: "학생관리",
    icon: "👨‍🎓",
    maxGrade: 3,
    desc: "출결 / 달란트 / 우리반 정보",
    onlyForDept: "초등1부",
    items: [
      { id: "my-class-attendance", label: "내 반 출결", icon: "📋", desc: "내 담당 반 학생 출석 체크", color: "#10b981", implemented: true },
      { id: "talent", label: "달란트통장", icon: "🏅", desc: "달란트 적립 · 누적 합계", color: "#8b5cf6", implemented: true },
      { id: "my-class", label: "우리반 아이 정보", icon: "👶", desc: "담당 반 학생 정보", color: "#f59e0b", implemented: false },
    ],
  },
  {
    id: "admin",
    label: "행정관리",
    icon: "📋",
    maxGrade: 2,
    desc: "주보 / 일지 / 통계 / 등록",
    onlyForDept: "초등1부",
    items: [
      { id: "weekly-bulletin", label: "주보 만들기", icon: "📰", desc: "주보 자동 생성·UMS 등록", color: "#14b8a6", implemented: true },
      { id: "journal", label: "교육일지작성", icon: "📓", desc: "일지 · 통계 · 헌금", color: "#6366f1", implemented: true },
      { id: "students-info", label: "학생정보관리", icon: "📇", desc: "학생 명부 · 인적사항", color: "#f97316", implemented: false },
      { id: "attendance-stats", label: "출결통계", icon: "📊", desc: "선생님·학생 출석 통계", color: "#84cc16", implemented: false },
      { id: "talent-stats", label: "달란트통계", icon: "📈", desc: "달란트 누적·랭킹", color: "#a855f7", implemented: false },
      { id: "talent-rules", label: "달란트 규칙", icon: "🏅", desc: "매주 적립 규칙·특별·보너스", color: "#f59e0b", implemented: true },
      { id: "new-friend", label: "새친구등록", icon: "🌟", desc: "새친구 등록카드 · 생활기록부", color: "#ec4899", implemented: true },
      { id: "teacher-attendance", label: "선생님 등록 / 출석", icon: "👨‍🏫", desc: "교사 출석부 · 월별 관리", color: "#0ea5e9", implemented: true },
      { id: "teacher-assign", label: "담임선생님 지정", icon: "👩‍🏫", desc: "반별 담임 변경 · 회원 연결 (전도사·부장)", color: "#8b5cf6", implemented: true },
      { id: "attendance", label: "출결 통합 조회", icon: "📊", desc: "전 반 학생 출결 (관리자 강제 수정 가능)", color: "#10b981", implemented: true },
      { id: "student-record", label: "학생 출결 조회", icon: "🔍", desc: "개별 학생 출결 이력", color: "#eab308", implemented: true },
    ],
  },
  {
    id: "department",
    label: "부서관리",
    icon: "⚙️",
    maxGrade: 1,
    desc: "부서원 등급 · 설정",
    items: [
      { id: "dept-approval", label: "사역 가입 승인", icon: "📥", desc: "본 부서 가입 신청 승인 · 등급 부여", color: "#10b981", implemented: true },
      { id: "members-grade", label: "부서원 등급 관리", icon: "🎖️", desc: "각 부서원 등급(0~4) 변경", color: "#6366f1", implemented: true },
      { id: "promote", label: "진급 마법사", icon: "🎓", desc: "매년 학년 진급 · 반편성 · 담임배정", color: "#dc2626", implemented: true },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────
export default function DepartmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [dept, setDept] = useState<DeptInfo | null>(null);
  const [myGrade, setMyGrade] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await load();
    })();
  }, []);

  const load = async () => {
    setLoading(true);
    const [deptResp, gradeResp] = await Promise.all([
      supabase.rpc("get_department_info", { p_dept_id: deptId }),
      supabase.rpc("get_user_grade", { p_dept_id: deptId }),
    ]);
    if (!deptResp.error && deptResp.data && deptResp.data.length > 0) {
      setDept(deptResp.data[0]);
    }
    if (!gradeResp.error && gradeResp.data !== null && gradeResp.data !== undefined) {
      setMyGrade(typeof gradeResp.data === "number" ? gradeResp.data : Number(gradeResp.data));
    }
    setLoading(false);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const handleItemClick = (item: MenuItem) => {
    if (!item.implemented) {
      showToast(`준비 중인 기능입니다: ${item.label}`);
      return;
    }
    router.push(`/departments/d/${deptId}/${item.id}`);
  };

  if (!authChecked || loading) return <div style={loadingStyle}>로딩 중...</div>;

  if (!dept) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>❓</div>
          <div style={{ fontSize: 14, color: "#94a3b8" }}>부서를 찾을 수 없습니다</div>
          <button onClick={() => router.push("/home")} style={{ ...backBtnStyle, marginTop: 16 }}>홈으로</button>
        </div>
      </div>
    );
  }

  if (!dept.is_member) {
    return (
      <div style={pageStyle}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <div style={{ maxWidth: 480, margin: "60px auto", padding: 24 }}>
          <div style={{
            background: "#fff", borderRadius: 20, padding: 32, textAlign: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
          }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🔒</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginBottom: 8 }}>
              아직 가입되지 않은 부서입니다
            </div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 24 }}>
              {dept.my_status === "pending"
                ? "관리자 승인을 기다리고 있습니다"
                : "사역·부서 가입 페이지에서 가입을 신청해주세요"}
            </div>
            <button
              onClick={() => router.push(`/departments/${encodeURIComponent(dept.category)}`)}
              style={{
                padding: "12px 24px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >가입 신청 하러 가기</button>
          </div>
        </div>
      </div>
    );
  }

  const isEduDept = dept.category === "교육사역국";
  const grade = myGrade ?? 99;

  // 카테고리별 표시 여부 결정
  const visibleCategories = MENU_CATEGORIES.filter((cat) => {
    if (cat.onlyForDept && cat.onlyForDept !== dept.name) return false;
    return grade <= cat.maxGrade;
  });

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
        {/* Header */}
        <div style={{
          background: "#fff", borderRadius: 12, padding: "16px 20px", marginBottom: 20,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HeaderLogo />
            <div>
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{dept.category}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>
                {dept.icon} {dept.name}
                {grade <= 4 && (
                  <span style={{
                    marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700,
                    background: GRADE_BADGE[grade]?.bg || "#f1f5f9",
                    color: GRADE_BADGE[grade]?.color || "#64748b",
                  }}>
                    {GRADE_BADGE[grade]?.label || `등급 ${grade}`}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button onClick={() => router.push("/home")} style={backBtnStyle}>← 홈</button>
        </div>

        {/* Welcome Card */}
        <div style={{
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 24, padding: "32px 28px",
          textAlign: "center", color: "#fff", marginBottom: 24,
          boxShadow: "0 20px 60px rgba(99, 102, 241, 0.25)",
        }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>{dept.icon || "👋"}</div>
          <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 6, letterSpacing: -0.5 }}>{dept.name}</div>
          {dept.description && (
            <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.6, marginBottom: 14 }}>
              {dept.description}
            </div>
          )}
          <div style={{
            display: "inline-block", padding: "5px 14px", background: "rgba(255,255,255,0.2)",
            borderRadius: 20, fontSize: 11, fontWeight: 600,
          }}>
            👥 {dept.member_count}명
          </div>
        </div>

        {/* 비교육사역국 placeholder */}
        {!isEduDept && (
          <div style={{
            background: "#fff", borderRadius: 16, padding: 28, textAlign: "center",
            color: "#94a3b8", fontSize: 13, lineHeight: 1.7,
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🚧</div>
            <div style={{ fontWeight: 700, color: "#64748b", marginBottom: 6 }}>
              부서 게시판 / 일정 / 모임 등은 곧 추가됩니다
            </div>
            <div>앞으로 이 페이지에서 부서 공지, 일정, 모임 신청 등을 확인하실 수 있습니다.</div>
          </div>
        )}

        {/* 교육사역국 — 4 대분류 메뉴 */}
        {isEduDept && (
          <>
            {visibleCategories.map((cat) => (
              <div key={cat.id} style={{ marginBottom: 24 }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
                }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#1e293b", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{cat.icon}</span>
                    {cat.label}
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>
                    {GRADE_LABEL[cat.maxGrade]}까지 접근
                  </div>
                </div>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 10,
                }}>
                  {cat.items
                    .filter((item) => !item.onlyForDept || item.onlyForDept === dept.name)
                    .map((item) => (
                      <MenuCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                    ))}
                </div>
              </div>
            ))}

            {/* 등급 4(학부모) 등 모든 카테고리 안 보이는 경우 안내 */}
            {visibleCategories.length === 0 && (
              <div style={{
                background: "#fff7ed", border: "1.5px solid #fed7aa", borderRadius: 12, padding: 20,
                textAlign: "center", color: "#9a3412",
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>접근 가능한 메뉴가 없습니다</div>
                <div style={{ fontSize: 12 }}>
                  현재 등급: {GRADE_LABEL[grade] || `${grade} (불명)`}.
                  부서 관리자에게 등급 조정 문의하세요.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function MenuCard({ item, onClick }: { item: MenuItem; onClick: () => void }) {
  const dim = !item.implemented;
  return (
    <div
      onClick={onClick}
      style={{
        background: dim ? "#f8fafc" : "#fff",
        border: `1.5px solid ${dim ? "#e2e8f0" : item.color + "33"}`,
        borderRadius: 12,
        padding: "14px 14px",
        cursor: "pointer",
        transition: "all 0.15s",
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity: dim ? 0.7 : 1,
        position: "relative",
      }}
      onMouseOver={(e) => {
        if (dim) return;
        e.currentTarget.style.borderColor = item.color;
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = `0 8px 20px ${item.color}22`;
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = dim ? "#e2e8f0" : `${item.color}33`;
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 9,
        background: dim ? "#e2e8f0" : `${item.color}15`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18, flexShrink: 0,
      }}>{item.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: dim ? "#94a3b8" : "#1e293b" }}>
          {item.label}
          {dim && <span style={{ fontSize: 9, color: "#94a3b8", marginLeft: 6, fontWeight: 500 }}>(준비 중)</span>}
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2, lineHeight: 1.3 }}>{item.desc}</div>
      </div>
    </div>
  );
}

const GRADE_LABEL: Record<number, string> = {
  0: "전도사·교육사",
  1: "부장",
  2: "부부장·총무·서기",
  3: "교사",
  4: "학부모",
};

const GRADE_BADGE: Record<number, { label: string; bg: string; color: string }> = {
  0: { label: "전도사", bg: "#ecfdf5", color: "#15803d" },
  1: { label: "부장", bg: "#fef3c7", color: "#92400e" },
  2: { label: "총무·서기", bg: "#dbeafe", color: "#1e40af" },
  3: { label: "교사", bg: "#f1f5f9", color: "#475569" },
  4: { label: "학부모", bg: "#fef2f2", color: "#b91c1c" },
};

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const loadingStyle: React.CSSProperties = {
  ...pageStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
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
};
