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
}

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

  // 가입된 부서 메인 페이지
  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        {/* Header */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{dept.category}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>{dept.icon} {dept.name}</div>
          </div>
          <button onClick={() => router.push("/home")} style={backBtnStyle}>← 홈</button>
        </div>

        {/* Welcome Card */}
        <div style={{
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          borderRadius: 24,
          padding: "60px 40px",
          textAlign: "center",
          color: "#fff",
          marginBottom: 24,
          boxShadow: "0 20px 60px rgba(99, 102, 241, 0.3)",
        }}>
          <div style={{ fontSize: 72, marginBottom: 20 }}>{dept.icon || "👋"}</div>
          <div style={{ fontSize: 32, fontWeight: 900, marginBottom: 12, letterSpacing: -1 }}>
            반갑습니다! {dept.name}입니다
          </div>
          {dept.description && (
            <div style={{ fontSize: 14, opacity: 0.9, lineHeight: 1.6 }}>
              {dept.description}
            </div>
          )}
          <div style={{
            marginTop: 24,
            display: "inline-block",
            padding: "8px 18px",
            background: "rgba(255,255,255,0.2)",
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 600,
          }}>
            👥 활동 인원: {dept.member_count}명
          </div>
        </div>

        {/* Placeholder for future content */}
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
      </div>
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
