"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { BarChart3, CalendarRange, ChevronLeft, ChevronRight, GraduationCap, Lock, UserCheck } from "lucide-react";

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
  mgmt_status: string | null;
  gender: string | null;
  member_id: string | null;
}

interface NewFriendRow {
  id: string;
  join_date: string | null;
  created_at: string;
  promoted: boolean;
  promoted_at: string | null;
}

interface StudentStat {
  id: string;
  name: string;
  classLabel: string;
  orderKey: number;
  isAbsentee: boolean;
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
const ABSENTEE = "장기결석";

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
  // 디폴트: 해당 연도 1월~12월 (아직 12월이 아니어도 연간 조회)
  const [fromMonth, setFromMonth] = useState(1);
  const [toMonth, setToMonth] = useState(12);
  // 월별 보기 커서 (주차별 차트·반별 상세·월별 대시보드 공용)
  const [monthCursor, setMonthCursor] = useState(now.getMonth() + 1);
  // 전체보기: 주차별 차트·반별 상세를 선택 기간 전체(기본 1년치)로 표시
  const [fullView, setFullView] = useState(false);
  const [studentRows, setStudentRows] = useState<AttendRow[]>([]);
  const [teacherRows, setTeacherRows] = useState<TeacherAttendRow[]>([]);
  const [studentMeta, setStudentMeta] = useState<Record<string, StudentMeta>>({});
  const [newFriends, setNewFriends] = useState<NewFriendRow[]>([]);

  const months = useMemo(() => {
    const list: number[] = [];
    for (let m = Math.min(fromMonth, toMonth); m <= Math.max(fromMonth, toMonth); m += 1) list.push(m);
    return list;
  }, [fromMonth, toMonth]);

