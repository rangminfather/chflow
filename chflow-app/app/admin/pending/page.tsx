"use client";

import { useCallback, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { getRoleImageByLabel, getAllSubRoleOptions } from "@/lib/roles";
import { Hourglass, CheckCircle2, CircleHelp, RefreshCw, Phone, Cake, MapPin, Info } from "lucide-react";

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
  signup_birth_date: string | null;
  signup_gender: string | null;
  signup_address: string | null;
  signup_pasture: string | null;
  signup_plain: string | null;
  signup_is_child: boolean | null;
  signup_guardian_name: string | null;
  signup_guardian_phone: string | null;
  signup_parent_name: string | null;
}

const displayGender = (value?: string | null) => {
  if (value === "M") return "남";
  if (value === "F") return "여";
  return value || "";
};

export default function AdminPendingPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [approveModal, setApproveModal] = useState<{ user: PendingUser; subRole: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_pending_signups");
    if (!error) setPending(data || []);
    setLoading(false);
  }, []);

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
        router.replace("/home");
        return;
      }
      setAuthChecked(true);
      load();
    })();
  }, [load, router]);

  const handleApprove = async (user: PendingUser) => {
    setApproveModal({ user, subRole: user.sub_role || "성도 (남)" });
  };

  const confirmApprove = async () => {
    if (!approveModal) return;
    const { user, subRole } = approveModal;
    setApproveModal(null);
    setProcessing(user.id);
    const { error } = await supabase.rpc("approve_user", {
      p_user_id: user.id,
      p_approved: true,
      p_sub_role: subRole || null,
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
      <LoadingView full />
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg-soft)",
      fontFamily: "'Noto Sans KR', sans-serif",
      padding: 16,
    }}>

      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ background: "var(--card)", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HeaderLogo />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)" }}>가입 대기자 관리</div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>회원가입 신청 → 승인/거절</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => router.push("/admin/members")} style={{
              padding: "8px 14px", background: "var(--accent-soft)", color: "var(--accent)", border: "none",
              borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>회원 관리</button>
            <button onClick={() => router.push("/home")} style={{
              padding: "8px 14px", background: "var(--bg-soft)", border: "none",
              borderRadius: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit",
            }}>← 홈</button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
          <StatCard icon={<Hourglass size={26} strokeWidth={1.8} color="var(--warning)" />} label="대기 중" value={pending.length} color="var(--warning)" />
          <StatCard icon={<CheckCircle2 size={26} strokeWidth={1.8} color="var(--success)" />} label="성도 매칭됨" value={pending.filter(p => p.matched_member_id).length} color="var(--success)" />
          <StatCard icon={<CircleHelp size={26} strokeWidth={1.8} color="var(--accent)" />} label="신규 (매칭 없음)" value={pending.filter(p => !p.matched_member_id).length} color="var(--accent)" />
        </div>

        {/* List */}
        <div style={{ background: "var(--card)", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--hairline)", display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-mid)" }}>
              가입 신청 목록 ({pending.length}건)
            </div>
            <button onClick={load} disabled={loading} style={{
              padding: "4px 12px", background: "var(--accent-soft)", color: "var(--accent)",
              border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6,
            }}>{loading ? "로딩..." : <><RefreshCw size={12} strokeWidth={1.8} /> 새로고침</>}</button>
          </div>

          {pending.length === 0 && !loading && (
            <EmptyState message="대기 중인 가입 신청이 없습니다" />
          )}

          {pending.map((user) => (
            <div key={user.id} style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--bg-soft)",
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}>
              {/* Match Badge */}
              {user.matched_member_id ? (
                <div style={{
                  padding: "4px 10px", background: "var(--success-soft)",
                  color: "var(--success)", borderRadius: 6, fontSize: 10, fontWeight: 700,
                  whiteSpace: "nowrap",
                }}>✓ 등록 성도</div>
              ) : (
                <div style={{
                  padding: "4px 10px", background: "var(--warning-soft)",
                  color: "var(--warning)", borderRadius: 6, fontSize: 10, fontWeight: 700,
                  whiteSpace: "nowrap",
                }}>신규</div>
              )}

              {/* User Info */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>{user.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>@{user.username}</div>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-mid)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Phone size={13} strokeWidth={1.8} /> {user.phone || "-"}</span>
                  {user.signup_birth_date && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Cake size={13} strokeWidth={1.8} /> {user.signup_birth_date}</span>}
                  {user.signup_gender && <span>{displayGender(user.signup_gender)}</span>}
                  <span style={{
                    padding: "1px 8px", background: "var(--accent-soft)",
                    color: "var(--accent)", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  }}>{user.sub_role || user.role}</span>
                  {user.matched_plain && (
                    <span style={{ color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <MapPin size={13} strokeWidth={1.8} /> {user.matched_plain}평원 · {user.matched_pasture}목장
                    </span>
                  )}
                  {user.signup_is_child && (
                    <span style={{ color: "var(--ink-soft)" }}>
                      보호자: {user.signup_parent_name || user.signup_guardian_name || "-"} / {user.signup_guardian_phone || "-"}
                    </span>
                  )}
                </div>
                {(user.signup_address || user.signup_pasture) && (
                  <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 5, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {user.signup_address && <span>주소: {user.signup_address}</span>}
                    {user.signup_pasture && <span>신청 목장: {user.signup_plain ? `${user.signup_plain} · ` : ""}{user.signup_pasture}</span>}
                  </div>
                )}
                <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 4 }}>
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
                    background: "var(--danger-soft)",
                    color: "var(--danger)",
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
                    background: "linear-gradient(135deg, var(--success), var(--success))",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: processing === user.id ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    boxShadow: "0 4px 12px rgba(61, 122, 78, 0.3)",
                  }}
                >
                  {processing === user.id ? "..." : "✓ 승인"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, padding: "12px 16px", background: "var(--accent-soft)", borderRadius: 10, fontSize: 11, color: "var(--accent-strong)", lineHeight: 1.6 }}>
          <Info size={13} strokeWidth={1.8} style={{ verticalAlign: "-2px", marginRight: 4 }} /> <strong>등록 성도</strong>는 명성교회 요람에 등록된 회원과 매칭된 가입 신청입니다.<br />
          <strong>신규</strong>는 요람에 없는 신규 가입 신청입니다. 본인 확인 후 승인해주세요.
        </div>
      </div>

      {/* 승인 모달 — 직분 확정 */}
      {approveModal && (
        <div onClick={() => setApproveModal(null)} style={{
          position: "fixed", inset: 0, background: "rgba(43,39,34,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--card)", borderRadius: 16, padding: "24px 20px",
            width: "100%", maxWidth: 400, boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginBottom: 4 }}>
              ✓ 가입 승인
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 20 }}>
              {approveModal.user.name}({approveModal.user.username}) 님
            </div>

            {/* 직분 선택 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-mid)", marginBottom: 8 }}>
                직분 확정 <span style={{ fontSize: 10, color: "var(--ink-faint)", fontWeight: 400 }}>(가입자 선택값: {approveModal.user.sub_role || "미설정"})</span>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{
                  width: 48, height: 60, borderRadius: 8, overflow: "hidden", flexShrink: 0,
                  background: "var(--bg-soft)",
                }}>
                  <img src={getRoleImageByLabel(approveModal.subRole)} alt={approveModal.subRole}
                    style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "top center" }} />
                </div>
                <select
                  value={approveModal.subRole}
                  onChange={e => setApproveModal({ ...approveModal, subRole: e.target.value })}
                  style={{
                    flex: 1, padding: "10px 12px", fontSize: 13, fontWeight: 700,
                    border: "1.5px solid var(--hairline-strong)", borderRadius: 8,
                    fontFamily: "inherit", background: "var(--card)", color: "var(--ink)",
                  }}
                >
                  {getAllSubRoleOptions().map(opt => (
                    opt.isHeader
                      ? <optgroup key={opt.label} label={`── ${opt.label}`} />
                      : <option key={opt.label} value={opt.label}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setApproveModal(null)} style={{
                padding: "10px 18px", background: "var(--bg-soft)", border: "none",
                borderRadius: 8, fontSize: 13, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit",
              }}>취소</button>
              <button onClick={confirmApprove} style={{
                padding: "10px 20px", background: "linear-gradient(135deg, var(--success), var(--success))",
                color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 12px rgba(61,122,78,0.3)",
              }}>✓ 승인 확정</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div style={{
      background: "var(--card)",
      borderRadius: 12,
      padding: "16px 20px",
      borderLeft: `4px solid ${color}`,
      display: "flex",
      alignItems: "center",
      gap: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center" }}>{icon}</div>
      <div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "var(--ink)" }}>{value}</div>
        <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{label}</div>
      </div>
    </div>
  );
}
