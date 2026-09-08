"use client";

// 참여율 조사 — 초등1부 부서관리 전용.
// 반별 학생 명단에서 한 번 누르면 참석, 한 번 더 누르면 불참, 다시 누르면 미체크로 순환한다.
// 학년별/성별 통계를 실시간으로 보여주고, 통계 + 참석자 명단(비고 포함)을 카톡에 붙여넣을 텍스트로 복사한다.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView } from "@/components/StatusViews";
import { ChevronLeft, ChevronRight, Copy, Lock, Users } from "lucide-react";

interface StudentRow {
  student_id: string;
  name: string;
  class_no: string | null;
  grade_year: number | null;
  gender: string | null;
  teacher_name: string | null;
  status: "" | "참석" | "불참";
  note: string | null;
}

interface TeacherRow {
  teacher_id: string;
  name: string;
  teacher_role: string | null;
  status: "" | "참석" | "불참";
  note: string | null;
}

const CLASS_COLLATOR = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const NEXT_STATUS: Record<string, "" | "참석" | "불참"> = { "": "참석", 참석: "불참", 불참: "" };
const STATUS_COLOR: Record<string, string> = {
  "": "var(--ink-faint)",
  참석: "var(--success)",
  불참: "var(--danger)",
};

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthDayLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = "일월화수목금토"[new Date(y, m - 1, d).getDay()];
  return `${y}년 ${m}월 ${d}일(${weekday})`;
}

function genderLabel(value: string | null | undefined) {
  if (value === "M" || value === "남") return "남";
  if (value === "F" || value === "여") return "여";
  return "";
}

function classLabel(row: { grade_year: number | null; class_no: string | null }) {
  const grade = row.grade_year ? `${row.grade_year}학년 ` : "";
  return `${grade}${row.class_no || "미배정"}반`;
}

function compareRows(a: StudentRow, b: StudentRow) {
  const gDiff = (a.grade_year ?? 99) - (b.grade_year ?? 99);
  if (gDiff !== 0) return gDiff;
  const cDiff = CLASS_COLLATOR.compare(a.class_no || "", b.class_no || "");
  if (cDiff !== 0) return cDiff;
  return a.name.localeCompare(b.name, "ko");
}

function groupByClass(rows: StudentRow[]) {
  const map = new Map<string, StudentRow[]>();
  rows.forEach((r) => {
    const key = r.class_no?.trim() || "미배정";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  });
  return Array.from(map.entries()).map(([classNo, students]) => ({ classNo, students }));
}

