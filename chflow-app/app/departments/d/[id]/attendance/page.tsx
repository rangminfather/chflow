"use client";

// 출결 통합 조회 — 전 반 한 달치 출결 체크(출/결/인 탭 순환) + 달란트 체크 현황(읽기 전용).
// 학생 추가/삭제는 학생정보관리 메뉴에서 수행. 학생 이름 클릭 → 출결 이력 모달(기간 조회).

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ConfirmDialog";
import HeaderLogo from "@/components/HeaderLogo";
import ModalBackdrop from "@/components/ModalBackdrop";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { ClipboardList, BookOpen, Medal, Search, X } from "lucide-react";

interface Student {
  id: string;
  student_no: number;
  name: string;
  student_type: string;
  grade: string | null;
  is_active: boolean;
  order_no: number;
  class_no?: string | null;
  grade_year?: number | null;
  teacher_name?: string | null;
}

interface AttendRow {
  student_id: string;
  attend_date: string | null;
  had_prayer: boolean;
  had_church_sch: boolean;
  had_worship: boolean;
  had_lesson: boolean;
  had_bible: boolean;
  attend_status: string;
  memo: string | null;
}

interface TalentRule {
  id: string;
  rule_kind: string;
  rule_key: string;
  label: string;
  points: number;
  order_no: number;
  is_active: boolean;
}

interface WeeklyExtra {
  student_id: string;
  attend_date: string;
  rule_id: string;
}

interface PromoRow {
  new_friend_id: string;
  student_id: string;
  name: string;
  class_no: string | null;
  grade_year: number | null;
  teacher_id: string | null;
  attend_count: number;
  state: "ready" | "upcoming";
  guide_kind: string | null;
  guide_student_name: string | null;
}

interface HistoryRow {
  attend_date: string;
  attend_status: string;
  memo: string | null;
}

// 출결 상태 순환: 미기록 → 출석 → 결석 → 출석인정 → 출석 …
const STATUS_CYCLE: Record<string, string> = { "": "출", 출: "결", 결: "인", 인: "출" };
const STATUS_FULL: Record<string, string> = { 출: "출석", 결: "결석", 인: "출석인정", 빠: "빠짐" };
const STATUS_COLOR: Record<string, string> = {
  출: "var(--success)", 결: "var(--danger)", 인: "var(--accent)", 빠: "var(--warning)",
};
// 출석부 자동연동 키 — 달란트통장과 동일 기준으로 수동 체크 칩에서 제외
const SYSTEM_AUTO_KEYS = new Set(["attendance", "prayer", "church_school", "worship", "lesson", "bible"]);
const PROMOTION_KEY = "new_friend_promotion";

function classLabel(row: { grade_year: number | null; class_no: string | null }): string {
  const grade = row.grade_year ? `${row.grade_year}학년 ` : "";
  return `${grade}${row.class_no || "미배정"}반`;
}

