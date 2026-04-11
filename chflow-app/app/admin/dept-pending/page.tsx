"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface PendingJoin {
  id: string;
  department_id: string;
  user_id: string;
  user_name: string;
  user_phone: string;
  user_role: string;
  user_sub_role: string;
  category: string;
  dept_name: string;
  dept_icon: string;
  requested_at: string;
}

export default function AdminDeptPendingPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [pending, setPending] = useState<PendingJoin[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data } = await supabase.rpc("get_my_status");
      const profile = data?.[0];
      if (!profile || !["admin", "office", "pastor"].includes(profile.role)) {
        router.replace("/home");
        return;
      }
      setAuthChecked(true);
      load();
    })();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_dept_pending");
    if (!error) setPending(data || []);
    setLoading(false);
  };

  const handleApprove = async (j: PendingJoin) => {
    if (!confirm(`${j.user_name}님의 ${j.category} / ${j.dept_name} 가입을 승인하시겠습니까?`)) return;
    setProcessing(j.id);
    const { error } = await supabase.rpc("admin_approve_dept_join", { p_join_id: j.id, p_approved: true });
    setProcessing(null);
    if (error) { alert(`승인 실패: ${error.message}`); return; }
    load();
  };

  const handleReject = async (j: PendingJoin) => {
    if (!confirm(`${j.user_name}님의 ${j.category} / ${j.dept_name} 가입을 거절하시겠습니까?`)) return;
    setProcessing(j.id);
    const { error } = await supabase.rpc("admin_approve_dept_join", { p_join_id: j.id, p_approved: false });
    setProcessing(null);
    if (error) { alert(`거절 실패: ${error.message}`); return; }
    load();
  };

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>부서 가입 승인</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>사역·부서 가입 신청 처리</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => router.push("/admin/pending")} style={subBtnStyle("#fef3c7", "#92400e")}>⏳ 회원 가입자</button>
            <button onClick={() => router.push("/admin/members")} style={subBtnStyle("#eef2ff", "#6366f1")}>👥 회원 관리</button>
            <button onClick={() => router.push("/home")} style={subBtnStyle("#f1f5f9", "#475569")}>← 홈</button>
          </div>
        </div>

        <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
              부서 가입 신청 ({pending.length}건)
            </div>
            <button onClick={load} disabled={loading} style={{ padding: "4px 12px", background: "#eef2ff", color: "#6366f1", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              {loading ? "로딩..." : "🔄 새로고침"}
            </button>
          </div>

          {pending.length === 0 && !loading ? (
            <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
              <div style={{ fontSize: 14 }}>대기 중인 부서 가입 신청이 없습니다</div>
            </div>
          ) : (
            pending.map((j) => (
              <div key={j.id} style={{
                padding: "16px 20px",
                borderBottom: "1px solid #f1f5f9",
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: "linear-gradient(135deg, #eef2ff, #ede9fe)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 24, flexShrink: 0,
                }}>
                  {j.dept_icon || "📁"}
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>{j.user_name}</div>
                    {j.user_sub_role && (
                      <span style={{ padding: "1px 8px", background: "#eef2ff", color: "#6366f1", borderRadius: 4, fontSize: 10, fontWeight: 600 }}>{j.user_sub_role}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", marginBottom: 4 }}>
                    📞 {j.user_phone || "-"}
                  </div>
                  <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 600 }}>
                    가입 신청: <span style={{ color: "#6366f1" }}>{j.category} / {j.dept_name}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                    신청일: {new Date(j.requested_at).toLocaleString("ko-KR")}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => handleReject(j)}
                    disabled={processing === j.id}
                    style={{ padding: "8px 16px", background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  >{processing === j.id ? "..." : "거절"}</button>
                  <button
                    onClick={() => handleApprove(j)}
                    disabled={processing === j.id}
                    style={{ padding: "8px 16px", background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)" }}
                  >{processing === j.id ? "..." : "✓ 승인"}</button>
                </div>
              </div>
            ))
          )}
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

const subBtnStyle = (bg: string, color: string): React.CSSProperties => ({
  padding: "8px 14px",
  background: bg,
  color: color,
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
});