export default function ParticipationCheckPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [deptName, setDeptName] = useState("");
  const [date, setDate] = useState(() => toISO(new Date()));
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [teacherNoteDraft, setTeacherNoteDraft] = useState<Record<string, string>>({});

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  }, []);

  const load = useCallback(async (targetDate: string) => {
    setLoading(true);
    const [deptResp, listResp, teacherResp] = await Promise.all([
      supabase.rpc("get_department_info", { p_dept_id: deptId }),
      supabase.rpc("edu_participation_list", { p_dept_id: deptId, p_check_date: targetDate }),
      supabase.rpc("edu_participation_teacher_list", { p_dept_id: deptId, p_check_date: targetDate }),
    ]);
    if (!deptResp.error && deptResp.data && deptResp.data.length > 0) {
      setDeptName(deptResp.data[0].name || "");
    }
    if (listResp.error) {
      if (listResp.error.message.includes("권한")) {
        setAuthorized(false);
      } else {
        showToast(`조회 실패: ${listResp.error.message}`);
      }
      setStudents([]);
      setTeachers([]);
      setLoading(false);
      return;
    }
    setAuthorized(true);
    const rows = ((listResp.data || []) as StudentRow[]).slice().sort(compareRows);
    setStudents(rows);
    setNoteDraft({});
    if (teacherResp.error) {
      showToast(`교사 목록 조회 실패: ${teacherResp.error.message}`);
      setTeachers([]);
    } else {
      const teacherRows = ((teacherResp.data || []) as TeacherRow[]).slice().sort((a, b) => a.name.localeCompare(b.name, "ko"));
      setTeachers(teacherRows);
    }
    setTeacherNoteDraft({});
    setLoading(false);
  }, [deptId, showToast]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await load(date);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeDate = (nextDate: string) => {
    setDate(nextDate);
    load(nextDate);
  };

  const shiftDate = (deltaDays: number) => {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + deltaDays);
    changeDate(toISO(dt));
  };

  const cycleStatus = async (row: StudentRow) => {
    const next = NEXT_STATUS[row.status];
    setStudents((prev) => prev.map((s) => (s.student_id === row.student_id ? { ...s, status: next } : s)));
    const { error } = await supabase.rpc("edu_participation_set_status", {
      p_dept_id: deptId, p_student_id: row.student_id, p_check_date: date, p_status: next,
    });
    if (error) {
      setStudents((prev) => prev.map((s) => (s.student_id === row.student_id ? { ...s, status: row.status } : s)));
      showToast(`저장 실패: ${error.message}`);
    }
  };

  const saveNote = async (row: StudentRow, value: string) => {
    const trimmed = value;
    if ((row.note || "") === trimmed) return;
    setStudents((prev) => prev.map((s) => (s.student_id === row.student_id ? { ...s, note: trimmed } : s)));
    const { error } = await supabase.rpc("edu_participation_set_note", {
      p_dept_id: deptId, p_student_id: row.student_id, p_check_date: date, p_note: trimmed,
    });
    if (error) showToast(`비고 저장 실패: ${error.message}`);
  };

  const cycleTeacherStatus = async (row: TeacherRow) => {
    const next = NEXT_STATUS[row.status];
    setTeachers((prev) => prev.map((t) => (t.teacher_id === row.teacher_id ? { ...t, status: next } : t)));
    const { error } = await supabase.rpc("edu_participation_teacher_set_status", {
      p_dept_id: deptId, p_teacher_id: row.teacher_id, p_check_date: date, p_status: next,
    });
    if (error) {
      setTeachers((prev) => prev.map((t) => (t.teacher_id === row.teacher_id ? { ...t, status: row.status } : t)));
      showToast(`저장 실패: ${error.message}`);
    }
  };

  const saveTeacherNote = async (row: TeacherRow, value: string) => {
    const trimmed = value;
    if ((row.note || "") === trimmed) return;
    setTeachers((prev) => prev.map((t) => (t.teacher_id === row.teacher_id ? { ...t, note: trimmed } : t)));
    const { error } = await supabase.rpc("edu_participation_teacher_set_note", {
      p_dept_id: deptId, p_teacher_id: row.teacher_id, p_check_date: date, p_note: trimmed,
    });
    if (error) showToast(`비고 저장 실패: ${error.message}`);
  };

  const gradeYears = useMemo(() => {
    const set = new Set<number>();
    students.forEach((s) => { if (s.grade_year) set.add(s.grade_year); });
    return Array.from(set).sort((a, b) => a - b);
  }, [students]);

  const stats = useMemo(() => {
    const byGrade: Record<number, { male: number; female: number; total: number }> = {};
    gradeYears.forEach((g) => { byGrade[g] = { male: 0, female: 0, total: 0 }; });
    let totalMale = 0, totalFemale = 0, total = 0;
    students.forEach((s) => {
      if (s.status !== "참석") return;
      total += 1;
      const isMale = s.gender === "M" || s.gender === "남";
      const isFemale = s.gender === "F" || s.gender === "여";
      if (isMale) totalMale += 1;
      if (isFemale) totalFemale += 1;
      if (s.grade_year && byGrade[s.grade_year]) {
        byGrade[s.grade_year].total += 1;
        if (isMale) byGrade[s.grade_year].male += 1;
        if (isFemale) byGrade[s.grade_year].female += 1;
      }
    });
    return { byGrade, total, totalMale, totalFemale };
  }, [students, gradeYears]);

  const classGroups = useMemo(() => groupByClass(students), [students]);

  const teacherStats = useMemo(() => {
    const present = teachers.filter((t) => t.status === "참석").length;
    return { present, total: teachers.length };
  }, [teachers]);

  const presentTeachers = useMemo(() => teachers.filter((t) => t.status === "참석"), [teachers]);
  const presentClassGroups = useMemo(
    () => groupByClass(students.filter((s) => s.status === "참석")),
    [students],
  );

  const buildOutputText = () => {
    const lines: string[] = [];
    lines.push(`[${deptName || "부서"} 참여율 조사] ${monthDayLabel(date)}`);
    lines.push("");
    lines.push("■ 통계");
    lines.push(`학년별 참석: ${gradeYears.length ? gradeYears.map((g) => `${g}학년 ${stats.byGrade[g].total}명`).join(" · ") : "-"}`);
    lines.push(`학년별 남/여: ${gradeYears.length ? gradeYears.map((g) => `${g}학년(남${stats.byGrade[g].male}·여${stats.byGrade[g].female})`).join(" · ") : "-"}`);
    lines.push(`총 참석: ${stats.total}명`);
    lines.push(`총 남/여: 남${stats.totalMale}·여${stats.totalFemale}`);
    lines.push(`교사 출석: ${teacherStats.present}/${teacherStats.total}명`);
    lines.push("");
    lines.push("■ 참석자 명단");
    if (presentTeachers.length === 0 && presentClassGroups.length === 0) {
      lines.push("(참석자 없음)");
    } else {
      if (presentTeachers.length > 0) {
        lines.push("[교사]");
        presentTeachers.forEach((t) => {
          const noteTxt = t.note && t.note.trim() ? ` - 비고: ${t.note.trim()}` : "";
          lines.push(`- ${t.name}${t.teacher_role ? `(${t.teacher_role})` : ""} 선생님${noteTxt}`);
        });
        lines.push("");
      }
      presentClassGroups.forEach(({ students: rows }) => {
        const head = rows[0];
        lines.push(`[${classLabel(head)}${head.teacher_name ? ` · ${head.teacher_name} 선생님` : ""}]`);
        rows.forEach((r) => {
          const g = genderLabel(r.gender);
          const noteTxt = r.note && r.note.trim() ? ` - 비고: ${r.note.trim()}` : "";
          lines.push(`- ${r.name}${g ? `(${g})` : ""}${noteTxt}`);
        });
        lines.push("");
      });
    }
    return lines.join("\n").trimEnd();
  };

  const doCopy = async () => {
    const text = buildOutputText();
    try {
      await navigator.clipboard.writeText(text);
      showToast("복사되었습니다 — 카톡방에 붙여넣기 하세요");
    } catch {
      showToast("복사에 실패했습니다");
    }
  };

  if (!authChecked) return <main style={pageStyle}><LoadingView full /></main>;

  if (!authorized) {
    return (
      <main style={pageStyle}>
        <header style={headerStyle}>
          <button type="button" onClick={() => router.back()} style={backBtnStyle}>← 뒤로</button>
          <HeaderLogo />
          <div style={{ width: 56 }} />
        </header>
        <div style={{ maxWidth: 480, margin: "60px auto", padding: 24, textAlign: "center" }}>
          <Lock size={40} strokeWidth={1.6} style={{ color: "var(--ink-faint)" }} />
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginTop: 14 }}>참여율 조사 접근 권한이 없습니다</div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 6 }}>전도사·부장(등급 0~1)만 이용할 수 있습니다.</div>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <button type="button" onClick={() => router.back()} style={backBtnStyle}>← 뒤로</button>
        <HeaderLogo />
        <div style={{ width: 56 }} />
      </header>

      <div style={containerStyle}>
        <div style={titleRowStyle}>
          <div style={eyebrowStyle}>{deptName} · 부서관리</div>
          <h1 style={titleStyle}>참여율 조사</h1>
        </div>

        <div style={dateBarStyle}>
          <button type="button" onClick={() => shiftDate(-1)} aria-label="이전 날짜" style={iconButtonStyle}>
            <ChevronLeft size={18} strokeWidth={1.8} />
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && changeDate(e.target.value)}
            style={dateInputStyle}
          />
          <button type="button" onClick={() => shiftDate(1)} aria-label="다음 날짜" style={iconButtonStyle}>
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
        </div>

        {loading ? (
          <LoadingView />
        ) : (
          <>
            {/* 통계 */}
            <div style={statsCardStyle}>
              <div style={statsTitleStyle}><Users size={15} strokeWidth={2} /> 통계 (참석 기준)</div>
              <div style={statsRowStyle}>
                <span style={statsLabelStyle}>학년별</span>
                <span>{gradeYears.length ? gradeYears.map((g) => `${g}학년 ${stats.byGrade[g].total}명`).join(" · ") : "-"}</span>
              </div>
              <div style={statsRowStyle}>
                <span style={statsLabelStyle}>학년별 남/여</span>
                <span>{gradeYears.length ? gradeYears.map((g) => `${g}학년(남${stats.byGrade[g].male}·여${stats.byGrade[g].female})`).join(" · ") : "-"}</span>
              </div>
              <div style={statsRowStyle}>
                <span style={statsLabelStyle}>총 참석</span>
                <span style={{ fontWeight: 800, color: "var(--accent-strong)" }}>{stats.total}명</span>
              </div>
              <div style={statsRowStyle}>
                <span style={statsLabelStyle}>총 남/여</span>
                <span>남{stats.totalMale}명 · 여{stats.totalFemale}명</span>
              </div>
              <div style={statsRowStyle}>
                <span style={statsLabelStyle}>교사 출석</span>
                <span>{teacherStats.present}/{teacherStats.total}명</span>
              </div>
            </div>

            {/* 참석자 명단 (실시간) */}
            <div style={statsCardStyle}>
              <div style={statsTitleStyle}>참석자 명단</div>
              {presentTeachers.length === 0 && presentClassGroups.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>아직 참석 체크된 인원이 없습니다</div>
              ) : (
                <>
                  {presentTeachers.length > 0 && (
                    <div style={listGroupStyle}>
                      <div style={listGroupTitleStyle}>교사</div>
                      {presentTeachers.map((t) => (
                        <div key={t.teacher_id} style={listRowStyle}>
                          - {t.name}{t.teacher_role ? `(${t.teacher_role})` : ""} 선생님
                          {t.note && t.note.trim() && <span style={{ color: "var(--ink-faint)" }}> — 비고: {t.note.trim()}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {presentClassGroups.map(({ classNo, students: rows }) => {
                    const head = rows[0];
                    return (
                      <div key={classNo} style={listGroupStyle}>
                        <div style={listGroupTitleStyle}>
                          {classLabel(head)}{head.teacher_name && ` · ${head.teacher_name} 선생님`}
                        </div>
                        {rows.map((r) => (
                          <div key={r.student_id} style={listRowStyle}>
                            - {r.name}{genderLabel(r.gender) && `(${genderLabel(r.gender)})`}
                            {r.note && r.note.trim() && <span style={{ color: "var(--ink-faint)" }}> — 비고: {r.note.trim()}</span>}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            <button type="button" onClick={doCopy} style={copyButtonStyle}>
              <Copy size={15} strokeWidth={2} /> 통계·명단 복사하기
            </button>

            {/* 교사 체크리스트 */}
            {teachers.length > 0 && (
              <div style={classCardStyle}>
                <div style={classHeadStyle}>교사</div>
                {teachers.map((row) => (
                  <div key={row.teacher_id} style={studentRowStyle}>
                    <button
                      type="button"
                      onClick={() => cycleTeacherStatus(row)}
                      style={{ ...statusPillStyle, background: `color-mix(in srgb, ${STATUS_COLOR[row.status]} 14%, transparent)`, color: STATUS_COLOR[row.status] }}
                    >
                      {row.status || "미체크"}
                    </button>
                    <span style={studentNameStyle}>
                      {row.name}
                      {row.teacher_role && <span style={{ color: "var(--ink-faint)", fontWeight: 600 }}> ({row.teacher_role})</span>}
                    </span>
                    <input
                      type="text"
                      placeholder="비고"
                      value={teacherNoteDraft[row.teacher_id] ?? row.note ?? ""}
                      onChange={(e) => setTeacherNoteDraft((prev) => ({ ...prev, [row.teacher_id]: e.target.value }))}
                      onBlur={(e) => saveTeacherNote(row, e.target.value)}
                      style={noteInputStyle}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* 반별 체크리스트 */}
            {classGroups.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>등록된 학생이 없습니다</div>
            ) : (
              classGroups.map(({ classNo, students: rows }) => {
                const head = rows[0];
                return (
                  <div key={classNo} style={classCardStyle}>
                    <div style={classHeadStyle}>
                      {classLabel(head)}
                      {head.teacher_name && <span style={{ color: "var(--ink-faint)", fontWeight: 600 }}> · {head.teacher_name} 선생님</span>}
                    </div>
                    {rows.map((row) => (
                      <div key={row.student_id} style={studentRowStyle}>
                        <button
                          type="button"
                          onClick={() => cycleStatus(row)}
                          style={{ ...statusPillStyle, background: `color-mix(in srgb, ${STATUS_COLOR[row.status]} 14%, transparent)`, color: STATUS_COLOR[row.status] }}
                        >
                          {row.status || "미체크"}
                        </button>
                        <span style={studentNameStyle}>
                          {row.name}
                          {genderLabel(row.gender) && <span style={{ color: "var(--ink-faint)", fontWeight: 600 }}> ({genderLabel(row.gender)})</span>}
                        </span>
                        <input
                          type="text"
                          placeholder="비고"
                          value={noteDraft[row.student_id] ?? row.note ?? ""}
                          onChange={(e) => setNoteDraft((prev) => ({ ...prev, [row.student_id]: e.target.value }))}
                          onBlur={(e) => saveNote(row, e.target.value)}
                          style={noteInputStyle}
                        />
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
    </main>
  );
}

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const backBtnStyle: CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 13, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const containerStyle: CSSProperties = { maxWidth: 640, margin: "0 auto", padding: "20px 16px 60px" };
const titleRowStyle: CSSProperties = { marginBottom: 14 };
const eyebrowStyle: CSSProperties = { fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 600 };
const titleStyle: CSSProperties = { fontSize: 20, fontWeight: 800, color: "var(--ink)", margin: "2px 0 0" };
const dateBarStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 16 };
const iconButtonStyle: CSSProperties = { width: 34, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--card)", color: "var(--ink-mid)", cursor: "pointer" };
const dateInputStyle: CSSProperties = { padding: "8px 10px", border: "1.5px solid var(--hairline)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "var(--card)", color: "var(--ink)" };
const statsCardStyle: CSSProperties = { background: "var(--card)", borderRadius: 14, padding: "14px 16px", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.05)", display: "flex", flexDirection: "column", gap: 6 };
const statsTitleStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, color: "var(--ink)", marginBottom: 4 };
const statsRowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, color: "var(--ink-mid)" };
const statsLabelStyle: CSSProperties = { color: "var(--ink-faint)", fontWeight: 700, flexShrink: 0 };
const listGroupStyle: CSSProperties = { marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--hairline)" };
const listGroupTitleStyle: CSSProperties = { fontSize: 12, fontWeight: 800, color: "var(--ink-soft)", marginBottom: 4 };
const listRowStyle: CSSProperties = { fontSize: 12.5, color: "var(--ink)", lineHeight: 1.7 };
const copyButtonStyle: CSSProperties = { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", marginBottom: 18, background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const classCardStyle: CSSProperties = { background: "var(--card)", borderRadius: 14, padding: "12px 14px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const classHeadStyle: CSSProperties = { fontSize: 13, fontWeight: 800, color: "var(--ink)", marginBottom: 8 };
const studentRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid var(--hairline)" };
const statusPillStyle: CSSProperties = { flexShrink: 0, minWidth: 56, padding: "6px 8px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };
const studentNameStyle: CSSProperties = { fontSize: 13.5, fontWeight: 700, color: "var(--ink)", flex: "0 1 auto", whiteSpace: "nowrap" };
const noteInputStyle: CSSProperties = { flex: 1, minWidth: 0, padding: "6px 8px", border: "1px solid var(--hairline)", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", background: "var(--card)", color: "var(--ink)" };
const toastStyle: CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap" };