export default function AttendancePage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const params = useParams();
  const deptId = params.id as string;

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [students, setStudents] = useState<Student[]>([]);
  const [attData, setAttData] = useState<AttendRow[]>([]);
  const [rules, setRules] = useState<TalentRule[]>([]);
  const [extras, setExtras] = useState<WeeklyExtra[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState("");
  const [newFriendMap, setNewFriendMap] = useState<Record<string, boolean>>({});
  const [board, setBoard] = useState<PromoRow[]>([]);
  const [promoting, setPromoting] = useState("");

  // 출결 이력 모달
  const [histStudent, setHistStudent] = useState<Student | null>(null);
  const [histRows, setHistRows] = useState<HistoryRow[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histYearFrom, setHistYearFrom] = useState(now.getFullYear());
  const [histMonthFrom, setHistMonthFrom] = useState(1);
  const [histYearTo, setHistYearTo] = useState(now.getFullYear());
  const [histMonthTo, setHistMonthTo] = useState(now.getMonth() + 1);

  const loadPromotion = useCallback(async () => {
    const [{ data: flags }, { data: rows }] = await Promise.all([
      supabase.rpc("edu_new_friend_flags", { p_dept_id: deptId }),
      supabase.rpc("edu_promotion_board", { p_dept_id: deptId }),
    ]);
    const map: Record<string, boolean> = {};
    ((flags || []) as { student_id: string; promoted: boolean }[]).forEach((f) => {
      if (f.student_id) map[f.student_id] = f.promoted;
    });
    setNewFriendMap(map);
    setBoard((rows || []) as PromoRow[]);
  }, [deptId]);

  const loadStudents = useCallback(async () => {
    const { data } = await supabase.rpc("edu_list_students", { p_dept_id: deptId });
    const baseList = (data || []) as Student[];
    // class_no/grade_year 보강 (RPC 가 그 두 필드 반환 안 함)
    const { data: meta } = await supabase
      .from("edu_students")
      .select("id, class_no, grade_year")
      .eq("department_id", deptId)
      .eq("is_active", true);
    const metaMap: Record<string, { class_no: string | null; grade_year: number | null }> = {};
    (meta || []).forEach((m: { id: string; class_no: string | null; grade_year: number | null }) => {
      metaMap[m.id] = { class_no: m.class_no, grade_year: m.grade_year };
    });
    setStudents(baseList.map((s) => ({
      ...s,
      class_no: metaMap[s.id]?.class_no ?? null,
      grade_year: metaMap[s.id]?.grade_year ?? null,
    })));
  }, [deptId]);

  const loadAttendance = useCallback(async () => {
    const [{ data: att }, { data: extra }] = await Promise.all([
      supabase.rpc("edu_get_student_attendance", { p_dept_id: deptId, p_year: year, p_month: month }),
      supabase.rpc("get_dept_weekly_extra", { p_dept_id: deptId, p_year: year, p_month: month }),
    ]);
    setAttData((att || []) as AttendRow[]);
    setExtras((extra || []) as WeeklyExtra[]);
  }, [deptId, month, year]);

  const loadRules = useCallback(async () => {
    const { data } = await supabase.rpc("list_talent_rules", { p_dept_id: deptId });
    setRules((data || []) as TalentRule[]);
  }, [deptId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadStudents(), loadAttendance(), loadRules(), loadPromotion()]);
    setLoading(false);
  }, [loadAttendance, loadStudents, loadRules, loadPromotion]);

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

  const sundays = useMemo(() => getSundaysInMonth(year, month), [year, month]);

  // 달란트 수동 체크 칩 규칙 (달란트통장과 동일 기준)
  const checkRules = useMemo(
    () => rules
      .filter((r) => r.rule_kind === "weekly" && r.is_active && !SYSTEM_AUTO_KEYS.has(r.rule_key) && r.rule_key !== PROMOTION_KEY)
      .sort((a, b) => (a.order_no || 0) - (b.order_no || 0)),
    [rules]
  );
  const ruleById = useMemo(() => {
    const m: Record<string, TalentRule> = {};
    checkRules.forEach((r) => { m[r.id] = r; });
    return m;
  }, [checkRules]);

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

  // `${student_id}_${date}` → 체크된 달란트 규칙 목록
  const extraMap = useMemo(() => {
    const m: Record<string, TalentRule[]> = {};
    extras.forEach((e) => {
      const rule = ruleById[e.rule_id];
      if (!rule) return;
      const key = `${e.student_id}_${e.attend_date}`;
      if (!m[key]) m[key] = [];
      m[key].push(rule);
    });
    return m;
  }, [extras, ruleById]);

  const getCell = (studentId: string, date: string): AttendRow | undefined =>
    attMap[studentId]?.[date];

  const cycleStatus = async (studentId: string, date: string) => {
    const cell = getCell(studentId, date);
    const next = STATUS_CYCLE[cell?.attend_status ?? ""] ?? "출";
    const key = `${studentId}-${date}`;
    setSaving(key);
    const { error } = await supabase.rpc("edu_set_student_attendance", {
      p_student_id: studentId,
      p_dept_id:    deptId,
      p_date:       date,
      p_prayer:     cell?.had_prayer    ?? false,
      p_church_sch: cell?.had_church_sch ?? false,
      p_worship:    cell?.had_worship   ?? false,
      p_lesson:     cell?.had_lesson    ?? false,
      p_bible:      cell?.had_bible     ?? false,
      p_status:     next,
      p_memo:       cell?.memo ?? null,
    });
    setSaving("");
    if (error) { showToast(`저장 실패: ${error.message}`); return; }
    await loadAttendance();
  };

  const readyList = useMemo(() => board.filter((b) => b.state === "ready"), [board]);
  const upcomingList = useMemo(() => board.filter((b) => b.state === "upcoming"), [board]);

  const confirmPromotion = async (row: PromoRow) => {
    const guideNote = row.guide_kind === "student" && row.guide_student_name
      ? `\n\n인도자 ${row.guide_student_name} 학생에게 새친구등반 달란트가 적립됩니다.`
      : "";
    const ok = await confirm(`${row.name} 학생을 등반(정회원) 확정할까요?${guideNote}`);
    if (!ok) return;
    setPromoting(row.new_friend_id);
    const { error } = await supabase.rpc("edu_confirm_promotion", { p_new_friend_id: row.new_friend_id });
    setPromoting("");
    if (error) { showToast(`등반 확정 실패: ${error.message}`); return; }
    showToast(`${row.name} 학생 등반 확정 완료`);
    await Promise.all([loadStudents(), loadPromotion()]);
  };

  // 월합계 — 출석 / 결석 / 출석인정 카운트
  const monthlySummary = (studentId: string) => {
    const cells = sundays.map((d) => getCell(studentId, d));
    return {
      attend:  cells.filter((c) => c?.attend_status === "출").length,
      absent:  cells.filter((c) => c?.attend_status === "결").length,
      excused: cells.filter((c) => c?.attend_status === "인").length,
    };
  };

  // ── 출결 이력 모달 ──
  const openHistory = (s: Student) => {
    setHistStudent(s);
    setHistRows([]);
    setHistYearFrom(now.getFullYear());
    setHistMonthFrom(1);
    setHistYearTo(now.getFullYear());
    setHistMonthTo(now.getMonth() + 1);
    loadHistory(s.id, now.getFullYear(), 1, now.getFullYear(), now.getMonth() + 1);
  };

  const loadHistory = async (studentId: string, yf: number, mf: number, yt: number, mt: number) => {
    setHistLoading(true);
    const { data } = await supabase.rpc("edu_get_student_history", {
      p_student_id: studentId,
      p_year_from:  yf,
      p_month_from: mf,
      p_year_to:    yt,
      p_month_to:   mt,
    });
    setHistRows((data || []) as HistoryRow[]);
    setHistLoading(false);
  };

  const histSummary = useMemo(() => ({
    total:   histRows.length,
    attend:  histRows.filter((h) => h.attend_status === "출").length,
    absent:  histRows.filter((h) => h.attend_status === "결").length,
    excused: histRows.filter((h) => h.attend_status === "인").length,
  }), [histRows]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>

      <style>{`
        .att-table { border-collapse: collapse; }
        .att-table th, .att-table td { border: 1px solid var(--hairline); }
        .status-btn { transition: all 0.1s; }
        .status-btn:hover { filter: brightness(0.92); }
        .name-btn:hover { text-decoration: underline; }
      `}</style>

      {/* Header */}
      <div className="app-subpage-header" style={headerStyle}>
        <HeaderLogo />
        <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}><ClipboardList size={18} strokeWidth={1.8} style={{ color: "var(--accent)" }} /> 출결 통합 조회</div>
        <div />
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
        {/* 월 선택 */}
        <div style={{ ...cardStyle, marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button onClick={() => prevMonth(year, month, setYear, setMonth)} style={navBtnStyle}>◀</button>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", minWidth: 120, textAlign: "center" }}>
            {year}년 {month}월
          </div>
          <button onClick={() => nextMonth(year, month, setYear, setMonth)} style={navBtnStyle}>▶</button>
          <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-faint)" }}>
            출결 칸 탭 = 출석 → 결석 → 출석인정 순환 · 이름 클릭 = 이력 조회 · 학생 추가/삭제는 학생정보관리에서
          </div>
        </div>

        {/* 등반 확정 대상 ('출' 4회 이상) — 출석부 접근자 누구나 확정 가능 */}
        {readyList.length > 0 && (
          <div style={{ ...cardStyle, marginBottom: 16, border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)", background: "var(--accent-soft)" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 6 }}><Medal size={15} strokeWidth={1.8} /> 등반 확정 대상</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {readyList.map((row) => (
                <div key={row.new_friend_id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{row.name}</span>
                  <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{classLabel(row)}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>출석 {row.attend_count}회 · 4주 등반 대상</span>
                  <button
                    onClick={() => confirmPromotion(row)}
                    disabled={promoting === row.new_friend_id}
                    style={{ marginLeft: "auto", padding: "6px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {promoting === row.new_friend_id ? "확정 중..." : "등반 확정"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 등반 예정 ('출' 3회) */}
        {upcomingList.length > 0 && (
          <div style={{ ...cardStyle, marginBottom: 16, border: "1px solid color-mix(in srgb, var(--warning) 35%, transparent)", background: "var(--warning-soft)" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>⏳ 등반 예정 (다음 출석 시 4주)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {upcomingList.map((row) => (
                <span key={row.new_friend_id} style={{ fontSize: 12, fontWeight: 700, color: "var(--warning)", background: "var(--card)", border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)", borderRadius: 14, padding: "3px 10px" }}>
                  {row.name} <span style={{ color: "var(--ink-faint)", fontWeight: 600 }}>· {classLabel(row)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 그리드 */}
        <div style={{ ...cardStyle, overflowX: "auto", padding: 0 }}>
          {loading ? (
            <LoadingView padding={60} label="불러오는 중..." />
          ) : students.length === 0 ? (
            <div style={{ color: "var(--ink-faint)", textAlign: "center", padding: 60 }}>
              학생이 없습니다. 학생정보관리에서 학생을 등록하세요.
            </div>
          ) : (
            <table className="att-table" style={{ width: "100%", minWidth: 640, fontSize: 11 }}>
              <thead style={{ background: "var(--surface)" }}>
                <tr>
                  <th rowSpan={2} style={thStyle(36)}>번호</th>
                  <th rowSpan={2} style={thStyle(72)}>이름</th>
                  <th rowSpan={2} style={thStyle(44)}>등반</th>
                  {sundays.map((d, i) => (
                    <th key={d} colSpan={2} style={{ ...thStyle(0), textAlign: "center" }}>
                      {i + 1}주 ({formatMD(d)})
                    </th>
                  ))}
                  <th rowSpan={2} style={thStyle(40)}>출석</th>
                  <th rowSpan={2} style={thStyle(40)}>결석</th>
                  <th rowSpan={2} style={thStyle(52)}>출석인정</th>
                </tr>
                <tr>
                  {sundays.map((d) => (
                    <>
                      <th key={`${d}-att`} style={thStyle(40)}>출결</th>
                      <th key={`${d}-talent`} style={thStyle(44)}>달란트</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const sorted = [...students].sort((a, b) => {
                    const ga = a.grade_year ?? 99;
                    const gb = b.grade_year ?? 99;
                    if (ga !== gb) return ga - gb;
                    const ca = a.class_no || "zz";
                    const cb = b.class_no || "zz";
                    if (ca !== cb) return ca.localeCompare(cb);
                    return a.order_no - b.order_no;
                  });
                  const colSpan = 3 + sundays.length * 2 + 3;
                  let lastGroup = "__init__";
                  const rows: React.ReactNode[] = [];
                  sorted.forEach((s) => {
                    const group = `${s.grade_year ?? "0"}-${s.class_no ?? "미배정"}`;
                    if (group !== lastGroup) {
                      lastGroup = group;
                      const teacherName = s.teacher_name || "—";
                      const className = s.class_no || "미배정";
                      const count = sorted.filter((x) => `${x.grade_year ?? "0"}-${x.class_no ?? "미배정"}` === group).length;
                      rows.push(
                        <tr key={`g-${group}`}>
                          <td colSpan={colSpan} style={{
                            background: "var(--accent-soft)",
                            padding: "8px 12px",
                            fontWeight: 800,
                            fontSize: 12,
                            color: "var(--ink)",
                            borderTop: "2px solid var(--accent-line)",
                            borderBottom: "1px solid var(--accent-line)",
                          }}>
                            <BookOpen size={13} strokeWidth={1.8} style={{ verticalAlign: "-2px", marginRight: 4 }} /> {className}반 <span style={{ color: "var(--ink-soft)", fontWeight: 600, fontSize: 11, marginLeft: 8 }}>· 담임 {teacherName} · {count}명</span>
                          </td>
                        </tr>
                      );
                    }
                    const summary = monthlySummary(s.id);
                    rows.push(
                      <tr key={s.id} style={{ borderBottom: "1px solid var(--bg-soft)" }}>
                        <td style={{ textAlign: "center", padding: 3, fontWeight: 700 }}>{s.student_no ?? ""}</td>
                        <td style={{ padding: "3px 6px", whiteSpace: "nowrap" }}>
                          <button
                            className="name-btn"
                            onClick={() => openHistory(s)}
                            style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 11, color: "var(--accent)", cursor: "pointer", fontFamily: "inherit" }}
                          >
                            {s.name}
                          </button>
                        </td>
                        <td style={{ textAlign: "center", padding: 3 }}>
                          {s.id in newFriendMap && (
                            <span style={{
                              fontSize: 10, padding: "1px 5px", borderRadius: 4,
                              background: newFriendMap[s.id] ? "var(--accent-soft)" : "var(--warning-soft)",
                              color: newFriendMap[s.id] ? "var(--accent)" : "var(--warning)",
                              fontWeight: 700,
                            }}>
                              {newFriendMap[s.id] ? "등반" : "등반전"}
                            </span>
                          )}
                        </td>

                        {sundays.map((d) => {
                          const cell = getCell(s.id, d);
                          const status = cell?.attend_status ?? "";
                          const key = `${s.id}-${d}`;
                          const checked = extraMap[`${s.id}_${d}`] || [];
                          return (
                            <>
                              <td key={`${d}-att`} style={{ textAlign: "center", padding: 2 }}>
                                <button
                                  className="status-btn"
                                  onClick={() => cycleStatus(s.id, d)}
                                  disabled={saving === key}
                                  title={status ? STATUS_FULL[status] : "미기록 (탭하여 체크)"}
                                  style={{
                                    width: 32, height: 24, borderRadius: 5, border: "none",
                                    background: status ? `color-mix(in srgb, ${STATUS_COLOR[status]} 18%, transparent)` : "var(--bg-soft)",
                                    color: status ? STATUS_COLOR[status] : "var(--hairline-strong)",
                                    fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
                                    display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto",
                                  }}
                                >
                                  {saving === key ? "…" : status || "·"}
                                </button>
                              </td>
                              <td
                                key={`${d}-talent`}
                                title={checked.length > 0 ? checked.map((r) => `${r.label} +${r.points}`).join(" · ") : "달란트 체크 없음 (체크는 달란트통장에서)"}
                                style={{ textAlign: "center", padding: 2, cursor: checked.length > 0 ? "help" : "default" }}
                              >
                                {checked.length > 0 ? (
                                  <span style={{
                                    fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 8,
                                    background: "var(--accent-soft)", color: "var(--accent)", whiteSpace: "nowrap",
                                  }}>
                                    {checked.length}개 +{checked.reduce((sum, r) => sum + r.points, 0)}
                                  </span>
                                ) : (
                                  <span style={{ color: "var(--hairline-strong)" }}>·</span>
                                )}
                              </td>
                            </>
                          );
                        })}

                        {/* 월합계: 출석 / 결석 / 출석인정 */}
                        <td style={{ textAlign: "center", padding: 3, fontWeight: 700, color: "var(--success)" }}>{summary.attend}</td>
                        <td style={{ textAlign: "center", padding: 3, fontWeight: 700, color: "var(--danger)" }}>{summary.absent}</td>
                        <td style={{ textAlign: "center", padding: 3, fontWeight: 700, color: "var(--accent)" }}>{summary.excused}</td>
                      </tr>
                    );
                  });
                  return rows;
                })()}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 출결 이력 모달 */}
      {histStudent && (
        <ModalBackdrop onClose={() => setHistStudent(null)}>
          <div style={{ background: "var(--card)", borderRadius: 16, padding: 20, width: "min(560px, 100%)", maxHeight: "85dvh", overflowY: "auto", boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>
                {histStudent.name} 출결 이력
              </div>
              <button onClick={() => setHistStudent(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)", padding: 4 }}>
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            {/* 기간 선택 */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
              <input type="number" value={histYearFrom} onChange={(e) => setHistYearFrom(Number(e.target.value))} style={{ ...inputStyle, width: 72 }} />
              <select value={histMonthFrom} onChange={(e) => setHistMonthFrom(Number(e.target.value))} style={{ ...inputStyle, width: 64 }}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
              </select>
              <span style={{ color: "var(--ink-faint)", fontWeight: 700 }}>~</span>
              <input type="number" value={histYearTo} onChange={(e) => setHistYearTo(Number(e.target.value))} style={{ ...inputStyle, width: 72 }} />
              <select value={histMonthTo} onChange={(e) => setHistMonthTo(Number(e.target.value))} style={{ ...inputStyle, width: 64 }}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
              </select>
              <button
                onClick={() => loadHistory(histStudent.id, histYearFrom, histMonthFrom, histYearTo, histMonthTo)}
                style={{ ...searchBtnStyle, display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <Search size={13} strokeWidth={1.8} /> 조회
              </button>
            </div>

            {histLoading ? (
              <LoadingView padding={30} label="불러오는 중..." />
            ) : histRows.length === 0 ? (
              <EmptyState message="선택한 기간에 출결 기록이 없습니다" />
            ) : (
              <>
                {/* 요약 */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
                  {[
                    { label: "전체 주일", value: histSummary.total, color: "var(--ink-soft)" },
                    { label: "출석", value: histSummary.attend, color: "var(--success)" },
                    { label: "결석", value: histSummary.absent, color: "var(--danger)" },
                    { label: "출석인정", value: histSummary.excused, color: "var(--accent)" },
                  ].map((s) => (
                    <div key={s.label} style={{ background: "var(--bg-soft)", borderRadius: 10, textAlign: "center", padding: "10px 6px" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* 이력 목록 */}
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr style={{ background: "var(--surface)" }}>
                      <th style={histThStyle("left")}>날짜</th>
                      <th style={histThStyle("center")}>상태</th>
                      <th style={histThStyle("left")}>메모</th>
                    </tr>
                  </thead>
                  <tbody>
                    {histRows.map((h) => (
                      <tr key={h.attend_date} style={{ borderBottom: "1px solid var(--bg-soft)" }}>
                        <td style={{ padding: "8px 10px", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>{formatDate(h.attend_date)}</td>
                        <td style={{ textAlign: "center", padding: 6 }}>
                          <span style={{
                            display: "inline-block", padding: "2px 10px", borderRadius: 12,
                            fontSize: 11, fontWeight: 800,
                            background: `color-mix(in srgb, ${STATUS_COLOR[h.attend_status] || "var(--ink-soft)"} 15%, transparent)`,
                            color: STATUS_COLOR[h.attend_status] || "var(--ink-soft)",
                          }}>
                            {STATUS_FULL[h.attend_status] || h.attend_status}
                          </span>
                        </td>
                        <td style={{ padding: "8px 10px", fontSize: 11, color: "var(--ink-soft)" }}>{h.memo || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </ModalBackdrop>
      )}

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

function formatDate(d: string) {
  const date = new Date(d);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function prevMonth(year: number, month: number, setYear: (y: number) => void, setMonth: (m: number) => void) {
  if (month === 1) { setYear(year - 1); setMonth(12); }
  else setMonth(month - 1);
}

function nextMonth(year: number, month: number, setYear: (y: number) => void, setMonth: (m: number) => void) {
  if (month === 12) { setYear(year + 1); setMonth(1); }
  else setMonth(month + 1);
}

const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const cardStyle: React.CSSProperties = { background: "var(--card)", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const inputStyle: React.CSSProperties = { padding: "8px 10px", border: "1.5px solid var(--hairline)", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const searchBtnStyle: React.CSSProperties = { padding: "8px 16px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const navBtnStyle: React.CSSProperties = { padding: "6px 12px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "inherit", color: "var(--ink-mid)" };
const thStyle = (minWidth: number): React.CSSProperties => ({ padding: "5px 4px", textAlign: "center", fontSize: 10, fontWeight: 700, color: "var(--ink-soft)", background: "var(--surface)", whiteSpace: "nowrap", minWidth });
const histThStyle = (align: "left" | "center"): React.CSSProperties => ({ padding: "8px 10px", textAlign: align, fontSize: 10, fontWeight: 700, color: "var(--ink-soft)", borderBottom: "2px solid var(--hairline)", background: "var(--surface)", whiteSpace: "nowrap" });
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap" };
