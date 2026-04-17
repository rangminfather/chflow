"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

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

const EDU_MENUS = [
  {
    id: "journal",
    label: "일지작성",
    icon: "📓",
    desc: "교회학교 일지 · 통계 · 헌금",
    color: "#6366f1",
  },
  {
    id: "teacher-attendance",
    label: "선생임",
    icon: "👨‍🏫",
    desc: "교사 출석부 · 월별 관리",
    color: "#0ea5e9",
  },
  {
    id: "attendance",
    label: "출결",
    icon: "📋",
    desc: "학생 출석부 · 주차별 체크",
    color: "#10b981",
  },
  {
    id: "student-record",
    label: "학생출결",
    icon: "🔍",
    desc: "개별 학생 출결 이력 조회",
    color: "#f59e0b",
  },
  {
    id: "new-friend",
    label: "새친구",
    icon: "🌟",
    desc: "새친구 등록카드 · 생활기록부",
    color: "#ec4899",
  },
  {
    id: "talent",
    label: "달란트통장",
    icon: "🏅",
    desc: "학생별 달란트 적립 · 누적 합계",
    color: "#8b5cf6",
  },
];

export default function DepartmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [dept, setDept] = useState<DeptInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      load();
    })();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_department_info", { p_dept_id: deptId });
    if (!error && data && data.length > 0) {
      setDept(data[0]);
    }
    setLoading(false);
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
            background: "#fff",
            borderRadius: 20,
            padding: 32,
            textAlign: "center",
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
                padding: "12px 24px",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >가입 신청 하러 가기</button>
          </div>
        </div>
      </div>
    );
  }

  const isEduDept = dept.category === "교육사역국";

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        {/* Header */}
        <div style={{
          background: "#fff",
          borderRadius: 12,
          padding: "16px 20px",
          marginBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        }}>
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{dept.category}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>
              {dept.icon} {dept.name}
              {dept.is_admin && (
                <span style={{
                  marginLeft: 8,
                  fontSize: 10,
                  background: "#fef3c7",
                  color: "#92400e",
                  padding: "2px 8px",
                  borderRadius: 20,
                  fontWeight: 700,
                }}>관리자</span>
              )}
            </div>
          </div>
          <button onClick={() => router.push("/home")} style={backBtnStyle}>← 홈</button>
        </div>

        {/* Welcome Card */}
        <div style={{
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          borderRadius: 24,
          padding: "40px 32px",
          textAlign: "center",
          color: "#fff",
          marginBottom: 24,
          boxShadow: "0 20px 60px rgba(99, 102, 241, 0.3)",
        }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>{dept.icon || "👋"}</div>
          <div style={{ fontSize: 26, fontWeight: 900, marginBottom: 8, letterSpacing: -0.5 }}>
            {dept.name}
          </div>
          {dept.description && (
            <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.6, marginBottom: 16 }}>
              {dept.description}
            </div>
          )}
          <div style={{
            display: "inline-block",
            padding: "6px 16px",
            background: "rgba(255,255,255,0.2)",
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 600,
          }}>
            👥 활동 인원: {dept.member_count}명
          </div>
        </div>

        {/* 교육사역국 6개 메뉴 */}
        {isEduDept && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#1e293b", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              📚 부서 메뉴
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 14,
            }}>
              {EDU_MENUS.map((menu) => (
                <EduMenuCard
                  key={menu.id}
                  menu={menu}
                  onClick={() => router.push(`/departments/d/${deptId}/${menu.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* 비교육사역국 placeholder */}
        {!isEduDept && (
          <div style={{
            background: "#fff",
            borderRadius: 16,
            padding: 28,
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 13,
            lineHeight: 1.7,
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🚧</div>
            <div style={{ fontWeight: 700, color: "#64748b", marginBottom: 6 }}>
              부서 게시판 / 일정 / 모임 등은 곧 추가됩니다
            </div>
            <div>
              앞으로 이 페이지에서 부서 공지, 일정, 모임 신청 등을 확인하실 수 있습니다.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EduMenuCard({
  menu,
  onClick,
}: {
  menu: typeof EDU_MENUS[0];
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "#fff",
        border: `2px solid ${menu.color}22`,
        borderRadius: 16,
        padding: "20px 18px",
        cursor: "pointer",
        transition: "all 0.2s",
        display: "flex",
        alignItems: "center",
        gap: 16,
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = menu.color;
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = `0 12px 28px ${menu.color}33`;
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = `${menu.color}22`;
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)";
      }}
    >
      <div style={{
        width: 48,
        height: 48,
        borderRadius: 12,
        background: `${menu.color}15`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 24,
        flexShrink: 0,
      }}>{menu.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#1e293b", marginBottom: 3 }}>
          {menu.label}
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.4 }}>{menu.desc}</div>
      </div>
      <div style={{ color: "#cbd5e1", fontSize: 16 }}>›</div>
    </div>
  );
}

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
