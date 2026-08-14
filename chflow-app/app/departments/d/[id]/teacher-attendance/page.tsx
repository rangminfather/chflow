"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ConfirmDialog";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView } from "@/components/StatusViews";
import { UserCheck, Trash2, GitMerge, RotateCcw, ChevronDown, ChevronUp, Pencil } from "lucide-react";

interface Teacher {
  id: string;
  name: string;
  teacher_role: string | null;
  order_no: number;
  is_active: boolean;
  user_id: string | null;
  member_id: string | null;
}

interface AttendRow {
  teacher_id: string;
  teacher_name: string;
  teacher_role: string | null;
  order_no: number;
  attend_date: string | null;
  is_present: boolean;
  note: string | null;
}

// 수동 등록(placeholder) 교사 판별 — 성도·계정 어느 쪽과도 연결되지 않은 행.
// 연결 교사(member_id/user_id 보유)의 이름·직책 원본은 members + department_members 이고
// 임명·계정연결 RPC가 edu_teachers 를 덮어쓰므로 이 화면에서 수정하지 않는다.
function isManualTeacher(t: Teacher) {
  return !t.user_id && !t.member_id;
}

export default function TeacherAttendancePage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const params = useParams();
  const deptId = params.id as string;

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [attData, setAttData] = useState<AttendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState<string>("");
  const [showDeleted, setShowDeleted] = useState(false);

  const loadTeachers = useCallback(async () => {
    // 병합 대상 판별에 user_id/member_id가 필요해서 RPC 대신 직접 조회 (RLS 동일)
    const { data } = await supabase
      .from("edu_teachers")
      .select("id, name, teacher_role, order_no, is_active, user_id, member_id")
      .eq("department_id", deptId)
      .order("order_no")
      .order("name");
    setTeachers((data as Teacher[]) || []);
  }, [deptId]);

  const loadAttendance = useCallback(async () => {
    const { data } = await supabase.rpc("edu_get_teacher_attendance", {
      p_dept_id: deptId, p_year: year, p_month: month,
    });
    setAttData(data || []);
  }, [deptId, month, year]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadTeachers(), loadAttendance()]);
    setLoading(false);
  }, [loadAttendance, loadTeachers]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await loadAll();
    })();
  }, [loadAll, router]);

  useEffect(() => {
    if (authChecked) loadAttendance();
  }, [authChecked, loadAttendance]);

  // 해당 월의 일요일 날짜 배열
  const sundays = useMemo(() => getSundaysInMonth(year, month), [year, month]);

  const activeTeachers = useMemo(() => teachers.filter((t) => t.is_active), [teachers]);
  const deletedTeachers = useMemo(() => teachers.filter((t) => !t.is_active), [teachers]);

  // 임시 등록(미연결) 교사 → 같은 이름의 계정 연결된 교사 (병합 대상)
  const mergeTargetOf = useMemo(() => {
    const map: Record<string, Teacher> = {};
    activeTeachers.forEach((t) => {
      if (t.user_id || t.member_id) return;
      const target = activeTeachers.find(
        (o) => o.id !== t.id && o.name === t.name && (o.user_id || o.member_id),
      );
      if (target) map[t.id] = target;
    });
    return map;
  }, [activeTeachers]);

  // teacher_id → {date → is_present} 맵
  const attMap = useMemo(() => {
    const m: Record<string, Record<string, boolean>> = {};
    attData.forEach((row) => {
      if (!row.attend_date) return;
      if (!m[row.teacher_id]) m[row.teacher_id] = {};
      m[row.teacher_id][row.attend_date] = row.is_present;
    });
    return m;
  }, [attData]);

  const toggleAttend = async (teacherId: string, date: string, current: boolean) => {
    const key = `${teacherId}-${date}`;
    setSaving(key);
    await supabase.rpc("edu_set_teacher_attendance", {
      p_teacher_id: teacherId,
      p_dept_id:    deptId,
      p_date:       date,
      p_present:    !current,
    });
    await loadAttendance();
    setSaving("");
  };

  const openAddForm = () => {
    setEditing(null);
    setNewName(""); setNewRole("");
    setShowAddForm(true);
  };

  // 수동 등록(계정 미연결) 교사만 수정 가능 — 연결 교사는 부서원관리가 원본
  const openEditForm = (t: Teacher) => {
    if (!isManualTeacher(t)) {
      showToast("연결된 교사의 정보는 부서원관리에서 변경할 수 있습니다");
      return;
    }
    setEditing(t);
    setNewName(t.name); setNewRole(t.teacher_role || "");
    setShowAddForm(true);
    // 폼은 표 위쪽에 열리므로 명단이 길면 화면 밖에 있다 — 폼까지 올려준다
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeForm = () => {
    setShowAddForm(false);
    setEditing(null);
    setNewName(""); setNewRole("");
  };

  const saveTeacher = async () => {
    if (!newName.trim()) return;
    // 수정은 기존 행 id를 그대로 넘긴다 (삭제 후 재등록 금지 — 출석 이력 유지)
    const { error } = await supabase.rpc("edu_save_teacher", {
      p_id:       editing ? editing.id : null,
      p_dept_id:  deptId,
      p_name:     newName.trim(),
      p_role:     newRole.trim() || null,
      p_order_no: editing ? editing.order_no : teachers.length,
    });
    if (error) {
      showToast((editing ? "수정 실패: " : "추가 실패: ") + error.message);
      return;
    }
    showToast(editing ? "교사 정보가 수정되었습니다" : "교사가 추가되었습니다");
    closeForm();
    await loadAll();
  };

  const deleteTeacher = async (id: string, name: string) => {
    if (!await confirm(`"${name}" 교사를 삭제하시겠습니까?\n출석 기록은 보존되며, 아래 "삭제된 교사"에서 복구할 수 있습니다.`)) return;
    const { error } = await supabase.rpc("edu_delete_teacher", { p_id: id });
    if (error) { showToast("삭제 실패: " + error.message); return; }
    await loadAll();
    showToast("삭제되었습니다 (삭제된 교사에서 복구 가능)");
  };

  const restoreTeacher = async (id: string, name: string) => {
    const { error } = await supabase.rpc("edu_restore_teacher", { p_id: id });
    if (error) { showToast("복구 실패: " + error.message); return; }
    await loadAll();
    showToast(`"${name}" 교사가 복구되었습니다`);
  };

  const purgeTeacher = async (id: string, name: string) => {
    if (!await confirm(
      `"${name}" 교사를 영구 삭제하시겠습니까?\n출석 기록도 함께 삭제되며 복구할 수 없습니다.`,
      { okText: "영구 삭제" },
    )) return;
    const { error } = await supabase.rpc("edu_purge_teacher", { p_id: id });
    if (error) { showToast("영구 삭제 실패: " + error.message); return; }
    await loadAll();
    showToast("영구 삭제되었습니다");
  };

  const mergeTeacher = async (source: Teacher, target: Teacher) => {
    if (!await confirm(
      `임시 등록 "${source.name}"의 출석 기록을 계정이 연결된 "${target.name}" 교사에게 합치고 임시 행을 삭제합니다.\n같은 주에 양쪽 다 기록이 있으면 연결된 교사의 기록을 유지합니다.`,
      { okText: "병합" },
    )) return;
    const { data, error } = await supabase.rpc("edu_merge_duplicate_teacher", {
      p_source_id: source.id,
      p_target_id: target.id,
    });
    if (error) { showToast("병합 실패: " + error.message); return; }
    await loadAll();
    showToast(`병합 완료 — 출석 기록 ${data ?? 0}건 이관`);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const monthLabel = `${year}년 ${month}월`;

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>

      {/* Header */}
      <div className="app-subpage-header" style={headerStyle}>
        <HeaderLogo />
        <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}><UserCheck size={18} strokeWidth={1.8} /> 선생님 등록 / 출석</div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        {/* 연/월 선택 */}
        <div style={{ ...cardStyle, marginBottom: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setYear(year - 1)} title="이전 연도" style={navBtnStyle}>«</button>
          <button onClick={() => prevMonth(year, month, setYear, setMonth)} title="이전 달" style={navBtnStyle}>◀</button>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", minWidth: 110, textAlign: "center" }}>
            {monthLabel}
          </div>
          <button onClick={() => nextMonth(year, month, setYear, setMonth)} title="다음 달" style={navBtnStyle}>▶</button>
          <button onClick={() => setYear(year + 1)} title="다음 연도" style={navBtnStyle}>»</button>
          <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>
            일요일: {sundays.length}주
          </div>
          <button onClick={() => (showAddForm && !editing ? closeForm() : openAddForm())} style={{ ...addBtnStyle, marginLeft: "auto" }}>+ 교사 추가</button>
        </div>

        {/* 교사 추가 / 수정 폼 */}
        {showAddForm && (
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div style={sectionLabel}>{editing ? `교사 수정 — ${editing.name}` : "교사 추가"}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="이름"
                style={{ ...inputStyle, width: 140 }}
              />
              <input
                type="text"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                placeholder="직책 (부장, 교사 등)"
                style={{ ...inputStyle, width: 180 }}
              />
              <button onClick={saveTeacher} style={saveBtnStyle}>{editing ? "저장" : "추가"}</button>
              <button onClick={closeForm} style={cancelBtnStyle}>취소</button>
            </div>
            {editing && (
              <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 10, lineHeight: 1.6 }}>
                같은 교사 정보를 그대로 수정합니다. 출석 기록은 그대로 유지됩니다.
              </div>
            )}
          </div>
        )}

        {/* 출석 그리드 */}
        <div style={{ ...cardStyle, overflowX: "auto" }}>
          {loading ? (
            <LoadingView padding={40} label="불러오는 중..." />
          ) : activeTeachers.length === 0 ? (
            <div style={{ color: "var(--ink-faint)", textAlign: "center", padding: 40 }}>
              교사가 없습니다. 위의 &quot;+ 교사 추가&quot;를 눌러 추가하세요.
            </div>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 400 }}>
              <thead>
                <tr>
                  <th style={thStyle("left", 120)}>이름 / 직책</th>
                  {sundays.map((d) => (
                    <th key={d} style={thStyle("center", 70)}>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{formatMD(d)}</div>
                      <div style={{ fontSize: 9, color: "var(--ink-faint)", fontWeight: 400 }}>{weekNo(d, sundays)}주</div>
                    </th>
                  ))}
                  <th style={thStyle("center", 60)}>출석수</th>
                  <th style={thStyle("center", 76)}>관리</th>
                </tr>
              </thead>
              <tbody>
                {activeTeachers.map((t) => {
                  const tMap = attMap[t.id] || {};
                  const presentCount = sundays.filter((d) => tMap[d]).length;
                  return (
                    <tr key={t.id} style={{ borderBottom: "1px solid var(--bg-soft)" }}>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{t.name}</div>
                        {t.teacher_role && (
                          <div style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>{t.teacher_role}</div>
                        )}
                      </td>
                      {sundays.map((d) => {
                        const present = !!tMap[d];
                        const key = `${t.id}-${d}`;
                        return (
                          <td key={d} style={{ textAlign: "center", padding: "6px 4px" }}>
                            <button
                              onClick={() => toggleAttend(t.id, d, present)}
                              disabled={saving === key}
                              style={{
                                width: 32, height: 32,
                                borderRadius: "50%",
                                border: "none",
                                background: saving === key ? "var(--hairline)" : present ? "var(--accent)" : "var(--bg-soft)",
                                color: present ? "#fff" : "var(--hairline-strong)",
                                fontSize: 16, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                margin: "0 auto",
                                transition: "all 0.15s",
                              }}
                            >
                              {saving === key ? "·" : present ? "✓" : "·"}
                            </button>
                          </td>
                        );
                      })}
                      <td style={{ textAlign: "center", padding: "6px 4px" }}>
                        <span style={{
                          fontSize: 13, fontWeight: 800,
                          color: presentCount === sundays.length ? "var(--success)" : presentCount > 0 ? "var(--accent)" : "var(--ink-faint)",
                        }}>
                          {presentCount}/{sundays.length}
                        </span>
                      </td>
                      <td style={{ textAlign: "center", padding: "6px 4px", whiteSpace: "nowrap" }}>
                        {mergeTargetOf[t.id] && (
                          <button
                            onClick={() => mergeTeacher(t, mergeTargetOf[t.id])}
                            title={`계정 연결된 "${mergeTargetOf[t.id].name}" 교사와 병합`}
                            style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", display: "inline-flex", alignItems: "center", marginRight: 4 }}
                          ><GitMerge size={15} strokeWidth={1.8} /></button>
                        )}
                        <button
                          onClick={() => openEditForm(t)}
                          title={isManualTeacher(t)
                            ? "이름·직책 수정"
                            : "연결된 교사의 정보는 부서원관리에서 변경할 수 있습니다"}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: isManualTeacher(t) ? "var(--ink-soft)" : "var(--ink-faint)",
                            opacity: isManualTeacher(t) ? 1 : 0.5,
                            display: "inline-flex", alignItems: "center", marginRight: 4,
                          }}
                        ><Pencil size={15} strokeWidth={1.8} /></button>
                        <button
                          onClick={() => deleteTeacher(t.id, t.name)}
                          style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
                        ><Trash2 size={15} strokeWidth={1.8} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 삭제된 교사 (소프트 삭제 — 복구/영구삭제) */}
        {deletedTeachers.length > 0 && (
          <div style={{ ...cardStyle, marginTop: 16 }}>
            <button
              onClick={() => setShowDeleted(!showDeleted)}
              style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--ink-faint)", padding: 0 }}
            >
              {showDeleted ? <ChevronUp size={14} strokeWidth={1.8} /> : <ChevronDown size={14} strokeWidth={1.8} />}
              삭제된 교사 {deletedTeachers.length}명 {showDeleted ? "접기" : "보기"}
            </button>
            {showDeleted && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {deletedTeachers.map((t) => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--bg-soft)", borderRadius: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-faint)" }}>{t.name}</span>
                      {t.teacher_role && (
                        <span style={{ fontSize: 10, color: "var(--ink-faint)", marginLeft: 6 }}>{t.teacher_role}</span>
                      )}
                    </div>
                    <button
                      onClick={() => restoreTeacher(t.id, t.name)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: 8, fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit" }}
                    ><RotateCcw size={12} strokeWidth={1.8} /> 복구</button>
                    <button
                      onClick={() => purgeTeacher(t.id, t.name)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", background: "none", border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", borderRadius: 8, fontSize: 11, fontWeight: 700, color: "var(--danger)", cursor: "pointer", fontFamily: "inherit" }}
                    ><Trash2 size={12} strokeWidth={1.8} /> 영구삭제</button>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.6 }}>
                  복구하면 출석 기록까지 그대로 되살아납니다. 영구삭제는 출석 기록을 함께 삭제하며 되돌릴 수 없습니다.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

