"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface PendingUser {
  id: string;
  username: string;
  name: string;
  phone: string;
  role: string;
  sub_role: string;
  status: string;
  created_at: string;
  matched_member_id: string | null;
  matched_member_name: string | null;
  matched_pasture: string | null;
  matched_plain: string | null;
}

export default function AdminPendingPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const { data } = await supabase.rpc("get_my_status");
      const profile = data?.[0];
      if (!profile || !["admin", "office", "pastor"].includes(profile.role)) {
        router.replace("/dashboard");
        return;
      }
      setAuthChecked(true);
      load();
    })();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_pending_signups");
    if (!error) setPending(data || []);
    setLoading(false);
  };

  const handleApprove = async (user: PendingUser) => {
    if (!confirm(`${user.name}(${user.username})님의 가입을 승인하시겠습니까?`)) return;
    setProcessing(user.id);
    const { error } = await supabase.rpc("approve_user", {
      p_user_id: user.id,
      p_approved: true,
    });
    if (error) {
      alert(`승인 실패: ${error.message}`);
      setProcessing(null);
      return;
    }
    setProcessing(null);
    load();
  };

  const handleReject = async (user: PendingUser) => {
    if (!confirm(`${user.name}(${user.username})님의 가입을 거절하시겠습니까?`)) return;
    setProcessing(user.id);
    const { error } = await supabase.rpc("admin_reject_signup", {
      p_user_id: user.id,
      p_delete: false,
    });
    if (error) {
      alert(`거절 실패: ${error.message}`);
      setProcessing(null);
      return;
    }
    setProcessing(null);
    load();
  };

  if (!authChecked) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9" }}>
        로딩 중...
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f1f5f9",
      fontFamily: "'Noto Sans KR', sans-serif",
      padding: 16,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>가입 대기자 관리</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>회원가입 신청 → 승인/거절</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => router.push("/admin/members")} style={{
              padding: "8px 14px", background: "#eef2ff", color: "#6366f1", border: "none",
              borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>회원 관리</button>
            <button onClick={() => router.push("/dashboard")} style={{
              padding: "8px 14px", background: "#f1f5f9", border: "none",
              borderRadius: 8, fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit",
            }}>← 대시보드</button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
          <StatCard icon="⏳" label="대기 중" value={pending.length} color="#f59e0b" />
          <StatCard icon="✅" label="성도 매칭됨" value={pending.filter(p => p.matched_member_id).length} color="#10b981" />
          <StatCard icon="❓" label="신규 (매칭 없음)" value={pending.filter(p => !p.matched_member_id).length} color="#6366f1" />
        </div>

        {/* List */}
        <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
              가입 신청 목록 ({pending.length}건)
            </div>
            <button onClick={load} disabled={loading} style={{
              padding: "4px 12px", background: "#eef2ff", color: "#6366f1",
              border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}>{loading ? "로딩..." : "🔄 새로고침"}</button>
          </div>

          {pending.length === 0 && !loading && (
            <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
              <div style={{ fontSize: 14 }}>대기 중인 가입 신청이 없습니다</div>
            </div>
          )}

          {pending.map((user) => (
            <div key={user.id} style={{
              padding: "16px 20px",
              borderBottom: "1px solid #f1f5f9",
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}>
              {/* Match Badge */}
              {user.matched_member_id ? (
                <div style={{
                  padding: "4px 10px", background: "#dcfce7",
                  color: "#15803d", borderRadius: 6, fontSize: 10, fontWeight: 700,
                  whiteSpace: "nowrap",
                }}>✓ 등록 성도</div>
              ) : (
                <div style={{
                  padding: "4px 10px", background: "#fef3c7",
                  color: "#92400e", borderRadius: 6, fontSize: 10, fontWeight: 700,
                  whiteSpace: "nowrap",
                }}>신규</div>
              )}

              {/* User Info */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>{user.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>@{user.username}</div>
                </div>
                <div style={{ fontSize: 12, color: "#475569", display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>📞 {user.phone || "-"}</span>
                  <span style={{
                    padding: "1px 8px", background: "#eef2ff",
                    color: "#6366f1", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  }}>{user.sub_role || user.role}</span>
                  {user.matched_plain && (
                    <span style={{ color: "#64748b" }}>
                      📍 {user.matched_plain}평원 · {user.matched_pasture}목장
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                  신청일: {new Date(user.created_at).toLocaleString("ko-KR")}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => handleReject(user)}
                  disabled={processing === user.id}
                  style={{
                    padding: "8px 16px",
                    background: "#fee2e2",
                    color: "#b91c1c",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: processing === user.id ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {processing === user.id ? "..." : "거절"}
                </button>
                <button
                  onClick={() => handleApprove(user)}
                  disabled={processing === user.id}
                  style={{
                    padding: "8px 16px",
                    background: "linear-gradient(135deg, #10b981, #059669)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: processing === user.id ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
                  }}
                >
                  {processing === user.id ? "..." : "✓ 승인"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, padding: "12px 16px", background: "#eff6ff", borderRadius: 10, fontSize: 11, color: "#1e40af", lineHeight: 1.6 }}>
          💡 <strong>등록 성도</strong>는 명성교회 요람에 등록된 회원과 매칭된 가입 신청입니다.<br />
          <strong>신규</strong>는 요람에 없는 신규 가입 신청입니다. 본인 확인 후 승인해주세요.
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  return (
    <div style={{
      background: "#fff",
      borderRadius: 12,
      padding: "16px 20px",
      borderLeft: `4px solid ${color}`,
      display: "flex",
      alignItems: "center",
      gap: 14,
    }}>
      <div style={{ fontSize: 28 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#1e293b" }}>{value}</div>
        <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
      </div>
    </div>
  );
}
