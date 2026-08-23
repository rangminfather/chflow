"use client";

// 사역 가입 승인 — 부서 임원진(grade 0~2) 이 자기 부서 신청 승인.
// 시스템 admin 의 admin/dept-pending 페이지와 별개. 부서 단위.

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { photoThumb } from "@/lib/photo";
import { useConfirm } from "@/components/ConfirmDialog";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Inbox, AlertTriangle, Folder, Phone, CheckCircle2 } from "lucide-react";

interface PendingJoin {
  id: string;
  department_id: string;
  user_id: string;
  user_name: string;
  user_phone: string | null;
  user_role: string | null;
  user_sub_role: string | null;
  requested_role: string | null;
  category: string;
  dept_name: string;
  dept_icon: string | null;
  requested_at: string;
  children_desc: string | null;
  photo_url: string | null;
}

// 임원진(grade 0~2)이 승인 시 부여할 수 있는 등급: 교사·학부모만
// 전도사/부장 등 상위 등급 임명은 관리자 또는 부서원 등급관리 페이지에서만 가능
const GRADES = [
  { g: 3, label: "교사", desc: "공지·학생 (출결·달란트·우리반)" },
  { g: 4, label: "학부모", desc: "공지 (읽기·댓글)" },
];

/** 출석부에 이름만 등록돼 있는 교사(계정 미연결). 같은 이름이면 같은 사람일 가능성이 높다. */
interface PlaceholderTeacher {
  id: string;
  name: string;
}

const normName = (v: string | null | undefined) => (v || "").replace(/\s+/g, "");