// 해당 월의 일요일 날짜 배열
function getSundaysInMonth(year: number, month: number): string[] {
  const sundays: string[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  while (d.getMonth() === month - 1) {
    // toISOString은 UTC 변환이라 KST에서 토요일로 하루 밀림 — 로컬 날짜로 포맷 (내반출결과 동일 키)
    sundays.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 7);
  }
  return sundays;
}

function formatMD(d: string) {
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function weekNo(d: string, sundays: string[]) {
  return sundays.indexOf(d) + 1;
}

function prevMonth(year: number, month: number, setYear: (y: number) => void, setMonth: (m: number) => void) {
  if (month === 1) { setYear(year - 1); setMonth(12); }
  else setMonth(month - 1);
}

function nextMonth(year: number, month: number, setYear: (y: number) => void, setMonth: (m: number) => void) {
  if (month === 12) { setYear(year + 1); setMonth(1); }
  else setMonth(month + 1);
}

const headerStyle: React.CSSProperties = {
  background: "var(--card)",
  borderBottom: "1px solid var(--hairline)",
  padding: "10px clamp(12px,4vw,20px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const cardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 14,
  padding: 20,
  boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
};

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  border: "1.5px solid var(--hairline)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--ink-faint)",
  letterSpacing: 0.5,
  marginBottom: 10,
};

const backBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--bg-soft)",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--ink-mid)",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap" as const, flexShrink: 0,
};

const addBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "9px 18px",
  background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "9px 14px",
  background: "var(--bg-soft)",
  color: "var(--ink-soft)",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};

const navBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "var(--bg-soft)",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
  color: "var(--ink-mid)",
};

const thStyle = (align: "left" | "center", minWidth?: number): React.CSSProperties => ({
  padding: "10px 8px",
  textAlign: align,
  fontSize: 11,
  fontWeight: 700,
  color: "var(--ink-soft)",
  borderBottom: "2px solid var(--hairline)",
  background: "var(--surface)",
  whiteSpace: "nowrap",
  minWidth: minWidth,
});

const toastStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 40,
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(43, 39, 34,0.88)",
  color: "#fff",
  padding: "12px 24px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  zIndex: 999,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