  // 선택 범위가 바뀌면 월 커서를 범위 안으로 (기본은 현재 월)
  useEffect(() => {
    const lo = Math.min(fromMonth, toMonth);
    const hi = Math.max(fromMonth, toMonth);
    setMonthCursor((cur) => {
      const preferred = year === now.getFullYear() ? now.getMonth() + 1 : lo;
      const base = cur >= lo && cur <= hi ? cur : preferred;
      return Math.min(hi, Math.max(lo, base));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromMonth, toMonth, year]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [metaResp, friendsResp, ...monthResults] = await Promise.all([
      supabase
        .from("edu_students")
        .select("id, class_no, grade_year, order_no, student_no, mgmt_status, gender, member_id")
        .eq("department_id", deptId)
        .eq("is_active", true),
      supabase
        .from("edu_new_friends")
        .select("id, join_date, created_at, promoted, promoted_at")
        .eq("department_id", deptId),
      ...months.flatMap((m) => [
        supabase.rpc("edu_get_student_attendance", { p_dept_id: deptId, p_year: year, p_month: m }),
        supabase.rpc("edu_get_teacher_attendance", { p_dept_id: deptId, p_year: year, p_month: m }),
      ]),
    ]);

    const metaMap: Record<string, StudentMeta> = {};
    ((metaResp.data || []) as StudentMeta[]).forEach((meta) => { metaMap[meta.id] = meta; });

    // 성별은 학생정보 화면과 동일하게 members.gender 우선 (edu_students.gender는 대부분 미입력)
    const memberIds = Object.values(metaMap).map((meta) => meta.member_id).filter(Boolean) as string[];
    if (memberIds.length > 0) {
      const { data: memberRows } = await supabase
        .from("members")
        .select("id, gender")
        .in("id", memberIds);
      const memberGender: Record<string, string | null> = {};
      ((memberRows || []) as { id: string; gender: string | null }[]).forEach((m) => { memberGender[m.id] = m.gender; });
      Object.values(metaMap).forEach((meta) => {
        if (meta.member_id && memberGender[meta.member_id]) meta.gender = memberGender[meta.member_id];
      });
    }
    setStudentMeta(metaMap);
    setNewFriends(((friendsResp.data || []) as NewFriendRow[]));

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

  const todayKey = formatDateKey(new Date());

  // 선택 기간의 전체 일요일 (미래 포함 — 전체보기용)
  const rangeSundays = useMemo(
    () => months.flatMap((m) => getSundaysInMonth(year, m)),
    [year, months],
  );
  // 오늘까지 경과한 일요일
  const elapsedSundays = useMemo(
    () => rangeSundays.filter((key) => key <= todayKey),
    [rangeSundays, todayKey],
  );

  // ── 명부 (재적·장기결석) ────────────────────
  const rosterAll = useMemo(() => Object.values(studentMeta), [studentMeta]);
  const absenteeCount = useMemo(
    () => rosterAll.filter((m) => m.mgmt_status === ABSENTEE).length,
    [rosterAll],
  );
  const enrolledCount = rosterAll.length - absenteeCount; // 재적 = 장기결석 제외

  // ── 학생 통계 (선택 기간 전체 누적) ─────────
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
          isAbsentee: meta?.mgmt_status === ABSENTEE,
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

  // 학생별 출석(출/인) 날짜 셋 — 월별·주차별 파생용
  const presentDates = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const seen = new Set<string>();
    studentRows.forEach((row) => {
      if (!row.attend_date) return;
      const dedupeKey = `${row.student_id}|${row.attend_date}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      if (row.attend_status === "출" || row.attend_status === "인") {
        if (!map.has(row.student_id)) map.set(row.student_id, new Set());
        map.get(row.student_id)!.add(row.attend_date);
      }
    });
    return map;
  }, [studentRows]);

  // 학생별 상태 카운트 (특정 날짜 목록 기준) — 반별 상세의 월/전체 전환용
  const statusByDate = useMemo(() => {
    const map = new Map<string, Map<string, string>>(); // student → date → status
    const seen = new Set<string>();
    studentRows.forEach((row) => {
      if (!row.attend_date) return;
      const dedupeKey = `${row.student_id}|${row.attend_date}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      if (!map.has(row.student_id)) map.set(row.student_id, new Map());
      map.get(row.student_id)!.set(row.attend_date, row.attend_status || "출");
    });
    return map;
  }, [studentRows]);

  // ── 연간(선택 기간) 총괄 대시보드 ───────────
  const totalWeeks = rangeSundays.length;   // 기간 전체 주일 수 (기본 52주)
  const weeks = elapsedSundays.length;      // 경과 주일
  const elapsedPct = totalWeeks > 0 ? Math.round((weeks / totalWeeks) * 100) : 0;

  // 평균 출석률: 재적(장기결석 제외) 대비, 장기결석자 출석분도 계산에서 제외
  const normalPresent = studentStats
    .filter((stat) => !stat.isAbsentee)
    .reduce((sum, stat) => sum + stat.present, 0);
  const deptRate = weeks > 0 && enrolledCount > 0
    ? Math.round((normalPresent / (enrolledCount * weeks)) * 100) : 0;
  const perfectCount = weeks > 0
    ? studentStats.filter((stat) => !stat.isAbsentee && stat.present >= weeks).length : 0;

  // 새친구(해당 연도) + 그중 등반
  const friendJoinKey = (f: NewFriendRow) => (f.join_date || f.created_at.slice(0, 10));
  const yearFriends = useMemo(
    () => newFriends.filter((f) => friendJoinKey(f).startsWith(`${year}-`)),
    [newFriends, year],
  );
  const yearPromoted = yearFriends.filter((f) => f.promoted).length;

  // ── 월별 대시보드 (monthCursor) ─────────────
  const monthSundays = useMemo(() => getSundaysInMonth(year, monthCursor), [year, monthCursor]);
  const monthElapsed = monthSundays.filter((key) => key <= todayKey);

  const weekCards = useMemo(() => {
    return monthSundays.map((date, i) => {
      let present = 0;
      presentDates.forEach((dates, studentId) => {
        if (studentMeta[studentId]?.mgmt_status === ABSENTEE) return;
        if (dates.has(date)) present += 1;
      });
      const weekStart = date;
      const weekEnd = addDays(date, 6);
      const friends = newFriends.filter((f) => {
        const k = friendJoinKey(f);
        return k >= weekStart && k <= weekEnd;
      }).length;
      const promoted = newFriends.filter((f) => {
        if (!f.promoted || !f.promoted_at) return false;
        const k = kstDateOf(f.promoted_at);
        return k >= weekStart && k <= weekEnd;
      }).length;
      return {
        date,
        label: `${i + 1}주차`,
        future: date > todayKey,
        present,
        rate: enrolledCount > 0 ? Math.round((present / enrolledCount) * 100) : 0,
        friends,
        promoted,
      };
    });
  }, [monthSundays, presentDates, studentMeta, newFriends, enrolledCount, todayKey]);

  // 주차별 학년·성별 출석 현황 (해당 월)
  const gradeList = useMemo(() => {
    const set = new Set<number>();
    rosterAll.forEach((m) => { if (m.grade_year) set.add(m.grade_year); });
    return Array.from(set).sort((a, b) => a - b);
  }, [rosterAll]);

  const weekBreakdown = useMemo(() => {
    return monthSundays.map((date, i) => {
      const byGrade: Record<number, number> = {};
      let male = 0;
      let female = 0;
      presentDates.forEach((dates, studentId) => {
        if (!dates.has(date)) return;
        const meta = studentMeta[studentId];
        if (meta?.mgmt_status === ABSENTEE) return;
        if (meta?.grade_year) byGrade[meta.grade_year] = (byGrade[meta.grade_year] || 0) + 1;
        const g = normalizeGender(meta?.gender);
        if (g === "남") male += 1;
        else if (g === "여") female += 1;
      });
      return { date, label: `${i + 1}주차`, future: date > todayKey, byGrade, male, female };
    });
  }, [monthSundays, presentDates, studentMeta, todayKey]);

  // ── 주차별 출석 인원 차트 (월별 기본, 전체보기 시 기간 전체) ──
  const chartSundays = fullView ? rangeSundays : monthSundays;
  const weeklyTrend = useMemo(() => {
    return chartSundays.map((date) => {
      let count = 0;
      presentDates.forEach((dates, studentId) => {
        if (studentMeta[studentId]?.mgmt_status === ABSENTEE) return;
        if (dates.has(date)) count += 1;
      });
      return { date, count, future: date > todayKey };
    });
  }, [chartSundays, presentDates, studentMeta, todayKey]);

  // ── 반별 상세 (주차별 선택에 맞춰: 월 기준, 전체보기 시 기간 전체) ──
  const detailSundays = (fullView ? elapsedSundays : monthElapsed);
  const detailWeeks = detailSundays.length;
  const detailSet = useMemo(() => new Set(detailSundays), [detailSundays]);

  const classGroups = useMemo(() => {
    const groups = new Map<string, Array<StudentStat & { rangeCounts: Record<string, number>; rangePresent: number }>>();
    studentStats.forEach((stat) => {
      const dateStatuses = statusByDate.get(stat.id);
      const rangeCounts: Record<string, number> = { 출: 0, 인: 0, 빠: 0, 결: 0 };
      let rangePresent = 0;
      dateStatuses?.forEach((status, date) => {
        if (!detailSet.has(date)) return;
        rangeCounts[status] = (rangeCounts[status] || 0) + 1;
        if (status === "출" || status === "인") rangePresent += 1;
      });
      const enriched = { ...stat, rangeCounts, rangePresent };
      const label = stat.isAbsentee ? ABSENTEE : stat.classLabel;
      const list = groups.get(label) || [];
      list.push(enriched);
      groups.set(label, list);
    });
    return Array.from(groups.entries())
      .map(([label, list]) => ({
        label,
        list: list.sort((a, b) => a.orderKey - b.orderKey || a.name.localeCompare(b.name, "ko")),
      }))
      .sort((a, b) => {
        if (a.label === ABSENTEE) return 1;
        if (b.label === ABSENTEE) return -1;
        if (a.label === UNASSIGNED) return 1;
        if (b.label === UNASSIGNED) return -1;
        return a.label.localeCompare(b.label, "ko");
      });
  }, [studentStats, statusByDate, detailSet]);

  // ── 교사 통계 ────────────────────────────────
  const teacherPresentDates = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const seen = new Set<string>();
    teacherRows.forEach((row) => {
      if (!row.attend_date || !row.is_present) return;
      const dedupeKey = `${row.teacher_id}|${row.attend_date}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      if (!map.has(row.teacher_id)) map.set(row.teacher_id, new Set());
      map.get(row.teacher_id)!.add(row.attend_date);
    });
    return map;
  }, [teacherRows]);

  const teacherStats = useMemo(() => {
    const map = new Map<string, TeacherStat>();
    teacherRows.forEach((row) => {
      if (!map.has(row.teacher_id)) {
        map.set(row.teacher_id, {
          id: row.teacher_id, name: row.teacher_name, role: row.teacher_role,
          orderNo: row.order_no ?? 999, present: 0,
        });
      }
    });
    map.forEach((stat, id) => {
      const dates = teacherPresentDates.get(id);
      let cnt = 0;
      dates?.forEach((d) => { if (detailSet.has(d)) cnt += 1; });
      stat.present = cnt;
    });
    return Array.from(map.values()).sort((a, b) => a.orderNo - b.orderNo || a.name.localeCompare(b.name, "ko"));
  }, [teacherRows, teacherPresentDates, detailSet]);

  // 교사 연간 요약 (경과 주 기준)
  const teacherYearPresent = useMemo(() => {
    let sum = 0;
    const elapsedSet = new Set(elapsedSundays);
    teacherPresentDates.forEach((dates) => {
      dates.forEach((d) => { if (elapsedSet.has(d)) sum += 1; });
    });
    return sum;
  }, [teacherPresentDates, elapsedSundays]);
  const teacherRate = weeks > 0 && teacherStats.length > 0
    ? Math.round((teacherYearPresent / (teacherStats.length * weeks)) * 100) : 0;

  const teacherTrend = useMemo(() => {
    return chartSundays.map((date) => {
      let count = 0;
      teacherPresentDates.forEach((dates) => { if (dates.has(date)) count += 1; });
      return { date, count, future: date > todayKey };
    });
  }, [chartSundays, teacherPresentDates, todayKey]);

  // ── 월 이동 ──────────────────────────────────
  const monthLo = Math.min(fromMonth, toMonth);
  const monthHi = Math.max(fromMonth, toMonth);
  const moveMonth = (delta: number) => {
    setMonthCursor((cur) => Math.min(monthHi, Math.max(monthLo, cur + delta)));
  };

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
              hint="출결통계는 임원진(전도사·부장·부부장·총무·서기·회계 등)만 이용할 수 있습니다"
            />
          </div>
        </main>
      </div>
    );
  }

  const monthNav = (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => moveMonth(-1)} disabled={monthCursor <= monthLo} className={navBtnClass} aria-label="이전 달">
        <ChevronLeft size={16} strokeWidth={2.2} />
      </button>
      <span className="min-w-[52px] px-1 text-center text-[14px] font-extrabold text-ink">{monthCursor}월</span>
      <button type="button" onClick={() => moveMonth(1)} disabled={monthCursor >= monthHi} className={navBtnClass} aria-label="다음 달">
        <ChevronRight size={16} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        onClick={() => setFullView((v) => !v)}
        className="ml-1 inline-flex min-h-8 items-center gap-1 rounded-md border px-2.5 text-[12px] font-extrabold"
        style={{
          borderColor: fullView ? "var(--accent)" : "var(--hairline)",
          background: fullView ? "var(--accent-soft)" : "var(--card)",
          color: fullView ? "var(--accent-strong)" : "var(--ink-soft)",
        }}
      >
        <CalendarRange size={13} strokeWidth={2.2} /> 전체보기
      </button>
    </div>
  );

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
            {/* ── 연간 총괄 대시보드 ── */}
            <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3">
              <SummaryCard label="재적 학생" value={`${enrolledCount}명`} sub="장기결석 제외" />
              <SummaryCard label="장기결석" value={`${absenteeCount}명`} />
              <SummaryCard label="경과 주일" value={`${weeks}주/${totalWeeks}주`} sub={`${elapsedPct}%`} />
              <SummaryCard label="평균 출석률" value={`${deptRate}%`} sub="재적 대비 · 장기결석 제외" accent />
              <SummaryCard label="개근 학생" value={`${perfectCount}명`} />
              <SummaryCard label="새친구" value={`${yearFriends.length}명`} sub={`등반 ${yearPromoted}명`} />
            </div>

            {/* ── 월별 대시보드 ── */}
            <div className="mb-4 rounded-lg border border-hairline bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface px-4 py-2.5">
                <div className="text-[15px] font-extrabold text-ink">{monthCursor}월 통계</div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveMonth(-1)} disabled={monthCursor <= monthLo} className={navBtnClass} aria-label="이전 달">
                    <ChevronLeft size={16} strokeWidth={2.2} />
                  </button>
                  <button type="button" onClick={() => moveMonth(1)} disabled={monthCursor >= monthHi} className={navBtnClass} aria-label="다음 달">
                    <ChevronRight size={16} strokeWidth={2.2} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
                {weekCards.map((week) => (
                  <div
                    key={week.date}
                    className="rounded-lg border border-hairline px-3 py-2.5"
                    style={{ background: "var(--surface)", opacity: week.future ? 0.55 : 1 }}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-[13px] font-extrabold text-ink">{week.label}</span>
                      <span className="text-[11px] font-bold text-ink-faint">{shortDate(week.date)}{week.future ? " 예정" : ""}</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[12px] font-bold text-ink-soft">
                      <span>출석 <b style={{ color: "var(--success)" }}>{week.present}명</b></span>
                      <span>출석률 <b style={{ color: "var(--accent)" }}>{week.rate}%</b></span>
                      <span>새친구 <b style={{ color: "var(--warning)" }}>{week.friends}명</b></span>
                      <span>등반 <b style={{ color: "var(--accent-strong)" }}>{week.promoted}명</b></span>
                    </div>
                  </div>
                ))}
              </div>

              {/* 주차별 학년·성별 출석 현황 */}
              <div className="border-t border-hairline px-3 pb-3 pt-2.5">
                <div className="mb-2 text-[13px] font-extrabold text-ink-soft">주차별 학년·성별 출석 현황</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
                    <thead>
                      <tr className="border-b border-hairline text-ink-faint">
                        <th className="px-2 py-1.5 text-left font-bold">주차</th>
                        {gradeList.map((grade) => (
                          <th key={grade} className="px-2 py-1.5 text-center font-bold">{grade}학년</th>
                        ))}
                        <th className="px-2 py-1.5 text-center font-bold">남</th>
                        <th className="px-2 py-1.5 text-center font-bold">여</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekBreakdown.map((week) => (
                        <tr key={week.date} className="border-b border-hairline last:border-b-0" style={{ opacity: week.future ? 0.5 : 1 }}>
                          <td className="px-2 py-1.5 font-extrabold text-ink">{week.label} <span className="text-[11px] font-bold text-ink-faint">{shortDate(week.date)}</span></td>
                          {gradeList.map((grade) => (
                            <td key={grade} className="px-2 py-1.5 text-center font-bold text-ink-soft">{week.byGrade[grade] || 0}</td>
                          ))}
                          <td className="px-2 py-1.5 text-center font-bold text-ink-soft">{week.male}</td>
                          <td className="px-2 py-1.5 text-center font-bold text-ink-soft">{week.female}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-1.5 text-[11px] leading-4 text-ink-faint">성별 미입력 학생은 남/여 합계에 포함되지 않습니다.</div>
              </div>
            </div>

            {/* ── 주차별 출석 인원 (월별 기본 · 전체보기) ── */}
            <div className="mb-4 rounded-lg border border-hairline bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[15px] font-extrabold text-ink">
                  주차별 출석 인원 <span className="ml-1 text-[12px] font-bold text-ink-faint">{fullView ? "기간 전체" : `${monthCursor}월`}</span>
                </div>
                {monthNav}
              </div>
              <div className="flex flex-col gap-1.5">
                {weeklyTrend.map(({ date, count, future }) => (
                  <div key={date} className="flex items-center gap-2" style={{ opacity: future ? 0.45 : 1 }}>
                    <span className="w-[74px] shrink-0 text-[12px] font-bold text-ink-faint">{shortDate(date)}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-bg-soft">
                      <div
                        className="h-full rounded"
                        style={{ width: `${enrolledCount > 0 ? Math.round((count / enrolledCount) * 100) : 0}%`, background: "var(--accent)" }}
                      />
                    </div>
                    <span className="w-[52px] shrink-0 text-right text-[12px] font-bold text-ink-soft">{future ? "예정" : `${count}명`}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── 반별 상세 (주차별 선택 기준) ── */}
            <div className="mb-2 text-[13px] font-bold text-ink-faint">
              반별 상세 — {fullView ? "기간 전체" : `${monthCursor}월`} 기준 · 경과 {detailWeeks}주
            </div>
            {classGroups.map((group) => {
              const isAbsenteeGroup = group.label === ABSENTEE;
              const groupPresent = group.list.reduce((sum, stat) => sum + stat.rangePresent, 0);
              const groupRate = !isAbsenteeGroup && group.list.length > 0 && detailWeeks > 0
                ? Math.round((groupPresent / (group.list.length * detailWeeks)) * 100) : 0;
              return (
                <div key={group.label} className="mb-4 overflow-hidden rounded-lg border border-hairline bg-card">
                  <div className="flex items-center justify-between border-b border-hairline bg-surface px-4 py-2.5">
                    <div className="text-[15px] font-extrabold text-ink">
                      {group.label} <span className="ml-1 text-[13px] font-bold text-ink-faint">{group.list.length}명</span>
                    </div>
                    {!isAbsenteeGroup && (
                      <div className="text-[14px] font-extrabold" style={{ color: "var(--accent)" }}>출석률 {groupRate}%</div>
                    )}
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
                          const rate = detailWeeks > 0 ? Math.round((stat.rangePresent / detailWeeks) * 100) : 0;
                          return (
                            <tr key={stat.id} className="border-b border-hairline last:border-b-0">
                              <td className="px-4 py-2 font-extrabold text-ink">{stat.name}</td>
                              {STATUS_META.map((status) => (
                                <td key={status.key} className="px-2 py-2 text-center font-bold" style={{ color: stat.rangeCounts[status.key] ? status.color : "var(--ink-faint)" }}>
                                  {stat.rangeCounts[status.key] || 0}
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
            {/* ── 선생님: 연간 요약 ── */}
            <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3">
              <SummaryCard label="선생님" value={`${teacherStats.length}명`} />
              <SummaryCard label="경과 주일" value={`${weeks}주/${totalWeeks}주`} sub={`${elapsedPct}%`} />
              <SummaryCard label="평균 출석률" value={`${teacherRate}%`} accent />
            </div>

            {/* ── 선생님: 주차별 출석 인원 ── */}
            <div className="mb-4 rounded-lg border border-hairline bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[15px] font-extrabold text-ink">
                  주차별 선생님 출석 <span className="ml-1 text-[12px] font-bold text-ink-faint">{fullView ? "기간 전체" : `${monthCursor}월`}</span>
                </div>
                {monthNav}
              </div>
              <div className="flex flex-col gap-1.5">
                {teacherTrend.map(({ date, count, future }) => (
                  <div key={date} className="flex items-center gap-2" style={{ opacity: future ? 0.45 : 1 }}>
                    <span className="w-[74px] shrink-0 text-[12px] font-bold text-ink-faint">{shortDate(date)}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-bg-soft">
                      <div
                        className="h-full rounded"
                        style={{ width: `${teacherStats.length > 0 ? Math.round((count / teacherStats.length) * 100) : 0}%`, background: "var(--accent)" }}
                      />
                    </div>
                    <span className="w-[52px] shrink-0 text-right text-[12px] font-bold text-ink-soft">{future ? "예정" : `${count}명`}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── 선생님 출석 현황 (주차별 선택 기준) ── */}
            <div className="overflow-hidden rounded-lg border border-hairline bg-card">
              <div className="border-b border-hairline bg-surface px-4 py-2.5 text-[15px] font-extrabold text-ink">
                선생님 출석 현황 <span className="ml-1 text-[12px] font-bold text-ink-faint">{fullView ? "기간 전체" : `${monthCursor}월`} · 경과 {detailWeeks}주</span>
              </div>
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
                        const rate = detailWeeks > 0 ? Math.round((stat.present / detailWeeks) * 100) : 0;
                        return (
                          <tr key={stat.id} className="border-b border-hairline last:border-b-0">
                            <td className="px-4 py-2 font-extrabold text-ink">{stat.name}</td>
                            <td className="px-2 py-2 font-semibold text-ink-soft">{stat.role || "-"}</td>
                            <td className="px-2 py-2 text-center font-bold text-ink-soft">{stat.present} / {detailWeeks}</td>
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
      <button className="app-header-back" onClick={() => router.back()} style={backBtnStyle}>← 뒤로</button>
      <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <BarChart3 size={18} strokeWidth={1.8} /> 출결통계
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-hairline bg-card px-4 py-3">
      <div className="text-[12px] font-bold text-ink-faint">{label}</div>
      <div className="mt-1 text-[20px] font-extrabold" style={{ color: accent ? "var(--accent)" : "var(--ink)" }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] font-bold text-ink-faint">{sub}</div>}
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

function normalizeGender(value: string | null | undefined): "남" | "여" | null {
  if (value === "M" || value === "남" || value === "male") return "남";
  if (value === "F" || value === "여" || value === "female") return "여";
  return null;
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

function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatDateKey(d);
}

// timestamptz → KST 날짜 (등반 확정 시각의 주차 판정용)
function kstDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shortDate(key: string): string {
  const [, m, d] = key.split("-");
  return `${Number(m)}/${Number(d)}`;
}

const selectClass = "min-h-10 rounded-md border border-hairline bg-card px-2 text-[14px] font-bold text-ink outline-none";
const navBtnClass = "inline-flex h-8 w-8 items-center justify-center rounded-md border border-hairline bg-card text-ink-soft disabled:opacity-35";

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif", overflowX: "hidden" };
const headerStyle: CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const titleStyle: CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