export default function DeptApprovalPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [pending, setPending] = useState<PendingJoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<PendingJoin | null>(null);
  const [pickedGrade, setPickedGrade] = useState(3);
  const [placeholders, setPlaceholders] = useState<PlaceholderTeacher[]>([]);
  const [linkPlaceholder, setLinkPlaceholder] = useState(true);
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
    // 출석부에 이름만 올라간 교사 목록 — 승인 대상과 동명이면 연결까지 함께 처리한다
    const { data: ts } = await supabase.rpc("list_teachers_status", { p_dept_id: deptId });
    setPlaceholders(
      ((ts || []) as { id: string; name: string; is_placeholder: boolean; is_active: boolean }[])
        .filter((t) => t.is_placeholder && t.is_active)
        .map((t) => ({ id: t.id, name: t.name }))
    );
    setLoading(false);
  }, [deptId]);

  /** 승인 대상과 이름이 같은 미연결 교사들 (2명 이상이면 자동 연결하지 않는다) */
  const matchPlaceholders = useCallback(
    (name: string | null) => placeholders.filter((p) => normName(p.name) === normName(name) && normName(name) !== ""),
    [placeholders]
  );

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      const { data: g } = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      if (g === null || g === undefined || g > 2) {
        showToast("권한 없음 (임원진 grade 0~2만)");
        setTimeout(() => router.replace(`/departments/d/${deptId}`), 1500);
        return;
      }
      setAuthChecked(true);
      await load();
    })();
  }, [router, deptId, load]);

  function openApprove(j: PendingJoin) {
    setApproving(j);
    setPickedGrade(j.requested_role === "학부모" ? 4 : 3);
    setLinkPlaceholder(true);
  }

  async function doApprove() {
    if (!approving) return;
    const matches = matchPlaceholders(approving.user_name);
    // 교사 등급이고 동명 미연결 교사가 딱 1명일 때만 연결 대상이 된다
    const target = pickedGrade <= 3 && matches.length === 1 && linkPlaceholder ? matches[0] : null;

    setProcessing(approving.id);
    const { error } = await supabase.rpc("dept_leader_approve_join", {
      p_join_id: approving.id,
      p_approved: true,
      p_grade: pickedGrade,
    });
    if (error) { setProcessing(null); showToast(error.message); return; }

    // 승인으로 계정 연결 교사 행이 만들어진 뒤에 기존 담임 기록을 그쪽으로 합친다
    let linkError: string | null = null;
    if (target) {
      const { error: mErr } = await supabase.rpc("merge_placeholder_teacher", {
        p_placeholder_id: target.id,
        p_target_user_id: approving.user_id,
        p_reason: "가입 승인 시 동명 담임 기록 연결",
      });
      if (mErr) linkError = mErr.message;
    }
    setProcessing(null);
    showToast(
      linkError
        ? `${approving.user_name} 승인됨 · 담임 기록 연결 실패: ${linkError} (반 관리에서 연결하세요)`
        : target
          ? `${approving.user_name} 승인 + 담임 기록 연결 완료`
          : `${approving.user_name} 승인 완료 (등급 ${pickedGrade})`
    );
    setApproving(null);
    load();
  }

  async function doReject(j: PendingJoin) {
    if (!await confirm(`${j.user_name}님의 가입 신청을 거절하시겠습니까?`)) return;
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
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-soft)" }}>권한 확인 중...</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", paddingBottom: 60, fontFamily: "'Noto Sans KR', sans-serif" }}>
      <div className="app-subpage-header" style={{ background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)" }}>
        <HeaderLogo />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}><Inbox size={20} strokeWidth={1.8} style={{ color: "var(--accent)" }} /> 사역 가입 승인</h1>
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{deptName}</div>
        </div>
        <button className="app-header-back" onClick={() => router.back()} style={btnGhost}>← 뒤로</button>
      </div>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: 16 }}>
        <div style={{ background: "var(--warning-soft)", border: "1px solid #E0C893", borderRadius: 8, padding: 12, fontSize: 12, color: "var(--warning)", marginBottom: 16, lineHeight: 1.6 }}>
          <AlertTriangle size={14} strokeWidth={1.8} style={{ verticalAlign: "-2px", marginRight: 4 }} /> 본 부서로 가입 신청한 사용자만 표시됩니다. 승인 시 등급(권한)을 선택할 수 있고, 추후 <strong>부서원관리</strong>에서 수정 가능합니다.
        </div>

        <div style={{ background: "var(--card)", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--hairline)", background: "var(--warning-soft)" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--warning)" }}>
              가입 신청 대기 ({pending.length}건)
            </div>
          </div>
          {loading ? (
            <LoadingView padding={30} />
          ) : pending.length === 0 ? (
            <EmptyState message="대기 중인 가입 신청이 없습니다" />
          ) : (
            pending.map((j) => (
              <div key={j.id} style={{ padding: "14px 18px", borderBottom: "1px solid var(--bg-soft)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ width: 44, height: 44, borderRadius: 999, overflow: "hidden", background: "var(--bg-soft)", display: "grid", placeItems: "center", color: "var(--ink-soft)", fontSize: 16, fontWeight: 800, flexShrink: 0 }}>
                  {j.photo_url ? (
                    <img src={photoThumb(j.photo_url, 128) ?? undefined} alt="" loading="lazy" decoding="async"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <span>{j.user_name?.slice(0, 1) || "?"}</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                      {j.user_name}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 500 }}>
                      ({j.user_sub_role || "-"})
                    </span>
                    {j.requested_role && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 7px",
                        borderRadius: 6,
                        background: j.requested_role === "학부모" ? "var(--warning-soft)" : "var(--accent-soft)",
                        color: j.requested_role === "학부모" ? "var(--warning)" : "var(--accent-strong)",
                      }}>
                        {j.requested_role === "teacher" ? "교사" : j.requested_role}
                      </span>
                    )}
                    {matchPlaceholders(j.user_name).length > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6,
                        background: "var(--warning-soft)", color: "var(--warning)",
                      }}>
                        출석부에 같은 이름 담임 있음
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-mid)", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Phone size={12} strokeWidth={1.8} /> {j.user_phone || "-"} · 신청 {new Date(j.requested_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                  {j.children_desc && (
                    <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 3 }}>
                      자녀: {j.children_desc}
                    </div>
                  )}
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
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 20, padding: 28, maxWidth: 440, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={20} strokeWidth={1.8} style={{ color: "var(--success)" }} /> 부서 가입 승인</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 16 }}>
              <strong>{approving.user_name}</strong>님을 <strong>{deptName}</strong>에 승인합니다. 등급(권한)을 선택하세요.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {GRADES.map((row) => (
                <button
                  key={row.g}
                  onClick={() => setPickedGrade(row.g)}
                  style={{
                    padding: "12px 14px",
                    background: pickedGrade === row.g ? "linear-gradient(135deg, var(--accent), var(--accent-muted))" : "var(--surface)",
                    color: pickedGrade === row.g ? "#fff" : "var(--ink)",
                    border: pickedGrade === row.g ? "1px solid transparent" : "1px solid var(--hairline)",
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
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: pickedGrade === row.g ? "rgba(255,255,255,0.2)" : "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: pickedGrade === row.g ? "#fff" : "var(--accent)" }}>{row.g}</div>
                  <div>
                    <div>{row.label}</div>
                    <div style={{ fontSize: 10, fontWeight: 500, color: pickedGrade === row.g ? "rgba(255,255,255,0.8)" : "var(--ink-faint)", marginTop: 2 }}>{row.desc}</div>
                  </div>
                </button>
              ))}
            </div>
            {/* 출석부에 이름만 올라간 담임과 같은 사람이면, 승인과 함께 그 기록으로 합친다.
                합치지 않으면 같은 이름의 교사 행이 두 개 남고 담임메뉴가 열리지 않는다. */}
            {pickedGrade <= 3 && matchPlaceholders(approving.user_name).length === 1 && (
              <label style={{
                display: "flex", gap: 9, alignItems: "flex-start", marginTop: 14,
                padding: "11px 13px", borderRadius: 10,
                background: "var(--warning-soft)", border: "1px solid #E0C893",
                cursor: "pointer",
              }}>
                <input
                  type="checkbox"
                  checked={linkPlaceholder}
                  onChange={(e) => setLinkPlaceholder(e.currentTarget.checked)}
                  style={{ marginTop: 2, flexShrink: 0 }}
                />
                <span style={{ fontSize: 12, color: "var(--warning)", lineHeight: 1.6 }}>
                  출석부에 이름만 등록된 담임 <strong>{matchPlaceholders(approving.user_name)[0].name}</strong> 이(가) 있습니다.
                  같은 사람이면 체크를 두세요 — 승인과 함께 그 담임·출석 기록을 이 계정으로 합쳐
                  <strong> 담임메뉴(내 반 출결·달란트)</strong>가 바로 열립니다.
                  해제하면 나중에 <strong>반 관리</strong>에서 직접 연결해야 합니다.
                </span>
              </label>
            )}
            {pickedGrade <= 3 && matchPlaceholders(approving.user_name).length > 1 && (
              <div style={{
                marginTop: 14, padding: "11px 13px", borderRadius: 10,
                background: "var(--warning-soft)", border: "1px solid #E0C893",
                fontSize: 12, color: "var(--warning)", lineHeight: 1.6,
              }}>
                출석부에 같은 이름의 미연결 담임이 {matchPlaceholders(approving.user_name).length}명 있습니다.
                동명이인일 수 있어 자동으로 합치지 않습니다. 승인 후 <strong>반 관리</strong>에서 어느 쪽인지 확인해 연결하세요.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button onClick={() => setApproving(null)} style={{ flex: 1, padding: 12, background: "var(--bg-soft)", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", cursor: "pointer", fontFamily: "inherit" }}>취소</button>
              <button onClick={doApprove} disabled={processing === approving.id} style={{ flex: 1, padding: 12, background: "linear-gradient(135deg, var(--success), var(--success))", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
                {processing === approving.id ? "처리 중..." : `등급 ${pickedGrade} 으로 승인`}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "var(--ink)", color: "#fff", padding: "10px 18px", borderRadius: 12, fontSize: 13, zIndex: 9999 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

const btnGhost: React.CSSProperties = { padding: "10px 16px", background: "var(--bg-soft)", color: "var(--ink-mid)", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnApprove: React.CSSProperties = { padding: "8px 14px", background: "linear-gradient(135deg, var(--success), var(--success))", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnDanger: React.CSSProperties = { padding: "8px 14px", background: "var(--danger-soft)", color: "var(--danger)", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
