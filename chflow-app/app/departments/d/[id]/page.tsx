"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DeptIcon from "@/components/DeptIcon";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import {
  type LucideIcon,
  Megaphone, CalendarDays, Newspaper, GraduationCap, ClipboardCheck, ClipboardList,
  Medal, Users, Inbox, BookText, CalendarPlus, BookOpen, FileText, BarChart3,
  TrendingUp, ScrollText, Sparkles, UserCheck, UserCog, ListChecks, FileSearch,
  Settings, Award, Lock, CircleHelp, Construction, Smile,
} from "lucide-react";

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
  icon: LucideIcon;
  desc: string;
  color: string;
  implemented: boolean;  // 구현 안 된 페이지는 클릭 시 "준비 중" 토스트
  onlyForDept?: string | null; // null = 모든 부서 (카테고리 onlyForDept 무시)
  maxGrade?: number;
}

interface MenuCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  maxGrade: number;       // 이 등급 이하만 표시 (예: 행정관리 maxGrade=2 → 0/1/2 만 보임)
  desc: string;
  items: MenuItem[];
  /** 일부 부서만 표시 (없으면 모두) */
  onlyForDept?: string;
}

const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: "notices",
    label: "공통",
    icon: Megaphone,
    maxGrade: 4,
    desc: "부서 공통 자료 / 공지 / 주보",
    items: [
      { id: "notices", label: "공지 게시판", icon: Megaphone, desc: "부서 공지·알림", color: "#4A7B96", implemented: true },
      { id: "monthly-plan", label: "월간 교육계획서", icon: CalendarDays, desc: "월간 교육계획 파일 조회", color: "var(--accent)", implemented: true },
      { id: "bulletin", label: "주보 보기", icon: Newspaper, desc: "초등1부 주보 열람", color: "#3E7D74", implemented: true, onlyForDept: "초등1부" },
    ],
  },
  {
    id: "students",
    label: "학생관리",
    icon: GraduationCap,
    maxGrade: 3,
    desc: "출결 / 달란트 / 우리반 정보",
    onlyForDept: "초등1부",
    items: [
      { id: "my-class-attendance", label: "내 반 출결", icon: ClipboardCheck, desc: "내 담당 반 학생 출석 체크", color: "var(--success)", implemented: true },
      { id: "talent", label: "달란트통장", icon: Medal, desc: "달란트 적립 · 누적 합계", color: "var(--accent-muted)", implemented: true },
      { id: "my-class", label: "우리반 아이 정보", icon: Users, desc: "담당 반 학생 정보", color: "var(--warning)", implemented: true },
    ],
  },
  {
    id: "admin",
    label: "행정관리",
    icon: ClipboardList,
    maxGrade: 2,
    desc: "주보 / 일지 / 통계 / 등록 / 가입승인",
    onlyForDept: "초등1부",
    items: [
      { id: "dept-approval", label: "사역 가입 승인", icon: Inbox, desc: "본 부서 가입 신청 승인 · 등급 부여", color: "var(--success)", implemented: true, onlyForDept: null, maxGrade: 2 },
      { id: "weekly-bulletin", label: "주보 만들기", icon: Newspaper, desc: "주보 자동 생성·UMS 등록", color: "#3E7D74", implemented: true },
      { id: "journal", label: "교육일지작성", icon: BookText, desc: "일지 · 통계 · 헌금", color: "var(--accent)", implemented: true },
      { id: "monthly-plan-upload", label: "월간교육등록", icon: CalendarPlus, desc: "월간 교육계획서 등록", color: "var(--accent)", implemented: true },
      { id: "review-upload", label: "복습문제 관리", icon: BookOpen, desc: "공과 복습문제 PPTX 업로드·삭제", color: "#6B4F8C", implemented: true },
      { id: "students-info", label: "학생정보관리", icon: FileText, desc: "학생 명부 · 인적사항", color: "#B97B3D", implemented: false },
      { id: "attendance-stats", label: "출결통계", icon: BarChart3, desc: "선생님·학생 출석 통계", color: "#7A8C3D", implemented: false },
      { id: "talent-stats", label: "달란트통계", icon: TrendingUp, desc: "달란트 누적·랭킹", color: "#7E5F9E", implemented: false },
      { id: "talent-rules", label: "달란트 규칙", icon: ScrollText, desc: "매주 적립 규칙·특별·보너스", color: "var(--warning)", implemented: true },
      { id: "new-friend", label: "새친구등록", icon: Sparkles, desc: "새친구 등록카드 · 생활기록부", color: "#C26D8C", implemented: true },
      { id: "teacher-attendance", label: "선생님 등록 / 출석", icon: UserCheck, desc: "교사 출석부 · 월별 관리", color: "#4A7B96", implemented: true },
      { id: "teacher-assign", label: "담임선생님 지정", icon: UserCog, desc: "반별 담임 변경 · 회원 연결 (전도사·부장)", color: "var(--accent-muted)", implemented: true },
      { id: "attendance", label: "출결 통합 조회", icon: ListChecks, desc: "전 반 학생 출결 (관리자 강제 수정 가능)", color: "var(--success)", implemented: true },
      { id: "student-record", label: "학생 출결 조회", icon: FileSearch, desc: "개별 학생 출결 이력", color: "var(--warning)", implemented: true },
    ],
  },
  {
    id: "department",
    label: "부서관리",
    icon: Settings,
    maxGrade: 1,
    desc: "부서원 등급 · 설정",
    items: [
      { id: "monthly-plan-upload", label: "월간교육등록", icon: CalendarPlus, desc: "월간 교육계획서 등록", color: "var(--accent)", implemented: true, maxGrade: 2 },
      { id: "members-grade", label: "부서원 등급 관리", icon: Award, desc: "각 부서원 등급(0~4) 변경 — 전도사·부장만 가능", color: "var(--accent)", implemented: true },
      { id: "promote", label: "진급 마법사", icon: GraduationCap, desc: "매년 학년 진급 · 반편성 · 담임배정", color: "var(--danger)", implemented: true },
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
    })();
  }, [deptId, router]);

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

  if (!authChecked || loading) return <LoadingView full />;

  if (!dept) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: "center", padding: 60 }}>
          <EmptyState icon={<CircleHelp size={24} strokeWidth={1.6} />} message="부서를 찾을 수 없습니다" padding={0} />
          <button onClick={() => router.push("/home")} style={{ ...backBtnStyle, marginTop: 16 }}>홈으로</button>
        </div>
      </div>
    );
  }

  if (!dept.is_member) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 480, margin: "60px auto", padding: 24 }}>
          <div style={{
            background: "var(--card)", borderRadius: 20, padding: 32, textAlign: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
          }}>
            <div style={{ marginBottom: 16 }}><Lock size={44} strokeWidth={1.8} style={{ color: "var(--ink-faint)" }} /></div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>
              아직 가입되지 않은 부서입니다
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 24 }}>
              {dept.my_status === "pending"
                ? "관리자 승인을 기다리고 있습니다"
                : "사역·부서 가입 페이지에서 가입을 신청해주세요"}
            </div>
            <button
              onClick={() => router.push(`/departments/${encodeURIComponent(dept.category)}`)}
              style={{
                padding: "12px 24px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
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
  // item.onlyForDept !== undefined 면 item 값 우선 (null = 모든 부서), 없으면 cat.onlyForDept 상속
  const visibleCategories = MENU_CATEGORIES.filter((cat) => {
    return cat.items.some((item) => {
      const deptFilter = item.onlyForDept !== undefined ? item.onlyForDept : cat.onlyForDept;
      if (deptFilter && deptFilter !== dept.name) return false;
      return grade <= (item.maxGrade ?? cat.maxGrade);
    });
  });

  return (
    <div style={pageStyle}>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
        {/* Header */}
        <div style={{
          background: "var(--card)", borderRadius: 12, padding: "16px 20px", marginBottom: 20,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HeaderLogo />
            <div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)", fontWeight: 600 }}>{dept.category}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 7 }}>
                <DeptIcon name={dept.name} category={dept.category} size={18} /> {dept.name}
                {grade <= 4 && (
                  <span style={{
                    marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700,
                    background: GRADE_BADGE[grade]?.bg || "var(--bg-soft)",
                    color: GRADE_BADGE[grade]?.color || "var(--ink-soft)",
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
          background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", borderRadius: 24, padding: "32px 28px",
          textAlign: "center", color: "#fff", marginBottom: 24,
          boxShadow: "0 20px 60px rgba(62, 90, 74, 0.25)",
        }}>
          <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}>
            <DeptIcon name={dept.name} category={dept.category} size={44} color="#fff" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6, letterSpacing: -0.5 }}>{dept.name}</div>
          {dept.description && (
            <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.6, marginBottom: 14 }}>
              {dept.description}
            </div>
          )}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", background: "rgba(255,255,255,0.2)",
            borderRadius: 20, fontSize: 11, fontWeight: 600,
          }}>
            <Users size={13} strokeWidth={1.8} /> {dept.member_count}명
          </div>
        </div>

        {/* 비교육사역국: 콘텐츠 안내 (관리 메뉴는 아래에 표시) */}
        {!isEduDept && (
          <div style={{
            background: "var(--card)", borderRadius: 16, padding: 28, textAlign: "center",
            color: "var(--ink-faint)", fontSize: 13, lineHeight: 1.7, marginBottom: 16,
          }}>
            <div style={{ marginBottom: 12 }}><Construction size={36} strokeWidth={1.8} style={{ color: "var(--ink-faint)" }} /></div>
            <div style={{ fontWeight: 700, color: "var(--ink-soft)", marginBottom: 6 }}>
              부서 게시판 / 일정 / 모임 등은 곧 추가됩니다
            </div>
            <div>앞으로 이 페이지에서 부서 공지, 일정, 모임 신청 등을 확인하실 수 있습니다.</div>
          </div>
        )}

        {/* 메뉴 그리드 — 행정관리(grade 0~2) · 부서관리(grade 0~1) 는 모든 부서 표시 */}
        {visibleCategories.map((cat) => (
          <div key={cat.id} style={{ marginBottom: 24 }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
                <cat.icon size={17} strokeWidth={1.8} style={{ color: "var(--accent)" }} />
                {cat.label}
              </div>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 10,
            }}>
              {cat.items
                .filter((item) => {
                  const deptFilter = item.onlyForDept !== undefined ? item.onlyForDept : cat.onlyForDept;
                  return (!deptFilter || deptFilter === dept.name) && grade <= (item.maxGrade ?? cat.maxGrade);
                })
                .map((item) => (
                  <MenuCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
                ))}
            </div>
          </div>
        ))}

        {/* 접근 가능한 메뉴가 전혀 없는 경우 안내 */}
        {visibleCategories.length === 0 && (
          <div style={{
            background: "#F8F0E3", border: "1.5px solid #fed7aa", borderRadius: 12, padding: 20,
            textAlign: "center", color: "#8A5526",
          }}>
            <div style={{ marginBottom: 8 }}><Lock size={28} strokeWidth={1.8} /></div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>접근 가능한 메뉴가 없습니다</div>
            <div style={{ fontSize: 12 }}>
              현재 등급: {GRADE_LABEL[grade] || `${grade} (불명)`}.
              부서 관리자에게 등급 조정 문의하세요.
            </div>
          </div>
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
        background: dim ? "var(--surface)" : "#fff",
        border: `1.5px solid ${dim ? "var(--hairline)" : `color-mix(in srgb, ${item.color} 26%, transparent)`}`,
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
        e.currentTarget.style.boxShadow = `0 8px 20px color-mix(in srgb, ${item.color} 13%, transparent)`;
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = dim ? "var(--hairline)" : `color-mix(in srgb, ${item.color} 26%, transparent)`;
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 9,
        background: dim ? "var(--hairline)" : `color-mix(in srgb, ${item.color} 9%, transparent)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <item.icon size={18} strokeWidth={1.8} style={{ color: dim ? "var(--ink-faint)" : item.color }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: dim ? "var(--ink-faint)" : "var(--ink)" }}>
          {item.label}
          {dim && <span style={{ fontSize: 9, color: "var(--ink-faint)", marginLeft: 6, fontWeight: 500 }}>(준비 중)</span>}
        </div>
        <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2, lineHeight: 1.3 }}>{item.desc}</div>
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
  0: { label: "전도사", bg: "var(--success-soft)", color: "var(--success)" },
  1: { label: "부장", bg: "var(--warning-soft)", color: "var(--warning)" },
  2: { label: "총무·서기", bg: "var(--accent-soft)", color: "var(--accent-strong)" },
  3: { label: "교사", bg: "var(--bg-soft)", color: "var(--ink-mid)" },
  4: { label: "학부모", bg: "var(--danger-soft)", color: "var(--danger)" },
};

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-soft)",
  fontFamily: "'Noto Sans KR', sans-serif",
};


const backBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--bg-soft)",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--ink-mid)",
  cursor: "pointer",
  fontFamily: "inherit",
};

const toastStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 40,
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(43, 39, 34,0.88)",
  color: "#fff",
  padding: "12px 24px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  zIndex: 999,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};
