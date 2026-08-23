"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import ModalBackdrop from "@/components/ModalBackdrop";
import { UserCog, AlertTriangle, School, Circle, CheckCircle2, ClipboardList, Plus, Pencil, Trash2 } from "lucide-react";

interface ClassRow {
  class_no: string;
  grade_year: number | null;
  label: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  teacher_member_id: string | null;
  is_placeholder: boolean;
  assistant_teacher_id: string | null;
  assistant_teacher_name: string | null;
  assistant_teacher_member_id: string | null;
  assistant_is_placeholder: boolean;
  student_count: number;
  sort_order: number;
  in_registry: boolean;
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

const GRADE_LABEL: Record<number, string> = {
  0: "전도사·교육사",
  1: "부장",
  2: "부부장·총무·서기",
  3: "교사",
  4: "학부모",
};

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
  const [editingRole, setEditingRole] = useState<"정" | "부">("정");
  const [pickedTeacherId, setPickedTeacherId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [mergeTarget, setMergeTarget] = useState<TeacherRow | null>(null);
  const [eligible, setEligible] = useState<EligibleMember[]>([]);
  const [pickedUserId, setPickedUserId] = useState("");
  const [mergeReason, setMergeReason] = useState("");

  // 반 추가/이름변경
  const [classModal, setClassModal] = useState<null | { mode: "add" | "edit"; oldClassNo?: string }>(null);
  const [cfClassNo, setCfClassNo] = useState("");
  const [cfGrade, setCfGrade] = useState("");
  const [cfLabel, setCfLabel] = useState("");

  const [toast, setToast] = useState("");
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    const [c, t, l, d] = await Promise.all([
      supabase.rpc("list_dept_classes_full", { p_dept_id: deptId }),
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
      if (g === null || g === undefined || g > 2) {
        showToast("권한 없음 (임원진만 접근 가능)");
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
    if (!editingClass) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("set_class_homeroom_teacher", {
      p_dept_id: deptId,
      p_class_no: editingClass.class_no,
      p_role: editingRole,
      p_teacher_id: pickedTeacherId || null,
      p_reason: reason.trim() || null,
    });
    setSubmitting(false);
    if (error) { showToast(error.message); return; }
    showToast(`${editingClass.class_no} 담임 ${editingRole} 지정 완료`);
    setEditingClass(null); setPickedTeacherId(""); setReason("");
    load();
  }

  function openAssign(c: ClassRow, role: "정" | "부") {
    setEditingClass(c);
    setEditingRole(role);
    setPickedTeacherId(role === "정" ? (c.teacher_id || "") : (c.assistant_teacher_id || ""));
    setReason("");
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

  function openAddClass() {
    setClassModal({ mode: "add" });
    setCfClassNo(""); setCfGrade(""); setCfLabel("");
  }
  function openEditClass(c: ClassRow) {
    setClassModal({ mode: "edit", oldClassNo: c.class_no });
    setCfClassNo(c.class_no); setCfGrade(c.grade_year != null ? String(c.grade_year) : ""); setCfLabel(c.label || "");
  }

  async function doSaveClass() {
    if (!classModal) return;
    if (!cfClassNo.trim()) { showToast("반 이름을 입력하세요"); return; }
    const gradeVal = cfGrade.trim() === "" ? null : Number(cfGrade);
    if (gradeVal !== null && !Number.isFinite(gradeVal)) { showToast("학년은 숫자로 입력하세요"); return; }
    setSubmitting(true);
    let error;
    if (classModal.mode === "add") {
      ({ error } = await supabase.rpc("add_dept_class", {
        p_dept_id: deptId, p_grade_year: gradeVal, p_class_no: cfClassNo.trim(), p_label: cfLabel.trim() || null,
      }));
    } else {
      ({ error } = await supabase.rpc("rename_dept_class", {
        p_dept_id: deptId, p_old_class_no: classModal.oldClassNo, p_new_class_no: cfClassNo.trim(),
        p_grade_year: gradeVal, p_label: cfLabel.trim() || null,
      }));
    }
    setSubmitting(false);
    if (error) { showToast(error.message); return; }
    showToast(classModal.mode === "add" ? "반을 추가했습니다" : "반 정보를 수정했습니다");
    setClassModal(null);
    load();
  }

  async function doDeleteClass(c: ClassRow) {
    if (!window.confirm(`"${c.class_no}" 반을 삭제할까요?`)) return;
    const { error } = await supabase.rpc("delete_dept_class", { p_dept_id: deptId, p_class_no: c.class_no });
    if (error) { showToast(error.message); return; }
    showToast(`${c.class_no} 반 삭제 완료`);
    load();
  }

  if (!authChecked) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-soft)" }}>권한 확인 중...</div>;
  }

  const placeholders = teachers.filter((t) => t.is_placeholder && t.is_active);
  const linkedTeachers = teachers.filter((t) => !t.is_placeholder && t.is_active);
  const gradeLabel = (grade: number) => GRADE_LABEL[grade] || `${grade}등급`;
  const normalizeName = (name: string) => name.replace(/\s+/g, "").trim();
  const mergeTargetName = normalizeName(mergeTarget?.name || "");
  const recommendedEligible = mergeTargetName
    ? eligible.filter((u) => normalizeName(u.name) === mergeTargetName && !u.already_linked)
    : [];
  const otherEligible = eligible.filter((u) => !recommendedEligible.some((r) => r.user_id === u.user_id));

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", paddingBottom: 60, fontFamily: "'Noto Sans KR', sans-serif" }}>
      <div className="app-subpage-header" style={{ background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)" }}>
        <HeaderLogo />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}><UserCog size={20} strokeWidth={1.8} /> 반 관리</h1>
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{deptName}</div>
        </div>
        <button className="app-header-back" onClick={() => router.back()} style={btnGhost}>← 뒤로</button>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px" }}>
        <div style={{ background: "var(--warning-soft)", border: "1px solid #E0C893", borderRadius: 8, padding: 12, fontSize: 12, color: "var(--warning)", marginBottom: 16, lineHeight: 1.6 }}>
          <AlertTriangle size={14} strokeWidth={1.8} style={{ verticalAlign: "-2px", marginRight: 4 }} /> 모든 변경은 <strong>이력으로 기록</strong>됩니다. 매년 학기 초 또는 특별 사유 발생 시 변경하세요.
        </div>

        {/* 반별 담임 */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
            <div style={{ ...sectionTitle, marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}><School size={15} strokeWidth={1.8} /> 반별 담임 ({classes.length}반)</div>
            <button onClick={openAddClass} style={{ ...btnPrimary, padding: "8px 14px", display: "inline-flex", alignItems: "center", gap: 5 }}><Plus size={15} strokeWidth={2.2} /> 반 추가</button>
          </div>
          {loading ? <div style={{ padding: 20, textAlign: "center", color: "var(--ink-faint)" }}>로딩...</div> : classes.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>아직 반이 없습니다. <strong>반 추가</strong>로 만들어 주세요.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
              {classes.map((c) => (
                <div key={c.class_no} style={{ padding: 12, background: "var(--surface)", borderRadius: 8, border: "1px solid var(--hairline)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>
                      {c.class_no} <span style={{ color: "var(--ink-faint)", fontWeight: 400, fontSize: 12 }}>({c.student_count}명)</span>
                    </div>
                    <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                      <button onClick={() => openEditClass(c)} title="반 이름·학년 수정" style={iconBtn}><Pencil size={13} strokeWidth={2} /></button>
                      <button onClick={() => doDeleteClass(c)} title="반 삭제" style={{ ...iconBtn, color: "var(--danger)" }}><Trash2 size={13} strokeWidth={2} /></button>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-mid)", marginTop: 10, marginBottom: 6 }}>담임 지정</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                    <button type="button" onClick={() => openAssign(c, "정")} style={homeroomSlotStyle(Boolean(c.teacher_id))}>
                      <span style={{ fontSize: 14, fontWeight: 900, color: "var(--accent)" }}>정</span>
                      <strong style={{ fontSize: 13 }}>{c.teacher_name || "+ 지정"}</strong>
                      {c.is_placeholder && <span style={{ color: "var(--warning)", fontSize: 9 }}>계정 미연결</span>}
                    </button>
                    <button type="button" onClick={() => openAssign(c, "부")} style={homeroomSlotStyle(Boolean(c.assistant_teacher_id))}>
                      <span style={{ fontSize: 14, fontWeight: 900, color: "var(--success)" }}>부</span>
                      <strong style={{ fontSize: 13 }}>{c.assistant_teacher_name || "+ 지정"}</strong>
                      {c.assistant_is_placeholder && <span style={{ color: "var(--warning)", fontSize: 9 }}>계정 미연결</span>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 이름만 등록된 담임 계정 연결 */}
        {placeholders.length > 0 && (
          <div style={card}>
            <div style={{ ...sectionTitle, display: "flex", alignItems: "center", gap: 6 }}><Circle size={12} strokeWidth={1.8} /> 계정 연결이 필요한 담임 ({placeholders.length})</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 10, lineHeight: 1.6 }}>
              이름만 먼저 등록된 담임입니다. 선생님이 회원가입과 부서 가입을 마쳤다면 아래 이름을 눌러 실제 계정과 연결하세요.
              연결하면 해당 반 학생들이 선생님의 <strong>내 반</strong>에 바로 보입니다.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {placeholders.map((t) => (
                <button key={t.id} onClick={() => openMergeModal(t)} style={{ ...chipGhost, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Circle size={10} strokeWidth={1.8} /> {t.name} 선생님 계정 연결
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 계정 연결된 담임 */}
        <div style={card}>
          <div style={{ ...sectionTitle, display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={14} strokeWidth={1.8} /> 계정 연결된 담임 ({linkedTeachers.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {linkedTeachers.map((t) => (
              <span key={t.id} style={chipGreen}>{t.name}</span>
            ))}
            {linkedTeachers.length === 0 && <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>아직 계정과 연결된 담임이 없습니다</span>}
          </div>
        </div>

        {/* 이력 */}
        <div style={card}>
          <div style={{ ...sectionTitle, display: "flex", alignItems: "center", gap: 6 }}><ClipboardList size={15} strokeWidth={1.8} /> 변경 이력 (최근 20)</div>
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
                    <> · <strong>{l.new_teacher_name}</strong> 선생님 계정 연결</>
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
              {editingClass.class_no} 반 담임 지정 · {editingRole}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 8 }}>
              현재 {editingRole}: <strong>{editingRole === "정" ? (editingClass.teacher_name || "없음") : (editingClass.assistant_teacher_name || "없음")}</strong> · 학생 {editingClass.student_count}명
            </div>
            <select value={pickedTeacherId} onChange={(e) => setPickedTeacherId(e.target.value)} style={inp}>
              <option value="">— 지정하지 않음 —</option>
              {teachers.filter((t) => t.is_active).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.is_placeholder ? " (계정 미연결)" : " (계정 연결됨)"}
                </option>
              ))}
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유 (예: 2026 신학기 배정)" style={{ ...inp, marginTop: 8 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setEditingClass(null)} style={btnGhost}>취소</button>
              <button onClick={doAssign} disabled={submitting} style={btnPrimary}>
                {submitting ? "처리 중..." : pickedTeacherId ? "지정" : "지정 해제"}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* 담임 계정 연결 모달 */}
      {mergeTarget && (
        <ModalBackdrop onClose={() => setMergeTarget(null)}>
          <div style={{ ...modalCard, maxWidth: 460 }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <Circle size={12} strokeWidth={1.8} /> {mergeTarget.name} 선생님 계정 연결
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 12, lineHeight: 1.6 }}>
              이름만 등록된 담임을 실제 로그인 계정과 연결합니다. 연결 후에는 이 반 학생들이 해당 선생님의 <strong>내 반</strong> 화면에 자동으로 표시됩니다.
            </div>
            {recommendedEligible.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <div style={fieldLabel}>이름이 같은 가입 계정</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                  {recommendedEligible.map((u) => (
                    <button
                      key={u.user_id}
                      type="button"
                      onClick={() => setPickedUserId(u.user_id)}
                      style={accountChoiceStyle(pickedUserId === u.user_id, false)}
                    >
                      <span style={{ fontWeight: 800 }}>{u.name}</span>
                      <span style={{ fontSize: 11, color: pickedUserId === u.user_id ? "var(--accent-strong)" : "var(--ink-soft)" }}>{gradeLabel(u.grade)}</span>
                      <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800 }}>{pickedUserId === u.user_id ? "선택됨" : "선택"}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ ...hintBox, marginBottom: 12 }}>
                이름이 같은 가입 계정을 찾지 못했습니다. 먼저 사역 가입 승인이 되었는지 확인하거나, 아래에서 직접 계정을 선택하세요.
              </div>
            )}

            <details open={recommendedEligible.length === 0} style={{ marginBottom: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 800, color: "var(--ink-mid)", marginBottom: 8 }}>
                같은 선생님인데 이름이 다르게 등록된 경우
              </summary>
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.5, margin: "0 0 8px 2px" }}>
                예: 담임 명단은 “김철수”, 가입 계정은 “김철수 집사”처럼 보일 때만 아래에서 직접 선택하세요.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 190, overflowY: "auto", paddingRight: 2 }}>
                {otherEligible.map((u) => (
                  <button
                    key={u.user_id}
                    type="button"
                    disabled={u.already_linked}
                    onClick={() => setPickedUserId(u.user_id)}
                    style={accountChoiceStyle(pickedUserId === u.user_id, u.already_linked)}
                  >
                    <span style={{ fontWeight: 800 }}>{u.name}</span>
                    <span style={{ fontSize: 11, color: pickedUserId === u.user_id ? "var(--accent-strong)" : "var(--ink-soft)" }}>{gradeLabel(u.grade)}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800 }}>
                      {u.already_linked ? "이미 연결됨" : pickedUserId === u.user_id ? "선택됨" : "선택"}
                    </span>
                  </button>
                ))}
                {otherEligible.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--ink-faint)", padding: "8px 2px" }}>직접 선택할 수 있는 선생님 계정이 없습니다.</div>
                )}
              </div>
            </details>
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

      {/* 반 추가 / 수정 모달 */}
      {classModal && (
        <ModalBackdrop onClose={() => setClassModal(null)}>
          <div style={modalCard}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              {classModal.mode === "add" ? <><Plus size={16} strokeWidth={2} /> 반 추가</> : <><Pencil size={15} strokeWidth={2} /> 반 수정</>}
            </div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-mid)" }}>반 이름 *</label>
            <input value={cfClassNo} onChange={(e) => setCfClassNo(e.target.value)} placeholder="예: 1-1, a반, 새싹반" maxLength={20} style={{ ...inp, marginTop: 5 }} />
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", display: "block", marginTop: 10 }}>학년 (선택 · 숫자)</label>
            <input value={cfGrade} onChange={(e) => setCfGrade(e.target.value)} placeholder="예: 4 (영아·유아 등은 비워두세요)" inputMode="numeric" maxLength={2} style={{ ...inp, marginTop: 5 }} />
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", display: "block", marginTop: 10 }}>설명 (선택)</label>
            <input value={cfLabel} onChange={(e) => setCfLabel(e.target.value)} placeholder="메모" maxLength={40} style={{ ...inp, marginTop: 5 }} />
            {classModal.mode === "edit" && (
              <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 8, lineHeight: 1.5 }}>반 이름을 바꾸면 이 반 학생들의 반 정보도 함께 변경됩니다.</div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setClassModal(null)} style={btnGhost}>취소</button>
              <button onClick={doSaveClass} disabled={submitting || !cfClassNo.trim()} style={btnPrimary}>{submitting ? "처리 중..." : "저장"}</button>
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

const card: React.CSSProperties = { background: "var(--card)", borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" };
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: "var(--ink)", marginBottom: 12 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--hairline-strong)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "var(--card)" };
const btnPrimary: React.CSSProperties = { padding: "10px 18px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnGhost: React.CSSProperties = { padding: "10px 16px", background: "var(--bg-soft)", color: "var(--ink-mid)", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const iconBtn: React.CSSProperties = { width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--bg-soft)", color: "var(--ink-soft)", border: "none", borderRadius: 6, cursor: "pointer" };
const chipGhost: React.CSSProperties = { padding: "6px 12px", background: "var(--warning-soft)", color: "var(--warning)", border: "1px solid #E0C893", borderRadius: 999, fontSize: 11, cursor: "pointer", fontFamily: "inherit" };
const chipGreen: React.CSSProperties = { padding: "6px 12px", background: "var(--success-soft)", color: "var(--success)", border: "1px solid var(--success-soft)", borderRadius: 999, fontSize: 11, fontFamily: "inherit" };
const modalCard: React.CSSProperties = { background: "var(--card)", borderRadius: 14, padding: 20, maxWidth: 420, width: "calc(100vw - 32px)", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" };
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: "var(--ink-mid)" };
const hintBox: React.CSSProperties = {
  padding: 10,
  borderRadius: 8,
  background: "var(--bg-soft)",
  color: "var(--ink-soft)",
  fontSize: 12,
  lineHeight: 1.5,
};
const accountChoiceStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({
  minHeight: 42,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  borderRadius: 9,
  border: `1.5px solid ${active ? "var(--accent)" : "var(--hairline)"}`,
  background: active ? "var(--accent-soft)" : "var(--card)",
  color: disabled ? "var(--ink-faint)" : "var(--ink)",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.55 : 1,
  fontFamily: "inherit",
  textAlign: "left",
});
const homeroomSlotStyle = (assigned: boolean): React.CSSProperties => ({
  minHeight: 70,
  padding: "9px 7px",
  borderRadius: 9,
  border: `1.5px solid ${assigned ? "var(--accent)" : "var(--hairline-strong)"}`,
  background: assigned ? "var(--accent-soft)" : "var(--card)",
  color: assigned ? "var(--ink)" : "var(--ink-soft)",
  cursor: "pointer",
  fontFamily: "inherit",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  textAlign: "center",
});
