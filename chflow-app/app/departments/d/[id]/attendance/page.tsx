"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Student {
  id: string;
  student_no: number;
  name: string;
  student_type: string;
  grade: string | null;
  is_active: boolean;
  order_no: number;
}

interface AttendRow {
  student_id: string;
  student_no: number;
  student_name: string;
  student_type: string;
  order_no: number;
  attend_date: string | null;
  had_prayer: boolean;
  had_church_sch: boolean;
  had_worship: boolean;
  had_lesson: boolean;
  had_bible: boolean;
  attend_status: string;
  memo: string | null;
}

const CHECKS = [
  { key: "had_prayer",    label: "기" },
  { key: "had_church_sch", label: "교" },
  { key: "had_worship",   label: "예" },
  { key: "had_lesson",    label: "공" },
  { key: "had_bible",     label: "성" },
];

const STATUS_LIST = ["출", "빠", "결", "인"];
const STATUS_COLOR: Record<string, string> = {
  출: "#10b981", 빠: "#f59e0b", 결: "#ef4444", 인: "#6366f1",
};

export default function AttendancePage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [students, setStudents] = useState<Student[]>([]);
  const [attData, setAttData] = useState<AttendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newNo, setNewNo] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("정");
  const [newGrade, setNewGrade] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState<string>("");
  const [editMemo, setEditMemo] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await loadAll();
    })();
  }, []);

  useEffect(() => {
    if (authChecked) loadAttendance();
  }, [year, month, authChecked]);

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([loadStudents(), loadAttendance()]);
    setLoading(false);
  };

  const loadStudents = async () => {
    const { data } = await supabase.rpc("edu_list_students", { p_dept_id: deptId });
    setStudents(data || []);
  };

  const loadAttendance = async () => {
    const { data } = await supabase.rpc("edu_get_student_attendance", {
      p_dept_id: deptId, p_year: year, p_month: month,
    });
    setAttData(data || []);
  };

  const sundays = useMemo(() => getSundaysInMonth(year, month), [year, month]);

  // student_id → {date → AttendRow}
  const attMap = useMemo(() => {
    const m: Record<string, Record<string, AttendRow>> = {};
    attData.forEach((row) => {
      if (!row.attend_date) return;
      if (!m[row.student_id]) m[row.student_id] = {};
      m[row.student_id][row.attend_date] = row;
    });
    return m;
  }, [attData]);

  const getCell = (studentId: string, date: string): AttendRow | undefined =>
    attMap[studentId]?.[date];

  const toggleCheck = async (studentId: string, date: string, checkKey: string) => {
    const cell = getCell(studentId, date);
    const key = `${studentId}-${date}-${checkKey}`;
    setSaving(key);

    const current: Record<string, boolean> = {
      had_prayer:    cell?.had_prayer    ?? false,
      had_church_sch: cell?.had_church_sch ?? false,
      had_worship:   cell?.had_worship   ?? false,
      had_lesson:    cell?.had_lesson    ?? false,
      had_bible:     cell?.had_bible     ?? false,
    };
    current[checkKey] = !current[checkKey];

    await supabase.rpc("edu_set_student_attendance", {
      p_student_id: studentId,
      p_dept_id:    deptId,
      p_date:       date,
      p_prayer:     current.had_prayer,
      p_church_sch: current.had_church_sch,
      p_worship:    current.had_worship,
      p_lesson:     current.had_lesson,
      p_bible:      current.had_bible,
      p_status:     cell?.attend_status ?? "출",
      p_memo:       editMemo[`${studentId}-${date}`] ?? cell?.memo ?? null,
    });
    await loadAttendance();
    setSaving("");
  };

  const setStatus = async (studentId: string, date: string, status: string) => {
    const cell = getCell(studentId, date);
    await supabase.rpc("edu_set_student_attendance", {
      p_student_id: studentId,
      p_dept_id:    deptId,
      p_date:       date,
      p_prayer:     cell?.had_prayer    ?? false,
      p_church_sch: cell?.had_church_sch ?? false,
      p_worship:    cell?.had_worship   ?? false,
      p_lesson:     cell?.had_lesson    ?? false,
      p_bible:      cell?.had_bible     ?? false,
      p_status:     status,
      p_memo:       cell?.memo ?? null,
    });
    await loadAttendance();
  };

  const addStudent = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.rpc("edu_save_student", {
      p_id:       null,
      p_dept_id:  deptId,
      p_no:       parseInt(newNo) || null,
      p_name:     newName.trim(),
      p_type:     newType,
      p_grade:    newGrade.trim() || null,
      p_order_no: students.length,
    });
    if (!error) {
      showToast("학생이 추가되었습니다");
      setNewNo(""); setNewName(""); setNewType("정"); setNewGrade("");
      setShowAddForm(false);
      await loadAll();
    }
  };

  const deleteStudent = async (id: string, name: string) => {
    if (!confirm(`"${name}" 학생을 삭제하시겠습니까?`)) return;
    await supabase.rpc("edu_delete_student", { p_id: id });
    await loadAll();
    showToast("삭제되었습니다");
  };

  // 월합계 계산
  const monthlySummary = (studentId: string) => {
    const cells = sundays.map((d) => getCell(studentId, d));
    const total  = sundays.length;
    const attend  = cells.filter((c) => c?.attend_status === "출").length;
    const skip    = cells.filter((c) => c?.attend_status === "빠").length;
    const absent  = cells.filter((c) => c?.attend_status === "결").length;
    const excused = cells.filter((c) => c?.attend_status === "인").length;
    return { total, attend, skip, absent, excused };
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />

      <style>{`
        .att-table { border-collapse: collapse; }
        .att-table th, .att-table td { border: 1px solid #e2e8f0; }
        .check-btn { transition: all 0.1s; }
        .check-btn:hover { filter: brightness(0.9); }
      `}</style>

      {/* Header */}
      <div style={headerStyle}>
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>📋 출결 (학생출석부)</div>
        <button onClick={() => setShowAddForm(!showAddForm)} style={addBtnStyle}>+ 학생 추가</button>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: 16 }}>
        {/* 학생 추가 폼 */}
        {showAddForm && (
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div style={sectionLabel}>학생 추가</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input type="number" value={newNo} onChange={(e) => setNewNo(e.target.value)} placeholder="번호" style={{ ...inputStyle, width: 70 }} />
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="이름" style={{ ...inputStyle, width: 120 }} />
              <select value={newType} onChange={(e) => setNewType(e.target.value)} style={{ ...inputStyle, width: 100 }}>
                <option value="정">정</option>
                <option value="체험">체험</option>
                <option value="소">소</option>
              </select>
              <input type="text" value={newGrade} onChange={(e) => setNewGrade(e.target.value)} placeholder="학년 (선택)" style={{ ...inputStyle, width: 100 }} />
              <button onClick={addStudent} style={saveBtnStyle}>추가</button>
              <button onClick={() => setShowAddForm(false)} style={cancelBtnStyle}>취소</button>
            </div>
          </div>
        )}

        {/* 월 선택 */}
        <div style={{ ...cardStyle, marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => prevMonth(year, month, setYear, setMonth)} style={navBtnStyle}>◀</button>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", minWidth: 120, textAlign: "center" }}>
            {year}년 {month}월
          </div>
          <button onClick={() => nextMonth(year, month, setYear, setMonth)} style={navBtnStyle}>▶</button>
          <div style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>
            주일: {sundays.length}주 · 기=기도, 교=교회학교, 예=예배, 공=공과, 성=성경읽기
          </div>
        </div>

        {/* 그리드 */}
        <div style={{ ...cardStyle, overflowX: "auto", padding: 0 }}>
          {loading ? (
            <div style={{ color: "#94a3b8", textAlign: "center", padding: 60 }}>불러오는 중...</div>
          ) : students.length === 0 ? (
            <div style={{ color: "#94a3b8", textAlign: "center", padding: 60 }}>
              학생이 없습니다. 상단 &quot;학생 추가&quot;를 눌러 추가하세요.
            </div>
          ) : (
            <table className="att-table" style={{ width: "100%", minWidth: 800, fontSize: 11 }}>
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  <th rowSpan={2} style={thStyle2(50)}>번호</th>
                  <th rowSpan={2} style={thStyle2(80)}>이름</th>
                  <th rowSpan={2} style={thStyle2(50)}>구분</th>
                  {sundays.map((d, i) => (
                    <th key={d} colSpan={6} style={{ ...thStyle2(0), textAlign: "center", borderBottom: "none" }}>
                      <div style={{ fontWeight: 700 }}>{i + 1}주 ({formatMD(d)})</div>
                    </th>
                  ))}
                  <th colSpan={5} rowSpan={1} style={{ ...thStyle2(0), textAlign: "center" }}>월합계</th>
                  <th rowSpan={2} style={thStyle2(60)}>MEMO</th>
                  <th rowSpan={2} style={thStyle2(40)}>관리</th>
                </tr>
                <tr>
                  {sundays.map((d) => (
                    <>
                      {CHECKS.map((c) => (
                        <th key={`${d}-${c.key}`} style={thStyle2(28)}>
                          <span title={c.key === "had_prayer" ? "기도" : c.key === "had_church_sch" ? "교회학교" : c.key === "had_worship" ? "예배" : c.key === "had_lesson" ? "공과" : "성경읽기"}>
                            {c.label}
                          </span>
                        </th>
                      ))}
                      <th key={`${d}-status`} style={thStyle2(32)}>상태</th>
                    </>
                  ))}
                  {["계","출","빠","결","인"].map((l) => (
                    <th key={l} style={thStyle2(28)}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const summary = monthlySummary(s.id);
                  return (
                    <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ textAlign: "center", padding: 4, fontWeight: 700 }}>{s.student_no ?? ""}</td>
                      <td style={{ padding: "4px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{s.name}</td>
                      <td style={{ textAlign: "center", padding: 4 }}>
                        <span style={{
                          fontSize: 10, padding: "1px 5px", borderRadius: 4,
                          background: s.student_type === "정" ? "#eef2ff" : s.student_type === "체험" ? "#fef3c7" : "#f0fdf4",
                          color: s.student_type === "정" ? "#6366f1" : s.student_type === "체험" ? "#92400e" : "#15803d",
                          fontWeight: 700,
                        }}>
                          {s.student_type}
                        </span>
                      </td>

                      {sundays.map((d) => {
                        const cell = getCell(s.id, d);
                        return (
                          <>
                            {CHECKS.map((c) => {
                              const val = cell ? (cell as unknown as Record<string, boolean>)[c.key] : false;
                              const key = `${s.id}-${d}-${c.key}`;
                              return (
                                <td key={`${d}-${c.key}`} style={{ textAlign: "center", padding: 2 }}>
                                  <button
                                    className="check-btn"
                                    onClick={() => toggleCheck(s.id, d, c.key)}
                                    disabled={saving === key}
                                    style={{
                                      width: 24, height: 24, borderRadius: 4, border: "none",
                                      background: val ? "#6366f1" : "#f1f5f9",
                                      color: val ? "#fff" : "#cbd5e1",
                                      fontSize: 12, cursor: "pointer",
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      margin: "0 auto",
                                    }}
                                  >
                                    {val ? "✓" : "·"}
                                  </button>
                                </td>
                              );
                            })}
                            <td key={`${d}-status`} style={{ textAlign: "center", padding: 2 }}>
                              <select
                                value={cell?.attend_status ?? "출"}
                                onChange={(e) => setStatus(s.id, d, e.target.value)}
                                style={{
                                  fontSize: 10, padding: "2px 2px", borderRadius: 4,
                                  border: "1px solid #e2e8f0",
                                  background: STATUS_COLOR[cell?.attend_status ?? "출"] + "22",
                                  color: STATUS_COLOR[cell?.attend_status ?? "출"],
                                  fontWeight: 700, width: 36, fontFamily: "inherit",
                                }}
                              >
                                {STATUS_LIST.map((st) => (
                                  <option key={st} value={st}>{st}</option>
                                ))}
                              </select>
                            </td>
                          </>
                        );
                      })}

                      {/* 월합계 */}
                      <td style={{ textAlign: "center", padding: 4, fontWeight: 700, color: "#64748b" }}>{summary.total}</td>
                      <td style={{ textAlign: "center", padding: 4, fontWeight: 700, color: "#10b981" }}>{summary.attend}</td>
                      <td style={{ textAlign: "center", padding: 4, fontWeight: 700, color: "#f59e0b" }}>{summary.skip}</td>
                      <td style={{ textAlign: "center", padding: 4, fontWeight: 700, color: "#ef4444" }}>{summary.absent}</td>
                      <td style={{ textAlign: "center", padding: 4, fontWeight: 700, color: "#6366f1" }}>{summary.excused}</td>

                      {/* MEMO (첫 주 데이터 기준) */}
                      <td style={{ padding: 4 }}>
                        <input
                          type="text"
                          defaultValue={attData.find((a) => a.student_id === s.id)?.memo ?? ""}
                          placeholder="메모"
                          onChange={(e) => setEditMemo((m) => ({ ...m, [`${s.id}-memo`]: e.target.value }))}
                          style={{ width: "100%", fontSize: 10, border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 4px", boxSizing: "border-box", fontFamily: "inherit" }}
                        />
                      </td>
                      <td style={{ textAlign: "center", padding: 4 }}>
                        <button
                          onClick={() => deleteStudent(s.id, s.name)}
                          style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 14 }}
                        >🗑</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function getSundaysInMonth(year: number, month: number): string[] {
  const sundays: string[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  while (d.getMonth() === month - 1) {
    sundays.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 7);
  }
  return sundays;
}

function formatMD(d: string) {
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function prevMonth(year: number, month: number, setYear: (y: number) => void, setMonth: (m: number) => void) {
  if (month === 1) { setYear(year - 1); setMonth(12); }
  else setMonth(month - 1);
}

function nextMonth(year: number, month: number, setYear: (y: number) => void, setMonth: (m: number) => void) {
  if (month === 12) { setYear(year + 1); setMonth(1); }
  else setMonth(month + 1);
}

const headerStyle: React.CSSProperties = { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" };
const cardStyle: React.CSSProperties = { background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const inputStyle: React.CSSProperties = { padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
const sectionLabel: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.5, marginBottom: 10 };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit" };
const addBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const saveBtnStyle: React.CSSProperties = { padding: "9px 18px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const cancelBtnStyle: React.CSSProperties = { padding: "9px 14px", background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "inherit" };
const navBtnStyle: React.CSSProperties = { padding: "6px 12px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "inherit", color: "#475569" };
const thStyle2 = (minWidth: number): React.CSSProperties => ({ padding: "6px 4px", textAlign: "center", fontSize: 10, fontWeight: 700, color: "#64748b", background: "#f8fafc", whiteSpace: "nowrap", minWidth });
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(15,23,42,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap" };
const loadingStyle: React.CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" };
