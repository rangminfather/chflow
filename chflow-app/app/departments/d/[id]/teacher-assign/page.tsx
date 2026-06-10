"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import ModalBackdrop from "@/components/ModalBackdrop";

interface ClassRow {
  class_no: string;
  grade_year: number | null;
  teacher_id: string | null;
  teacher_name: string | null;
  teacher_member_id: string | null;
  is_placeholder: boolean;
  student_count: number;
}

interface TeacherRow {
  id: string;
  name: string;
  member_id: string | null;
  user_id: string | null;
  is_placeholder: boolean;
  is_active: boolean;
}

interface EligibleMember {
  user_id: string;
  member_id: string;
  name: string;
  grade: number;
  already_linked: boolean;
}

interface LogRow {
  id: string;
  action_type: string;
  class_no: string | null;
  old_teacher_name: string | null;
  new_teacher_name: string | null;
  reason: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

export default function TeacherAssignPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingClass, setEditingClass] = useState<ClassRow | null>(null);
  const [pickedTeacherId, setPickedTeacherId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [mergeTarget, setMergeTarget] = useState<TeacherRow | null>(null);
  const [eligible, setEligible] = useState<EligibleMember[]>([]);
  const [pickedUserId, setPickedUserId] = useState("");
  const [mergeReason, setMergeReason] = useState("");

  const [toast, setToast] = useState("");
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    const [c, t, l, d] = await Promise.all([
      supabase.rpc("list_classes_with_teachers", { p_dept_id: deptId }),
      supabase.rpc("list_teachers_status", { p_dept_id: deptId }),
      supabase.from("teacher_assignment_log").select("id, action_type, class_no, old_teacher_name, new_teacher_name, reason, changed_by_name, changed_at").eq("department_id", deptId).order("changed_at", { ascending: false }).limit(20),
      supabase.from("departments").select("name").eq("id", deptId).maybeSingle(),
    ]);
    if (c.data) setClasses(c.data);
    if (t.data) setTeachers(t.data);
    if (l.data) setLogs(l.data);
    if (d.data) setDeptName(d.data.name);
    setLoading(false);
  }, [deptId]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      const { data: g } = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      if (g === null || g === undefined || g > 1) {
        showToast("권한 없음 (전도사·부장만 접근 가능)");
        setTimeout(() => router.replace(`/departments/d/${deptId}`), 1500);
        return;
      }
      setAuthChecked(true);
      await load();
    })();
  }, [router, deptId, load]);

  async function openMergeModal(t: TeacherRow) {
    setMergeTarget(t);
    setPickedUserId("");
    setMergeReason("");
    const { data } = await supabase.rpc("list_dept_eligible_for_teacher", { p_dept_id: deptId });
    if (data) setEligible(data);
  }

  async function doAssign() {
    if (!editingClass || !pickedTeacherId) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("bulk_assign_class_teacher", {
      p_dept_id: deptId,
      p_class_no: editingClass.class_no,
      p_new_teacher_id: pickedTeacherId,
      p_reason: reason.trim() || null,
    });
    setSubmitting(false);
    if (error) { showToast(error.message); return; }
    showToast(`${editingClass.class_no} 담임 변경 완료`);
    setEditingClass(null); setPickedTeacherId(""); setReason("");
    load();
  }

  async function doMerge() {
    if (!mergeTarget || !pickedUserId) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("merge_placeholder_teacher", {
      p_placeholder_id: mergeTarget.id,
      p_target_user_id: pickedUserId,
      p_reason: mergeReason.trim() || null,
    });
    setSubmitting(false);
    if (error) { showToast(error.message); return; }
    showToast(`${mergeTarget.name} ↔ 회원 연결 완료`);
    setMergeTarget(null); setPickedUserId(""); setMergeReason("");
    load();
  }

  if (!authChecked) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-soft)" }}>권한 확인 중...</div>;
  }

  const placeholders = teachers.filter((t) => t.is_placeholder && t.is_active);
  const linkedTeachers = teachers.filter((t) => !t.is_placeholder && t.is_active);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", paddingBottom: 60, fontFamily: "'Noto Sans KR', sans-serif" }}>
      <HeaderLogo />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={btnGhost}>←</button>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: 0 }}>👩‍🏫 담임선생님 지정</h1>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{deptName}</div>
          </div>
        </div>

        <div style={{ background: "var(--warning-soft)", border: "1px solid #E0C893", borderRadius: 8, padding: 12, fontSize: 12, color: "var(--warning)", marginBottom: 16, lineHeight: 1.6 }}>
          ⚠️ 모든 변경은 <strong>이력으로 기록</strong>됩니다. 매년 학기 초 또는 특별 사유 발생 시 변경하세요.
        </div>

        {/* 반별 담임 */}
        <div style={card}>
          <div style={sectionTitle}>📚 반별 담임 ({classes.length}반)</div>
          {loading ? <div style={{ padding: 20, textAlign: "center", color: "var(--ink-faint)" }}>로딩...</div> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
              {classes.map((c) => (
                <div key={c.class_no} style={{ padding: 12, background: "var(--surface)", borderRadius: 8, border: "1px solid var(--hairline)" }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", marginBottom: 4 }}>
                    {c.class_no} <span style={{ color: "var(--ink-faint)", fontWeight: 400, fontSize: 12 }}>({c.student_count}명)</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-mid)", marginBottom: 8 }}>
                    담임: <strong>{c.teacher_name || "(없음)"}</strong>
                    {c.is_placeholder && <span style={{ color: "var(--warning)", marginLeft: 4, fontSize: 10 }}>⚪ placeholder</span>}
                    {!c.is_placeholder && c.teacher_id && <span style={{ color: "var(--success)", marginLeft: 4, fontSize: 10 }}>✅ 가입회원</span>}
                  </div>
                  <button onClick={() => { setEditingClass(c); setPickedTeacherId(c.teacher_id || ""); }} style={btnSm}>담임 변경</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* placeholder 회원 연결 */}
        {placeholders.length > 0 && (
          <div style={card}>
            <div style={sectionTitle}>⚪ placeholder ↔ 가입 회원 연결 ({placeholders.length})</div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 8 }}>
              담임 선생님이 회원가입 + 부서원이 되었으면 연결 → 학생들 자동 인계
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {placeholders.map((t) => (
                <button key={t.id} onClick={() => openMergeModal(t)} style={chipGhost}>
                  ⚪ {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 가입회원 담임 */}
        <div style={card}>
          <div style={sectionTitle}>✅ 가입회원 담임 ({linkedTeachers.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {linkedTeachers.map((t) => (
              <span key={t.id} style={chipGreen}>{t.name}</span>
            ))}
            {linkedTeachers.length === 0 && <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>아직 가입회원으로 매칭된 담임 없음</span>}
          </div>
        </div>

        {/* 이력 */}
        <div style={card}>
          <div style={sectionTitle}>📋 변경 이력 (최근 20)</div>
          {logs.length === 0 ? <div style={{ fontSize: 12, color: "var(--ink-faint)", padding: 8 }}>이력 없음</div> : (
            <div>
              {logs.map((l) => (
                <div key={l.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--bg-soft)", fontSize: 12, color: "var(--ink-mid)" }}>
                  <span style={{ color: "var(--ink-faint)" }}>{new Date(l.changed_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</span>
                  {" · "}
                  <strong>{l.changed_by_name}</strong>
                  {l.action_type === "bulk_assign" && (
                    <> · {l.class_no} 반 담임 <s>{l.old_teacher_name || "없음"}</s> → <strong>{l.new_teacher_name}</strong></>
                  )}
                  {l.action_type === "merge_placeholder" && (
                    <> · placeholder <strong>{l.new_teacher_name}</strong> ↔ 회원 연결</>
                  )}
                  {l.reason && <span style={{ color: "var(--ink-faint)" }}> ({l.reason})</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 담임 변경 모달 */}
      {editingClass && (
        <ModalBackdrop onClose={() => setEditingClass(null)}>
          <div style={modalCard}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>
              {editingClass.class_no} 반 담임 변경
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 8 }}>
              현재 담임: <strong>{editingClass.teacher_name || "없음"}</strong> · 학생 {editingClass.student_count}명
            </div>
            <select value={pickedTeacherId} onChange={(e) => setPickedTeacherId(e.target.value)} style={inp}>
              <option value="">— 새 담임 선택 —</option>
              {teachers.filter((t) => t.is_active).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.is_placeholder ? " (placeholder)" : " ✅"}
                </option>
              ))}
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유 (예: 2026 신학기 배정)" style={{ ...inp, marginTop: 8 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setEditingClass(null)} style={btnGhost}>취소</button>
              <button onClick={doAssign} disabled={!pickedTeacherId || submitting} style={btnPrimary}>
                {submitting ? "처리 중..." : "변경"}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* placeholder 연결 모달 */}
      {mergeTarget && (
        <ModalBackdrop onClose={() => setMergeTarget(null)}>
          <div style={modalCard}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>
              ⚪ {mergeTarget.name} ↔ 가입회원 연결
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 12, lineHeight: 1.5 }}>
              연결하면 placeholder 가 가입회원 정보로 갱신되고, 이 담임이 맡고 있는 학생들의 담임 정보가 자동 인계됩니다 (학생 정보 변경 X).
            </div>
            <select value={pickedUserId} onChange={(e) => setPickedUserId(e.target.value)} style={inp}>
              <option value="">— 부서원 (교사) 선택 —</option>
              {eligible.map((u) => (
                <option key={u.user_id} value={u.user_id} disabled={u.already_linked}>
                  {u.name} (grade {u.grade}){u.already_linked ? " — 이미 연결됨" : ""}
                </option>
              ))}
            </select>
            <input value={mergeReason} onChange={(e) => setMergeReason(e.target.value)} placeholder="사유 (선택)" style={{ ...inp, marginTop: 8 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setMergeTarget(null)} style={btnGhost}>취소</button>
              <button onClick={doMerge} disabled={!pickedUserId || submitting} style={btnPrimary}>
                {submitting ? "처리 중..." : "연결"}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "var(--ink)", color: "#fff", padding: "10px 18px", borderRadius: 12, fontSize: 13, zIndex: 9999 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" };
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: "var(--ink)", marginBottom: 12 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--hairline-strong)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff" };
const btnPrimary: React.CSSProperties = { padding: "10px 18px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnGhost: React.CSSProperties = { padding: "10px 16px", background: "var(--bg-soft)", color: "var(--ink-mid)", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnSm: React.CSSProperties = { padding: "6px 10px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const chipGhost: React.CSSProperties = { padding: "6px 12px", background: "var(--warning-soft)", color: "var(--warning)", border: "1px solid #E0C893", borderRadius: 999, fontSize: 11, cursor: "pointer", fontFamily: "inherit" };
const chipGreen: React.CSSProperties = { padding: "6px 12px", background: "var(--success-soft)", color: "var(--success)", border: "1px solid var(--success-soft)", borderRadius: 999, fontSize: 11, fontFamily: "inherit" };
const modalCard: React.CSSProperties = { background: "#fff", borderRadius: 14, padding: 20, maxWidth: 420, width: "calc(100vw - 32px)", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" };
