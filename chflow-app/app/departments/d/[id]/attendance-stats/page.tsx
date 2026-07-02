"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { BarChart3, GraduationCap, Lock, UserCheck } from "lucide-react";

interface AttendRow {
  student_id: string;
  student_no: number;
  student_name: string;
  student_type: string;
  order_no: number;
  attend_date: string | null;
  attend_status: string;
}

interface TeacherAttendRow {
  teacher_id: string;
  teacher_name: string;
  teacher_role: string | null;
  order_no: number;
  attend_date: string | null;
  is_present: boolean | null;
}

interface StudentMeta {
  id: string;
  class_no: string | null;
  grade_year: number | null;
  order_no: number | null;
  student_no: number | null;
}

interface StudentStat {
  id: string;
  name: string;
  classLabel: string;
  orderKey: number;
  counts: Record<string, number>; // 출/빠/결/인
  present: number;                // 출 + 인
}

interface TeacherStat {
  id: string;
  name: string;
  role: string | null;
  orderNo: number;
  present: number;
}

const STATUS_META = [
  { key: "출", label: "출석", color: "var(--success)" },
  { key: "인", label: "출석인정", color: "var(--accent)" },
  { key: "빠", label: "빠짐", color: "var(--warning)" },
  { key: "결", label: "결석", color: "var(--danger)" },
];

const UNASSIGNED = "반 미배정";

