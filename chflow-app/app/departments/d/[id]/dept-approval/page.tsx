"use client";

// 사역 가입 승인 — 부서 부장(grade 1)·전도사(grade 0) 가 자기 부서 신청 승인.
// 시스템 admin 의 admin/dept-pending 페이지와 별개. 부서 단위.

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";

interface PendingJoin {
  id: string;
  department_id: string;
  user_id: string;
  user_name: string;
  user_phone: string | null;
  user_role: string | null;
  user_sub_role: string | null;
  category: string;
  dept_name: string;
  dept_icon: string | null;
  requested_at: string;
}

const GRADES = [
  { g: 0, label: "전도사 · 교육사", desc: "모든 메뉴" },
  { g: 1, label: "부장", desc: "모든 메뉴" },
  { g: 2, label: "부부장 · 총무 · 서기", desc: "공지·학생·행정" },
  { g: 3, label: "교사", desc: "공지·학생" },
  { g: 4, label: "학부모", desc: "공지" },
];

export default function DeptApprovalPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [pending, setPending] = useState<PendingJoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<PendingJoin | null>(null);
  const [pickedGrade, setPickedGrade] = useState(3);
  const [processing, setProcessing] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_dept_pending_for_leader", { p_dept_id: deptId });
    if (error) { showToast(error.message); setLoading(false); return; }
    setPending(data || []);
    const { data: d } = await supabase.from("departments").select("name").eq("id", deptId).maybeSingle();
    if (d) setDeptName(d.name);
    setLoading(false);
  }, [deptId]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      const { data: g } = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      if (g === null || g === undefined || g > 1) {
        showToast("권한 없음 (전도사·부장만)");
        setTimeout(() => router.replace(`/departments/d/${deptId}`), 1500);
        return;
      }
      setAuthChecked(true);
      await load();
    })();
  }, [router, deptId, load]);

  function openApprove(j: PendingJoin) {
    setApproving(j);
    setPickedGrade(3);
  }

  async function doApprove() {
    if (!approving) return;
    setProcessing(approving.id);
    const { error } = await supabase.rpc("dept_leader_approve_join", {
      p_join_id: approving.id,
      p_approved: true,
      p_grade: pickedGrade,
    });
    setProcessing(null);
    if (error) { showToast(error.message); return; }
    showToast(`${approving.user_name} 승인 완료 (등급 ${pickedGrade})`);
    setApproving(null);
    load();
  }

  async function doReject(j: PendingJoin) {
    if (!confirm(`${j.user_name}님의 가입 신청을 거절하시겠습니까?`)) return;
    setProcessing(j.id);
    const { error } = await supabase.rpc("dept_leader_approve_join", {
      p_join_id: j.id,
      p_approved: false,
    });
    setProcessing(null);
    if (error) { showToast(error.message); return; }
    showToast(`${j.user_name} 거절 처리됨`);
    load();
  }

  if (!authChecked) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9" }}>권한 확인 중...</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", paddingBottom: 60, fontFamily: "'Noto Sans KR', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <HeaderLogo />

      <div style={{ maxWidth: 800, margin: "0 auto", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={btnGhost}>←</button>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", margin: 0 }}>📥 사역 가입 승인</h1>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{deptName}</div>
          </div>
        </div>

        <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, padding: 12, fontSize: 12, color: "#78350f", marginBottom: 16, lineHeight: 1.6 }}>
          ⚠️ 본 부서로 가입 신청한 사용자만 표시됩니다. 승인 시 등급(권한)을 선택할 수 있고, 추후 <strong>부서원 등급 관리</strong>에서 수정 가능합니다.
        </div>

        <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", background: "#fffbeb" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#92400e" }}>
              ⏳ 가입 신청 대기 ({pending.length}건)
            </div>
          </div>
          {loading ? (
            <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>로딩 중...</div>
          ) : pending.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              대기 중인 가입 신청이 없습니다
            </div>
          ) : (
            pending.map((j) => (
              <div key={j.id} style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "linear-gradient(135deg, #eef2ff, #ede9fe)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
                  {j.dept_icon || "📁"}
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
                    {j.user_name} <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>({j.user_sub_role || "-"})</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                    📞 {j.user_phone || "-"} · 신청 {new Date(j.requested_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => doReject(j)} disabled={processing === j.id} style={btnDanger}>거절</button>
                  <button onClick={() => openApprove(j)} disabled={processing === j.id} style={btnApprove}>✓ 승인</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 승인 + 등급 모달 */}
      {approving && (
        <div onClick={() => setApproving(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 440, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginBottom: 6 }}>✅ 부서 가입 승인</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
              <strong>{approving.user_name}</strong>님을 <strong>{deptName}</strong>에 승인합니다. 등급(권한)을 선택하세요.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {GRADES.map((row) => (
                <button
                  key={row.g}
                  onClick={() => setPickedGrade(row.g)}
                  style={{
                    padding: "12px 14px",
                    background: pickedGrade === row.g ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "#f8fafc",
                    color: pickedGrade === row.g ? "#fff" : "#1e293b",
                    border: pickedGrade === row.g ? "1px solid transparent" : "1px solid #e2e8f0",
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: pickedGrade === row.g ? "rgba(255,255,255,0.2)" : "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: pickedGrade === row.g ? "#fff" : "#6366f1" }}>{row.g}</div>
                  <div>
                    <div>{row.label}</div>
                    <div style={{ fontSize: 10, fontWeight: 500, color: pickedGrade === row.g ? "rgba(255,255,255,0.8)" : "#94a3b8", marginTop: 2 }}>{row.desc}</div>
                  </div>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button onClick={() => setApproving(null)} style={{ flex: 1, padding: 12, background: "#f1f5f9", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#64748b", cursor: "pointer", fontFamily: "inherit" }}>취소</button>
              <button onClick={doApprove} disabled={processing === approving.id} style={{ flex: 1, padding: 12, background: "linear-gradient(135deg, #10b981, #059669)", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
                {processing === approving.id ? "처리 중..." : `등급 ${pickedGrade} 으로 승인`}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#1e293b", color: "#fff", padding: "10px 18px", borderRadius: 12, fontSize: 13, zIndex: 9999 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

const btnGhost: React.CSSProperties = { padding: "10px 16px", background: "#f1f5f9", color: "#475569", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnApprove: React.CSSProperties = { padding: "8px 14px", background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnDanger: React.CSSProperties = { padding: "8px 14px", background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
