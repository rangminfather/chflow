"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Department {
  id: string;
  category: string;
  name: string;
  description: string | null;
  icon: string | null;
  order_no: number;
  member_count: number;
  my_status: string | null;
}

export default function CategoryPage() {
  const router = useRouter();
  const params = useParams();
  const category = decodeURIComponent(params.category as string);

  const [authChecked, setAuthChecked] = useState(false);
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDept, setConfirmDept] = useState<Department | null>(null);
  const [requesting, setRequesting] = useState(false);

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
    const { data, error } = await supabase.rpc("get_departments_by_category", { p_category: category });
    if (!error) setDepts(data || []);
    setLoading(false);
  };

  const handleRequest = async () => {
    if (!confirmDept) return;
    setRequesting(true);
    const { error } = await supabase.rpc("request_department_join", { p_dept_id: confirmDept.id });
    setRequesting(false);
    if (error) {
      alert(`신청 실패: ${error.message}`);
      return;
    }
    setConfirmDept(null);
    alert("✅ 가입 신청이 완료되었습니다!\n관리자 승인 후 이용하실 수 있습니다.");
    load();
  };

  const statusBadge = (status: string | null) => {
    if (status === "approved") return { label: "✓ 가입됨", bg: "#dcfce7", color: "#15803d" };
    if (status === "pending") return { label: "⏳ 승인 대기", bg: "#fef3c7", color: "#92400e" };
    if (status === "rejected") return { label: "거절됨", bg: "#fee2e2", color: "#b91c1c" };
    return null;
  };

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>{category}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>가입할 부서를 선택하세요</div>
          </div>
          <button onClick={() => router.push("/departments")} style={backBtnStyle}>← 뒤로</button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>로딩 중...</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            {depts.map((d) => {
              const badge = statusBadge(d.my_status);
              const disabled = d.my_status === "approved" || d.my_status === "pending";
              return (
                <div
                  key={d.id}
                  onClick={() => !disabled && setConfirmDept(d)}
                  style={{
                    background: "#fff",
                    border: `2px solid ${d.my_status === "approved" ? "#10b981" : d.my_status === "pending" ? "#f59e0b" : "#e2e8f0"}`,
                    borderRadius: 16,
                    padding: "20px 18px",
                    cursor: disabled ? "default" : "pointer",
                    transition: "all 0.2s",
                    position: "relative",
                  }}
                  onMouseOver={(e) => {
                    if (disabled) return;
                    e.currentTarget.style.borderColor = "#6366f1";
                    e.currentTarget.style.transform = "translateY(-3px)";
                    e.currentTarget.style.boxShadow = "0 12px 24px rgba(99, 102, 241, 0.15)";
                  }}
                  onMouseOut={(e) => {
                    if (disabled) return;
                    e.currentTarget.style.borderColor = "#e2e8f0";
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  {badge && (
                    <div style={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      padding: "3px 10px",
                      background: badge.bg,
                      color: badge.color,
                      borderRadius: 6,
                      fontSize: 10,
                      fontWeight: 700,
                    }}>{badge.label}</div>
                  )}
                  <div style={{ fontSize: 36, marginBottom: 12 }}>{d.icon || "📁"}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: "#1e293b", marginBottom: 4 }}>{d.name}</div>
                  {d.description && (
                    <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5, marginBottom: 8 }}>{d.description}</div>
                  )}
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                    👥 {d.member_count}명 활동 중
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* === 가입 확인 모달 === */}
      {confirmDept && (
        <div onClick={() => !requesting && setConfirmDept(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 100, padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#fff",
            borderRadius: 20,
            padding: "28px 24px",
            maxWidth: 380,
            width: "100%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>{confirmDept.icon || "🏢"}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>{confirmDept.category}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#1e293b", marginBottom: 8 }}>{confirmDept.name}</div>
            {confirmDept.description && (
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>{confirmDept.description}</div>
            )}
            <div style={{
              padding: "16px 18px",
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 12,
              fontSize: 13,
              color: "#1e40af",
              marginBottom: 20,
              fontWeight: 600,
            }}>
              가입 신청 하시겠습니까?
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 20, lineHeight: 1.6 }}>
              신청 후 관리자 승인이 필요합니다.<br />
              승인되면 알림을 받으실 수 있습니다.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConfirmDept(null)}
                disabled={requesting}
                style={{ flex: 1, padding: "12px", background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >취소</button>
              <button
                onClick={handleRequest}
                disabled={requesting}
                style={{ flex: 1, padding: "12px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3)" }}
              >{requesting ? "신청 중..." : "신청"}</button>
            </div>
          </div>
        </div>
      )}
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