export default function AttendanceStatsPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const now = new Date();
  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"students" | "teachers">("students");
  const [year, setYear] = useState(now.getFullYear());
  const [fromMonth, setFromMonth] = useState(1);
  const [toMonth, setToMonth] = useState(now.getMonth() + 1);
  const [studentRows, setStudentRows] = useState<AttendRow[]>([]);
  const [teacherRows, setTeacherRows] = useState<TeacherAttendRow[]>([]);
  const [studentMeta, setStudentMeta] = useState<Record<string, StudentMeta>>({});

  const months = useMemo(() => {
    const list: number[] = [];
    for (let m = Math.min(fromMonth, toMonth); m <= Math.max(fromMonth, toMonth); m += 1) list.push(m);
    return list;
  }, [fromMonth, toMonth]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [metaResp, ...monthResults] = await Promise.all([
      supabase
        .from("edu_students")
        .select("id, class_no, grade_year, order_no, student_no")
        .eq("department_id", deptId)
        .eq("is_active", true),
      ...months.flatMap((m) => [
        supabase.rpc("edu_get_student_attendance", { p_dept_id: deptId, p_year: year, p_month: m }),
        supabase.rpc("edu_get_teacher_attendance", { p_dept_id: deptId, p_year: year, p_month: m }),
      ]),
    ]);

    const metaMap: Record<string, StudentMeta> = {};
    ((metaResp.data || []) as StudentMeta[]).forEach((meta) => { metaMap[meta.id] = meta; });
    setStudentMeta(metaMap);

    const students: AttendRow[] = [];
    const teachers: TeacherAttendRow[] = [];
    monthResults.forEach((result, index) => {
      if (index % 2 === 0) students.push(...(((result.data || []) as AttendRow[])));
      else teachers.push(...(((result.data || []) as TeacherAttendRow[])));
    });
    setStudentRows(students);
    setTeacherRows(teachers);
    setLoading(false);
  }, [deptId, year, months]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);

      const { data: gradeData } = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      const grade = typeof gradeData === "number" ? gradeData : Number(gradeData);
      if (Number.isNaN(grade) || grade > 2) {
        setAuthorized(false);
        setLoading(false);
        return;
      }
      setAuthorized(true);
      await loadData();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptId, router]);

  useEffect(() => {
    if (authChecked && authorized) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, months]);

  // 기간 내 경과 주일 (오늘 이전의 일요일만)
  const elapsedSundays = useMemo(() => {
    const todayKey = formatDateKey(new Date());
    return months
      .flatMap((m) => getSundaysInMonth(year, m))
      .filter((key) => key <= todayKey);
  }, [year, months]);

  // ── 학생 통계 ────────────────────────────────
  const studentStats = useMemo(() => {
    const map = new Map<string, StudentStat>();
    const seen = new Set<string>();
    studentRows.forEach((row) => {
      let stat = map.get(row.student_id);
      if (!stat) {
        const meta = studentMeta[row.student_id];
        stat = {
          id: row.student_id,
          name: row.student_name,
          classLabel: classLabel(meta),
          orderKey: (meta?.grade_year ?? 99) * 1_000_000 + (meta?.order_no ?? 999) * 1000 + (meta?.student_no ?? 999),
          counts: { 출: 0, 인: 0, 빠: 0, 결: 0 },
          present: 0,
        };
        map.set(row.student_id, stat);
      }
      if (!row.attend_date) return;
      const dedupeKey = `${row.student_id}|${row.attend_date}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      const status = row.attend_status || "출";
      stat.counts[status] = (stat.counts[status] || 0) + 1;
      if (status === "출" || status === "인") stat.present += 1;
    });
    return Array.from(map.values());
  }, [studentRows, studentMeta]);

  const classGroups = useMemo(() => {
    const groups = new Map<string, StudentStat[]>();
    studentStats.forEach((stat) => {
      const list = groups.get(stat.classLabel) || [];
      list.push(stat);
      groups.set(stat.classLabel, list);
    });
    return Array.from(groups.entries())
      .map(([label, list]) => ({
        label,
        list: list.sort((a, b) => a.orderKey - b.orderKey || a.name.localeCompare(b.name, "ko")),
      }))
      .sort((a, b) => {
        if (a.label === UNASSIGNED) return 1;
        if (b.label === UNASSIGNED) return -1;
        return a.label.localeCompare(b.label, "ko");
      });
  }, [studentStats]);

  const weeks = elapsedSundays.length;
  const totalStudents = studentStats.length;
  const totalPresent = studentStats.reduce((sum, stat) => sum + stat.present, 0);
  const deptRate = weeks > 0 && totalStudents > 0 ? Math.round((totalPresent / (totalStudents * weeks)) * 100) : 0;
  const perfectCount = weeks > 0 ? studentStats.filter((stat) => stat.present >= weeks).length : 0;

  // 주차별 출석 인원 추이
  const weeklyTrend = useMemo(() => {
    const byDate: Record<string, number> = {};
    const seen = new Set<string>();
    studentRows.forEach((row) => {
      if (!row.attend_date) return;
      const dedupeKey = `${row.student_id}|${row.attend_date}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      if (row.attend_status === "출" || row.attend_status === "인") {
        byDate[row.attend_date] = (byDate[row.attend_date] || 0) + 1;
      }
    });
    return elapsedSundays.map((date) => ({ date, count: byDate[date] || 0 }));
  }, [studentRows, elapsedSundays]);

  // ── 교사 통계 ────────────────────────────────
  const teacherStats = useMemo(() => {
    const map = new Map<string, TeacherStat>();
    const seen = new Set<string>();
    teacherRows.forEach((row) => {
      let stat = map.get(row.teacher_id);
      if (!stat) {
        stat = { id: row.teacher_id, name: row.teacher_name, role: row.teacher_role, orderNo: row.order_no ?? 999, present: 0 };
        map.set(row.teacher_id, stat);
      }
      if (!row.attend_date || !row.is_present) return;
      const dedupeKey = `${row.teacher_id}|${row.attend_date}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      stat.present += 1;
    });
    return Array.from(map.values()).sort((a, b) => a.orderNo - b.orderNo || a.name.localeCompare(b.name, "ko"));
  }, [teacherRows]);

  const teacherPresent = teacherStats.reduce((sum, stat) => sum + stat.present, 0);
  const teacherRate = weeks > 0 && teacherStats.length > 0
    ? Math.round((teacherPresent / (teacherStats.length * weeks)) * 100) : 0;

  if (!authChecked) return <LoadingView full />;

  if (!authorized) {
    return (
      <div style={pageStyle}>
        <PageHeader deptId={deptId} router={router} />
        <main className="mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-hairline bg-card text-center">
            <EmptyState
              icon={<Lock size={24} strokeWidth={1.8} />}
              message="접근 권한이 없습니다"
              hint="출결통계는 임원진(전도사·부장·부부장·총무·서기)만 이용할 수 있습니다"
            />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <PageHeader deptId={deptId} router={router} />

      <main className="mx-auto w-full max-w-5xl px-4 py-4">
        {/* 기간 선택 + 탭 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={year} onChange={(event) => setYear(Number(event.target.value))} className={selectClass}>
              {yearOptions(now.getFullYear()).map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select value={fromMonth} onChange={(event) => setFromMonth(Number(event.target.value))} className={selectClass}>
              {MONTHS.map((m) => <option key={m} value={m}>{m}월</option>)}
            </select>
            <span className="text-[14px] font-bold text-ink-faint">~</span>
            <select value={toMonth} onChange={(event) => setToMonth(Number(event.target.value))} className={selectClass}>
              {MONTHS.map((m) => <option key={m} value={m}>{m}월</option>)}
            </select>
          </div>
          <div className="flex gap-1 rounded-md bg-bg-soft p-1">
            {[
              { key: "students" as const, label: "학생", icon: GraduationCap },
              { key: "teachers" as const, label: "선생님", icon: UserCheck },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setTab(option.key)}
                className={[
                  "inline-flex min-h-9 items-center gap-1.5 rounded px-3.5 text-[14px] font-extrabold",
                  tab === option.key ? "bg-card text-ink shadow-sm" : "text-ink-faint",
                ].join(" ")}
              >
                <option.icon size={15} strokeWidth={2.2} />
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <LoadingView padding={60} label="통계 계산 중..." />
        ) : weeks === 0 ? (
          <div className="rounded-lg border border-hairline bg-card text-center">
            <EmptyState message="선택한 기간에 경과한 주일이 없습니다" hint="기간을 조정해 주세요" />
          </div>
        ) : tab === "students" ? (
          <>
            {/* 요약 카드 */}
            <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              <SummaryCard label="재적 학생" value={`${totalStudents}명`} />
              <SummaryCard label="경과 주일" value={`${weeks}주`} />
              <SummaryCard label="평균 출석률" value={`${deptRate}%`} accent />
              <SummaryCard label="개근 학생" value={`${perfectCount}명`} />
            </div>

            {/* 주차별 출석 추이 */}
            <div className="mb-4 rounded-lg border border-hairline bg-card p-4">
              <div className="mb-3 text-[15px] font-extrabold text-ink">주차별 출석 인원</div>
              <div className="flex flex-col gap-1.5">
                {weeklyTrend.map(({ date, count }) => (
                  <div key={date} className="flex items-center gap-2">
                    <span className="w-[74px] shrink-0 text-[12px] font-bold text-ink-faint">{shortDate(date)}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-bg-soft">
                      <div
                        className="h-full rounded"
                        style={{ width: `${totalStudents > 0 ? Math.round((count / totalStudents) * 100) : 0}%`, background: "var(--accent)" }}
                      />
                    </div>
                    <span className="w-[52px] shrink-0 text-right text-[12px] font-bold text-ink-soft">{count}명</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 반별 상세 */}
            {classGroups.map((group) => {
              const groupPresent = group.list.reduce((sum, stat) => sum + stat.present, 0);
              const groupRate = group.list.length > 0 ? Math.round((groupPresent / (group.list.length * weeks)) * 100) : 0;
              return (
                <div key={group.label} className="mb-4 overflow-hidden rounded-lg border border-hairline bg-card">
                  <div className="flex items-center justify-between border-b border-hairline bg-surface px-4 py-2.5">
                    <div className="text-[15px] font-extrabold text-ink">{group.label} <span className="ml-1 text-[13px] font-bold text-ink-faint">{group.list.length}명</span></div>
                    <div className="text-[14px] font-extrabold" style={{ color: "var(--accent)" }}>출석률 {groupRate}%</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-hairline text-ink-faint">
                          <th className="px-4 py-2 text-left font-bold">이름</th>
                          {STATUS_META.map((status) => (
                            <th key={status.key} className="px-2 py-2 text-center font-bold">{status.label}</th>
                          ))}
                          <th className="w-[38%] px-4 py-2 text-left font-bold">출석률</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.list.map((stat) => {
                          const rate = Math.round((stat.present / weeks) * 100);
                          return (
                            <tr key={stat.id} className="border-b border-hairline last:border-b-0">
                              <td className="px-4 py-2 font-extrabold text-ink">{stat.name}</td>
                              {STATUS_META.map((status) => (
                                <td key={status.key} className="px-2 py-2 text-center font-bold" style={{ color: stat.counts[status.key] ? status.color : "var(--ink-faint)" }}>
                                  {stat.counts[status.key] || 0}
                                </td>
                              ))}
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="h-3.5 flex-1 overflow-hidden rounded bg-bg-soft">
                                    <div className="h-full rounded" style={{ width: `${Math.min(rate, 100)}%`, background: "var(--success)" }} />
                                  </div>
                                  <span className="w-10 shrink-0 text-right font-extrabold text-ink-soft">{rate}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {classGroups.length === 0 && (
              <div className="rounded-lg border border-hairline bg-card text-center">
                <EmptyState message="학생 출결 데이터가 없습니다" />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3">
              <SummaryCard label="선생님" value={`${teacherStats.length}명`} />
              <SummaryCard label="경과 주일" value={`${weeks}주`} />
              <SummaryCard label="평균 출석률" value={`${teacherRate}%`} accent />
            </div>

            <div className="overflow-hidden rounded-lg border border-hairline bg-card">
              <div className="border-b border-hairline bg-surface px-4 py-2.5 text-[15px] font-extrabold text-ink">선생님 출석 현황</div>
              {teacherStats.length === 0 ? (
                <EmptyState message="교사 출석 데이터가 없습니다" hint="선생님 등록 / 출석 메뉴에서 먼저 등록해 주세요" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-hairline text-ink-faint">
                        <th className="px-4 py-2 text-left font-bold">이름</th>
                        <th className="px-2 py-2 text-left font-bold">직책</th>
                        <th className="px-2 py-2 text-center font-bold">출석 / 주일</th>
                        <th className="w-[40%] px-4 py-2 text-left font-bold">출석률</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teacherStats.map((stat) => {
                        const rate = Math.round((stat.present / weeks) * 100);
                        return (
                          <tr key={stat.id} className="border-b border-hairline last:border-b-0">
                            <td className="px-4 py-2 font-extrabold text-ink">{stat.name}</td>
                            <td className="px-2 py-2 font-semibold text-ink-soft">{stat.role || "-"}</td>
                            <td className="px-2 py-2 text-center font-bold text-ink-soft">{stat.present} / {weeks}</td>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <div className="h-3.5 flex-1 overflow-hidden rounded bg-bg-soft">
                                  <div className="h-full rounded" style={{ width: `${Math.min(rate, 100)}%`, background: "var(--accent)" }} />
                                </div>
                                <span className="w-10 shrink-0 text-right font-extrabold text-ink-soft">{rate}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function PageHeader({ deptId, router }: { deptId: string; router: ReturnType<typeof useRouter> }) {
  return (
    <div className="app-subpage-header" style={headerStyle}>
      <HeaderLogo />
      <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
      <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <BarChart3 size={18} strokeWidth={1.8} /> 출결통계
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-hairline bg-card px-4 py-3">
      <div className="text-[12px] font-bold text-ink-faint">{label}</div>
      <div className="mt-1 text-[20px] font-extrabold" style={{ color: accent ? "var(--accent)" : "var(--ink)" }}>{value}</div>
    </div>
  );
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function yearOptions(currentYear: number) {
  const start = 2026;
  const list: number[] = [];
  for (let y = currentYear; y >= Math.min(start, currentYear); y -= 1) list.push(y);
  return list;
}

function classLabel(meta: StudentMeta | undefined) {
  if (!meta?.class_no) return UNASSIGNED;
  return `${meta.grade_year ? `${meta.grade_year}학년 ` : ""}${meta.class_no}반`;
}

function getSundaysInMonth(year: number, month: number): string[] {
  const sundays: string[] = [];
  const date = new Date(year, month - 1, 1);
  while (date.getDay() !== 0) date.setDate(date.getDate() + 1);
  while (date.getMonth() === month - 1) {
    sundays.push(formatDateKey(date));
    date.setDate(date.getDate() + 7);
  }
  return sundays;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shortDate(key: string): string {
  const [, m, d] = key.split("-");
  return `${Number(m)}/${Number(d)}`;
}

const selectClass = "min-h-10 rounded-md border border-hairline bg-card px-2 text-[14px] font-bold text-ink outline-none";

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif", overflowX: "hidden" };
const headerStyle: CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const titleStyle: CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
