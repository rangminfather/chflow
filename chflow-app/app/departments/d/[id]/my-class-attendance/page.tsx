"use client";

// 내 반 출결 — 담임 본인이 맡고 있는 반 학생만 표시.
// 학생 추가/삭제 X (관리자가 행정관리 → 출결 통합 조회 에서 수행).
// 본인이 담임으로 등록되지 않은 사용자는 빈 화면 + 안내.

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";

interface Student {
  id: string;
  student_no: number;
  name: string;
  student_type: string;
  grade: string | null;
  is_active: boolean;
  order_no: number;
  member_id: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
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
  { key: "had_prayer",     label: "기" },
  { key: "had_church_sch", label: "교" },
  { key: "had_worship",    label: "예" },
  { key: "had_lesson",     label: "공" },
  { key: "had_bible",      label: "성" },
];

const STATUS_LIST = ["출", "빠", "결", "인"];
const STATUS_COLOR: Record<string, string> = {
  출: "#10b981", 빠: "#f59e0b", 결: "#ef4444", 인: "#6366f1",
};

export default function MyClassAttendancePage() {
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
  const [myTeacherId, setMyTeacherId] = useState<string | null>(null);
  const [myClassName, setMyClassName] = useState<string>("");
  const [saving, setSaving] = useState<string>("");
  const [toast, setToast] = useState("");
  const [editMemo, setEditMemo] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }

      // 본인이 담임으로 등록된 edu_teachers row 찾기
      const { data: t } = await supabase
        .from("edu_teachers")
        .select("id")
        .eq("department_id", deptId)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();
      setMyTeacherId(t?.id || null);

      setAuthChecked(true);
      await loadAll(t?.id || null);
    })();
  }, [router, deptId]);

  useEffect(() => {
    if (authChecked) loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, authChecked]);

  const loadAll = async (teacherId: string | null) => {
    setLoading(true);
    if (teacherId) {
      await Promise.all([loadStudents(teacherId), loadAttendance()]);
    }
    setLoading(false);
  };

  const loadStudents = async (teacherId: string) => {
    const { data } = await supabase.rpc("edu_list_students", { p_dept_id: deptId });
    const all = (data || []) as Student[];
    const mine = all.filter((s) => s.teacher_id === teacherId);
    setStudents(mine);
    // 반 이름 추측 — 첫 학생의 class_no (없으면 빈)
    if (mine.length > 0) {
      const { data: cls } = await supabase
        .from("edu_students")
        .select("class_no")
        .eq("id", mine[0].id)
        .maybeSingle();
      if (cls?.class_no) setMyClassName(cls.class_no);
    }
  };

  const loadAttendance = async () => {
    const { data } = await supabase.rpc("edu_get_student_attendance", {
      p_dept_id: deptId, p_year: year, p_month: month,
    });
    setAttData(data || []);
  };

  const sundays = useMemo(() => getSundaysInMonth(year, month), [year, month]);

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
      had_prayer:     cell?.had_prayer     ?? false,
      had_church_sch: cell?.had_church_sch ?? false,
      had_worship:    cell?.had_worship    ?? false,
      had_lesson:     cell?.had_lesson     ?? false,
      had_bible:      cell?.had_bible      ?? false,
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
      p_prayer:     cell?.had_prayer     ?? false,
      p_church_sch: cell?.had_church_sch ?? false,
      p_worship:    cell?.had_worship    ?? false,
      p_lesson:     cell?.had_lesson     ?? false,
      p_bible:      cell?.had_bible      ?? false,
      p_status:     status,
      p_memo:       cell?.memo ?? null,
    });
    await loadAttendance();
  };

  const monthlySummary = (studentId: string) => {
    const cells = sundays.map((d) => getCell(studentId, d));
    const total   = sundays.length;
    const attend  = cells.filter((c) => c?.attend_status === "출").length;
    const skip    = cells.filter((c) => c?.attend_status === "빠").length;
    const absent  = cells.filter((c) => c?.attend_status === "결").length;
    const excused = cells.filter((c) => c?.attend_status === "인").length;
    return { total, attend, skip, absent, excused };
  };

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  // 담임 아닌 경우
  if (!myTeacherId) {
    return (
      <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" }}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
            <HeaderLogo />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>📋 내 반 출결</div>
          <div style={{ width: 80 }} />
        </div>
        <div style={{ maxWidth: 600, margin: "60px auto", padding: 16 }}>
          <div style={{ ...cardStyle, textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🙇</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b", marginBottom: 8 }}>
              본인이 담임으로 등록된 반이 없습니다
            </div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
              부장 또는 전도사에게 담임 등록을 요청하세요.<br />
              (행정관리 → 담임선생님 지정)
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />
      <style>{`
        .att-table { border-collapse: collapse; }
        .att-table th, .att-table td { border: 1px solid #e2e8f0; }
        .check-btn { transition: all 0.1s; }
        .check-btn:hover { filter: brightness(0.9); }
      `}</style>

      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
          <HeaderLogo />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>
          📋 내 반 출결 {myClassName && <span style={{ color: "#6366f1", marginLeft: 6 }}>{myClassName}반</span>}
        </div>
        <div style={{ width: 80 }} />
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
        <div style={{ background: "#dbeafe", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 14px", fontSize: 11, color: "#1e40af", marginBottom: 12, lineHeight: 1.5 }}>
          💡 본인 담당 반 학생 {students.length}명만 표시됩니다. 학생 추가/삭제는 행정관리자에게 요청하세요.
        </div>

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

        <div style={{ ...cardStyle, overflowX: "auto", padding: 0 }}>
          {loading ? (
            <div style={{ color: "#94a3b8", textAlign: "center", padding: 60 }}>불러오는 중...</div>
          ) : students.length === 0 ? (
            <div style={{ color: "#94a3b8", textAlign: "center", padding: 60 }}>
              담당 반 학생이 없습니다. 부장 또는 전도사에게 학생 배정을 요청하세요.
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
                        }}>{s.student_type}</span>
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
                                  >{val ? "✓" : "·"}</button>
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
                      <td style={{ textAlign: "center", padding: 4, fontWeight: 700, color: "#64748b" }}>{summary.total}</td>
                      <td style={{ textAlign: "center", padding: 4, fontWeight: 700, color: "#10b981" }}>{summary.attend}</td>
                      <td style={{ textAlign: "center", padding: 4, fontWeight: 700, color: "#f59e0b" }}>{summary.skip}</td>
                      <td style={{ textAlign: "center", padding: 4, fontWeight: 700, color: "#ef4444" }}>{summary.absent}</td>
                      <td style={{ textAlign: "center", padding: 4, fontWeight: 700, color: "#6366f1" }}>{summary.excused}</td>
                      <td style={{ padding: 4 }}>
                        <input
                          type="text"
                          defaultValue={attData.find((a) => a.student_id === s.id)?.memo ?? ""}
                          placeholder="메모"
                          onChange={(e) => setEditMemo((m) => ({ ...m, [`${s.id}-memo`]: e.target.value }))}
                          style={{ width: "100%", fontSize: 10, border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 4px", boxSizing: "border-box", fontFamily: "inherit" }}
                        />
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
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit" };
const navBtnStyle: React.CSSProperties = { padding: "6px 12px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "inherit", color: "#475569" };
const thStyle2 = (minWidth: number): React.CSSProperties => ({ padding: "6px 4px", textAlign: "center", fontSize: 10, fontWeight: 700, color: "#64748b", background: "#f8fafc", whiteSpace: "nowrap", minWidth });
const loadingStyle: React.CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" };
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(15,23,42,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap" };
