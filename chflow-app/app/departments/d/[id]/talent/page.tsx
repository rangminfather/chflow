"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import DeptMasterClassPicker from "@/components/DeptMasterClassPicker";
import { supabase } from "@/lib/supabase";
import { photoThumb } from "@/lib/photo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Check, ChevronDown, Medal, PiggyBank, Star, X } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { kidDefaultFace, kidFaceTransform, isKidDefaultFace } from "@/lib/kidAvatar";
import { fetchDeptClassScope, type DeptClassOption } from "@/lib/deptClassScope";
import {
  type TalentReset,
  fetchTalentResets,
  periodStartAfter,
  PERIOD_END_MAX,
  formatResetDate,
} from "@/lib/talentReset";

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
  class_no: string | null;
  gender?: string | null;
  photo_url?: string | null;
}

interface AttendRow {
  student_id: string;
  attend_date: string | null;
  attend_status: string;
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
  rule_key: string;
  points: number;
}

interface OtherRecord {
  id: string;
  student_id: string;
  record_date: string;
  pts_other: number;
  note: string | null;
}

// 출석부 boolean 자동연동 키 — 통장에선 '출석'만 자동 행으로 표시, 나머지 자동키는 칩에서 제외
const SYSTEM_AUTO_KEYS = new Set(["attendance", "prayer", "church_school", "worship", "lesson", "bible"]);
// 새친구등반 — 수동 칩이 아니라 등반 확정(반자동)으로 인도자에게 자동 적립 → 칩에서 제외
const PROMOTION_KEY = "new_friend_promotion";

// 부서 미설정 시 최초 시드용 기본 weekly 규칙 (점수는 부서별 편집 가능 · 초등1부 기준값)
const DEFAULT_WEEKLY_RULES = [
  { rule_key: "attendance", label: "출석", points: 2, order_no: 0 },
  { rule_key: "bible_book", label: "성경책 지참", points: 1, order_no: 1 },
  { rule_key: "verse_memory", label: "요절암송", points: 2, order_no: 2 },
  { rule_key: "verse_presentation", label: "요절암송발표", points: 5, order_no: 3 },
  { rule_key: "bulletin_quiz", label: "주보퀴즈", points: 2, order_no: 4 },
  { rule_key: "lesson_homework", label: "숙제", points: 2, order_no: 5 },
  { rule_key: "evangelism", label: "전도", points: 5, order_no: 6 },
  { rule_key: "representative_prayer", label: "대표기도", points: 5, order_no: 7 },
  { rule_key: "new_friend_promotion", label: "새친구등반", points: 5, order_no: 8 },
];

// 항목별 이모지 — 아이들 화면이라 친근하게 (콘텐츠성 이모지, lucide 예외)
const RULE_EMOJI: Record<string, string> = {
  attendance: "🙋",
  bible_book: "📖",
  verse_memory: "💭",
  verse_presentation: "🎤",
  representative_prayer: "🙏",
  evangelism: "📣",
  new_friend_promotion: "🤝",
  lesson_homework: "✏️",
};
const OTHER_EMOJI = "🎁";

export default function TalentPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const params = useParams();
  const deptId = params.id as string;
  const weekCardRefs = useRef<Record<string, HTMLElement | null>>({});

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [myTeacherId, setMyTeacherId] = useState<string | null>(null);
  const [myClassNos, setMyClassNos] = useState<string[]>([]);
  const [myClassName, setMyClassName] = useState("");
  const [isMaster, setIsMaster] = useState(false);
  const [masterClasses, setMasterClasses] = useState<DeptClassOption[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<AttendRow[]>([]);
  const [rules, setRules] = useState<TalentRule[]>([]);
  const [extras, setExtras] = useState<WeeklyExtra[]>([]);
  const [others, setOthers] = useState<OtherRecord[]>([]);
  const [cumulative, setCumulative] = useState<Record<string, number>>({}); // 학생별 누적 잔액 (마지막 리셋 이후)
  const [lastReset, setLastReset] = useState<TalentReset | null>(null); // 달란트 잔치 정산 리셋 (기록/취소는 행정관리 출결통합조회에서)
  const [saving, setSaving] = useState("");
  const [toast, setToast] = useState("");
  const [otherModal, setOtherModal] = useState<{ student: Student; date: string } | null>(null);
  const [otherNote, setOtherNote] = useState("");
  const [otherAmount, setOtherAmount] = useState("1");
  const [otherSaving, setOtherSaving] = useState(false);
  const [expandedStudents, setExpandedStudents] = useState<Record<string, boolean>>({});

  const sundays = useMemo(() => getSundaysInMonth(year, month), [year, month]);
  const currentSundayKey = useMemo(() => getCurrentSundayKey(), []);
  const todayWeekIndex = useMemo(() => getTodayWeekIndex(sundays), [sundays]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      const scope = await fetchDeptClassScope(deptId, user.id);
      const selectedClassNo = scope.isMaster ? scope.classes[0]?.classNo || "" : "";
      setMyClassNos(scope.isMaster ? (selectedClassNo ? [selectedClassNo] : []) : scope.ownClassNos);
      setMyTeacherId(scope.teacherId);
      setIsMaster(scope.isMaster);
      setMasterClasses(scope.classes);
      if (selectedClassNo) setMyClassName(selectedClassNo);
      setAuthChecked(true);
    })();
  }, [deptId, router]);

  useEffect(() => {
    if (!authChecked) return;
    if (!myTeacherId && !isMaster) {
      setStudents([]);
      setLoading(false);
      return;
    }
    if (myTeacherId || myClassNos.length > 0) loadAll(isMaster ? null : myTeacherId, myClassNos);
    else {
      setStudents([]);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, isMaster, myTeacherId, myClassNos, year, month]);

  useEffect(() => {
    if (loading || todayWeekIndex < 0) return;

    const target = weekCardRefs.current[sundays[todayWeekIndex]];
    const timer = window.setTimeout(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [loading, students.length, sundays, todayWeekIndex]);

  async function loadAll(teacherId: string | null, classNos: string[]) {
    setLoading(true);

    const classStudents = await loadStudents(teacherId, classNos);
    const studentIds = classStudents.map((student) => student.id);
    const loadedRules = await ensureDefaultRules();

    const [{ data: attRows }, { data: extraRows }] = await Promise.all([
      supabase.rpc("edu_get_student_attendance", {
        p_dept_id: deptId,
        p_year: year,
        p_month: month,
      }),
      supabase.rpc("get_dept_weekly_extra", {
        p_dept_id: deptId,
        p_year: year,
        p_month: month,
      }),
    ]);

    setRules(loadedRules);
    setAttendance(((attRows || []) as AttendRow[]).filter((row) => studentIds.includes(row.student_id)));
    setExtras(((extraRows || []) as WeeklyExtra[]).filter((row) => studentIds.includes(row.student_id)));
    await loadOtherRecords(studentIds);
    const resets = await fetchTalentResets(deptId);
    setLastReset(resets[0] || null);
    await loadCumulative(classStudents, resets[0] || null);
    setLoading(false);
  }

  // 학생별 누적 잔액 = 자동적립(출석×규칙 + 주간적립×규칙) + 기타(pts_other)
  // 마지막 리셋(달란트 잔치 정산) 다음날부터 적립분만 합산
  async function loadCumulative(classStudents: Student[], reset: TalentReset | null) {
    const ids = classStudents.map((student) => student.id);
    if (ids.length === 0) {
      setCumulative({});
      return;
    }

    const periodStart = periodStartAfter(reset || undefined);

    // 자동 적립 — 학생별 RPC(리셋 이후 기간). 활성 weekly 규칙 전체(출석 자동 + 수동 칩)를 점수 반영해 합산.
    const autoEntries = await Promise.all(
      classStudents.map(async (student) => {
        const { data } = await supabase.rpc("get_student_auto_talent_range", {
          p_student_id: student.id,
          p_date_from: periodStart,
          p_date_to: PERIOD_END_MAX,
        });
        const sum = ((data || []) as { total: number }[])
          .reduce((acc, row) => acc + (row.total || 0), 0);
        return [student.id, sum] as const;
      })
    );

    // 기타(pts_other) 리셋 이후 합
    const { data: recs } = await supabase
      .from("edu_talent_records")
      .select("student_id, pts_other")
      .eq("department_id", deptId)
      .in("student_id", ids)
      .gte("record_date", periodStart)
      .gt("pts_other", 0);

    const otherSum: Record<string, number> = {};
    ((recs || []) as { student_id: string; pts_other: number }[]).forEach((row) => {
      otherSum[row.student_id] = (otherSum[row.student_id] || 0) + (row.pts_other || 0);
    });

    // 공과퀴즈 달란트(서기 입력) 리셋 이후 합
    const { data: quizRows } = await supabase
      .from("edu_quiz_talent")
      .select("student_id, points")
      .eq("department_id", deptId)
      .in("student_id", ids)
      .gte("quiz_date", periodStart);

    const quizSum: Record<string, number> = {};
    ((quizRows || []) as { student_id: string; points: number }[]).forEach((row) => {
      quizSum[row.student_id] = (quizSum[row.student_id] || 0) + (row.points || 0);
    });

    const map: Record<string, number> = {};
    autoEntries.forEach(([id, sum]) => { map[id] = sum + (otherSum[id] || 0) + (quizSum[id] || 0); });
    setCumulative(map);
  }

  async function loadStudents(teacherId: string | null, classNos: string[]) {
    const { data } = await supabase.rpc("edu_list_students", { p_dept_id: deptId });
    const all = (data || []) as Student[];
    const mine = all
      .filter((student) => (Boolean(teacherId) && student.teacher_id === teacherId) || Boolean(student.class_no && classNos.includes(student.class_no)))
      .sort((a, b) => (a.order_no || 0) - (b.order_no || 0) || (a.student_no || 0) - (b.student_no || 0));
    const memberIds = mine.map((student) => student.member_id).filter(Boolean) as string[];
    const memberInfo: Record<string, { gender: string | null; photo_url: string | null }> = {};

    if (memberIds.length > 0) {
      const { data: members } = await supabase
        .from("members")
        .select("id, gender, photo_url")
        .in("id", memberIds);

      (members || []).forEach((member: { id: string; gender: string | null; photo_url: string | null }) => {
        memberInfo[member.id] = { gender: member.gender, photo_url: member.photo_url };
      });
    }

    const enriched = mine.map((student) => ({
      ...student,
      gender: student.member_id ? memberInfo[student.member_id]?.gender ?? null : null,
      photo_url: student.member_id ? memberInfo[student.member_id]?.photo_url ?? null : null,
    }));

    setStudents(enriched);

    if (enriched.length > 0) {
      const { data: cls } = await supabase
        .from("edu_students")
        .select("class_no")
        .eq("id", enriched[0].id)
        .maybeSingle();
      setMyClassName(cls?.class_no || "");
    } else {
      setMyClassName("");
    }

    return enriched;
  }

  async function ensureDefaultRules() {
    const { data: listed } = await supabase.rpc("list_talent_rules", { p_dept_id: deptId });
    const current = ((listed || []) as TalentRule[]).filter((rule) => rule.rule_kind === "weekly");

    if (current.length === 0) {
      await supabase.from("edu_talent_rules").insert(
        DEFAULT_WEEKLY_RULES.map((rule) => ({
          department_id: deptId,
          rule_kind: "weekly",
          rule_key: rule.rule_key,
          label: rule.label,
          points: rule.points,
          order_no: rule.order_no,
          is_active: true,
        }))
      );
      const { data: refreshed } = await supabase.rpc("list_talent_rules", { p_dept_id: deptId });
      return ((refreshed || []) as TalentRule[]).filter((rule) => rule.rule_kind === "weekly" && rule.is_active);
    }

    return current.filter((rule) => rule.is_active);
  }

  async function loadOtherRecords(studentIds: string[]) {
    if (studentIds.length === 0 || sundays.length === 0) {
      setOthers([]);
      return;
    }

    const firstDate = sundays[0];
    const lastDate = getMonthEndKey(year, month);
    const { data } = await supabase
      .from("edu_talent_records")
      .select("id, student_id, record_date, pts_other, note")
      .eq("department_id", deptId)
      .in("student_id", studentIds)
      .gte("record_date", firstDate)
      .lte("record_date", lastDate)
      .gt("pts_other", 0)
      .order("created_at", { ascending: true });

    setOthers((data || []) as OtherRecord[]);
  }

  const attendanceMap = useMemo(() => {
    const map: Record<string, Record<string, AttendRow>> = {};
    attendance.forEach((row) => {
      if (!row.attend_date) return;
      if (!map[row.student_id]) map[row.student_id] = {};
      map[row.student_id][row.attend_date] = row;
    });
    return map;
  }, [attendance]);

  const extraMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    extras.forEach((row) => {
      map[extraKey(row.student_id, row.attend_date, row.rule_id)] = true;
    });
    return map;
  }, [extras]);

  const otherMap = useMemo(() => {
    const map: Record<string, OtherRecord[]> = {};
    others.forEach((record) => {
      const key = `${record.student_id}_${record.record_date}`;
      if (!map[key]) map[key] = [];
      map[key].push(record);
    });
    return map;
  }, [others]);

  const ruleMap = useMemo(() => {
    const map: Record<string, TalentRule> = {};
    rules.forEach((rule) => {
      map[rule.rule_key] = rule;
    });
    return map;
  }, [rules]);

  // 통장 체크 칩 = 활성 weekly 규칙 중 출석부 자동연동키·새친구등반(반자동) 제외
  const checkRules = useMemo(
    () =>
      rules
        .filter(
          (rule) =>
            rule.rule_kind === "weekly" &&
            rule.is_active &&
            !SYSTEM_AUTO_KEYS.has(rule.rule_key) &&
            rule.rule_key !== PROMOTION_KEY
        )
        .sort((a, b) => (a.order_no || 0) - (b.order_no || 0)),
    [rules]
  );

  function getAttendance(studentId: string, date: string) {
    return attendanceMap[studentId]?.[date];
  }

  function isPresent(studentId: string, date: string) {
    return getAttendance(studentId, date)?.attend_status === "출";
  }

  function isChecked(studentId: string, date: string, rule: TalentRule) {
    return !!extraMap[extraKey(studentId, date, rule.id)];
  }

  function getOthers(studentId: string, date: string) {
    return otherMap[`${studentId}_${date}`] || [];
  }

  function getOtherTotal(studentId: string, date: string) {
    return getOthers(studentId, date).reduce((sum, record) => sum + record.pts_other, 0);
  }

  function studentWeekTotal(studentId: string, date: string) {
    const attendancePoints = isPresent(studentId, date) ? getRulePoints("attendance") : 0;
    const checkPoints = checkRules.reduce(
      (sum, rule) => sum + (isChecked(studentId, date, rule) ? rule.points : 0),
      0
    );
    return attendancePoints + checkPoints + getOtherTotal(studentId, date);
  }

  function weekTotal(date: string) {
    return students.reduce((sum, student) => sum + studentWeekTotal(student.id, date), 0);
  }

  function getRulePoints(ruleKey: string) {
    return ruleMap[ruleKey]?.points ?? 1;
  }

  async function toggleWeeklyItem(student: Student, date: string, rule: TalentRule) {
    if (getWeekEditState(date, currentSundayKey) !== "current") return;

    const key = extraKey(student.id, date, rule.id);
    const checked = !extraMap[key];
    setSaving(key);

    const { error } = await supabase.rpc("toggle_weekly_extra", {
      p_student_id: student.id,
      p_dept_id: deptId,
      p_date: date,
      p_rule_id: rule.id,
      p_checked: checked,
    });

    setSaving("");
    if (error) {
      showToast("저장 실패: " + error.message);
      return;
    }

    setExtras((prev) => {
      if (!checked) return prev.filter((row) => extraKey(row.student_id, row.attend_date, row.rule_id) !== key);
      return [
        ...prev,
        {
          student_id: student.id,
          attend_date: date,
          rule_id: rule.id,
          rule_key: rule.rule_key,
          points: rule.points,
        },
      ];
    });

    // 누적 잔액 실시간 반영
    setCumulative((prev) => ({
      ...prev,
      [student.id]: (prev[student.id] || 0) + (checked ? rule.points : -rule.points),
    }));
  }

  function openOther(student: Student, date: string) {
    if (getWeekEditState(date, currentSundayKey) !== "current") return;
    setOtherModal({ student, date });
    setOtherAmount("1");
    setOtherNote("");
  }

  async function saveOther() {
    if (!otherModal) return;
    if (getWeekEditState(otherModal.date, currentSundayKey) !== "current") return;

    const amount = Math.max(0, Number(otherAmount) || 0);
    if (amount <= 0) {
      showToast("달란트 수량은 1 이상 입력하세요");
      return;
    }
    setOtherSaving(true);

    try {
      const { error } = await supabase.rpc("edu_save_talent", {
        p_id: null,
        p_dept_id: deptId,
        p_student_id: otherModal.student.id,
        p_date: otherModal.date,
        p_attendance: 0,
        p_offering: 0,
        p_evangelism: 0,
        p_memory: 0,
        p_win: 0,
        p_other: amount,
        p_note: otherNote.trim() || "기타",
      });
      if (error) throw error;

      await loadOtherRecords(students.map((student) => student.id));

      setCumulative((prev) => ({
        ...prev,
        [otherModal.student.id]: (prev[otherModal.student.id] || 0) + amount,
      }));

      setOtherAmount("1");
      setOtherNote("");
      showToast("직접입력이 추가되었습니다");
    } catch (error) {
      showToast("저장 실패: " + (error as Error).message);
    } finally {
      setOtherSaving(false);
    }
  }

  async function deleteOther(record: OtherRecord) {
    if (!otherModal || getWeekEditState(otherModal.date, currentSundayKey) !== "current") return;
    const ok = await confirm(`${record.note || "기타"} +${record.pts_other} 달란트를 삭제할까요?`, { okText: "삭제" });
    if (!ok) return;
    setOtherSaving(true);
    try {
      const { error } = await supabase.rpc("edu_delete_talent", { p_id: record.id });
      if (error) throw error;
      await loadOtherRecords(students.map((student) => student.id));
      setCumulative((prev) => ({
        ...prev,
        [record.student_id]: (prev[record.student_id] || 0) - record.pts_other,
      }));
      showToast("직접입력이 삭제되었습니다");
    } catch (error) {
      showToast("삭제 실패: " + (error as Error).message);
    } finally {
      setOtherSaving(false);
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function selectMasterClass(classNo: string) {
    setMyClassName(classNo);
    setMyClassNos(classNo ? [classNo] : []);
  }

  if (!authChecked) return <LoadingView full />;

  if (!myTeacherId && !isMaster) {
    return (
      <div style={pageStyle}>
        <div className="app-subpage-header" style={headerStyle}>
          <HeaderLogo />
          <button className="app-header-back" onClick={() => router.back()} style={backBtnStyle}>← 뒤로</button>
          <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}><Medal size={18} strokeWidth={1.8} /> 달란트통장</div>
          <div className="hidden md:block" style={{ width: 80 }} />
        </div>
        <div className="mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-hairline bg-card text-center">
            <EmptyState message="본인이 담임으로 등록된 반이 없습니다" hint="부장 또는 전도사에게 담임 등록을 요청하세요." />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <style>{`
        .coin-chip { transition: background 0.16s, color 0.16s, box-shadow 0.16s, transform 0.12s; }
        .coin-chip:active:not(:disabled) { transform: scale(0.96); }
        .coin-on { animation: coinPop 0.22s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes coinPop {
          0%   { transform: scale(0.85); }
          60%  { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
        .kid-avatar { transition: transform 0.16s ease; }
        .student-card:hover .kid-avatar { transform: scale(1.06); }
      `}</style>

      <div className="app-subpage-header" style={headerStyle}>
        <HeaderLogo />
        <button className="app-header-back" onClick={() => router.back()} style={backBtnStyle}>← 뒤로</button>
        <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Medal size={18} strokeWidth={1.8} /> 달란트통장 {myClassName && <span style={{ color: "var(--accent)", marginLeft: 6 }}>{myClassName}반</span>}
        </div>
        <div className="hidden md:block" style={{ width: 80 }} />
      </div>

      <main className="mx-auto w-full max-w-6xl px-0 py-4 md:px-4">
        {isMaster && (
          <DeptMasterClassPicker
            classes={masterClasses}
            value={myClassNos[0] || ""}
            onChange={selectMasterClass}
          />
        )}
        {/* 파스텔 일러스트 배너 */}
        <section className="mx-4 mb-4 md:mx-0">
          <div
            className="rounded-[22px] border border-hairline bg-card px-4 py-3"
            style={{ boxShadow: "0 4px 16px rgba(43,39,34,0.06)" }}
          >
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button onClick={() => prevMonth(year, month, setYear, setMonth)} style={navBtnStyle}>이전</button>
              <div className="min-w-[140px] text-center text-[19px] font-extrabold text-ink">
                {year}년 {month}월
              </div>
              <button onClick={() => nextMonth(year, month, setYear, setMonth)} style={navBtnStyle}>다음</button>
              <div className="w-full text-center text-[13px] font-semibold text-ink-faint">
                주일 {todayWeekIndex >= 0 ? todayWeekIndex + 1 : Math.min(1, sundays.length)}주차/{sundays.length}주차
              </div>
            </div>

            <div className="mt-3 border-t border-hairline pt-3 text-center">
              <h1 className="inline-flex items-center justify-center gap-2 text-[24px] font-extrabold leading-tight" style={{ color: "var(--ink)" }}>
                <Medal size={22} strokeWidth={1.9} />
                달란트통장
              </h1>
              {myClassName && (
                <div className="mt-1 text-[13px] font-bold" style={{ color: "var(--accent)" }}>
                  {myClassName}반
                </div>
              )}
            </div>

            {/* 잔치 정산 리셋 안내 (리셋 기록·취소는 행정관리 > 출결통합조회 > 달란트체크에서) */}
            {lastReset && (
              <div className="mt-3 border-t border-hairline pt-3 text-center text-[12px] font-semibold text-ink-faint">
                총 달란트 = {formatResetDate(lastReset.reset_date)} 잔치 정산 이후 적립분
              </div>
            )}
          </div>
        </section>

        {loading ? (
          <div className="mx-4 rounded-lg border border-hairline bg-card py-16 text-center text-[17px] text-ink-faint md:mx-0">
            불러오는 중...
          </div>
        ) : students.length === 0 ? (
          <div className="mx-4 rounded-lg border border-hairline bg-card py-16 text-center text-[17px] text-ink-faint md:mx-0">
            담당 반 학생이 없습니다.
          </div>
        ) : (
          <div className="flex overflow-x-auto snap-x snap-mandatory gap-4 px-[8vw] pb-2 scrollbar-hide md:grid md:grid-cols-2 lg:grid-cols-3 md:overflow-visible md:px-0 md:pb-0">
            {sundays.map((date, index) => {
              const editState = getWeekEditState(date, currentSundayKey);
              const isEditableWeek = editState === "current";
              const isTodayWeek = index === todayWeekIndex;
              const dateTotal = weekTotal(date);

              return (
                <article
                  key={date}
                  ref={(node) => { weekCardRefs.current[date] = node; }}
                  className="shrink-0 w-[84vw] snap-center overflow-hidden rounded-3xl md:w-auto"
                  style={{
                    background: "var(--card)",
                    border: isTodayWeek ? "1.5px solid color-mix(in srgb, var(--brass) 60%, transparent)" : "1px solid var(--hairline)",
                    boxShadow: isTodayWeek
                      ? "0 12px 30px color-mix(in srgb, var(--brass) 20%, transparent)"
                      : "0 4px 16px rgba(43,39,34,0.06)",
                  }}
                >
                  {/* 동전통장 표지 */}
                  <header
                    className="flex items-center justify-between gap-3 px-4 py-4 text-white"
                    style={{ background: COIN_GRAD }}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl" style={{ background: "rgba(255,255,255,0.22)" }}>
                        <PiggyBank size={20} strokeWidth={2} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[20px] font-extrabold leading-tight">
                          {index + 1}{"\uC8FC\uCC28"}
                          {isTodayWeek && (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: "rgba(255,255,255,0.28)" }}>
                              <Star size={11} fill="currentColor" strokeWidth={0} /> {"\uC624\uB298"}
                            </span>
                          )}
                          {!isEditableWeek && (
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: "rgba(255,255,255,0.24)" }}>
                              {editState === "past" ? "\uC218\uC815 \uB9C8\uAC10" : "\uC608\uC815"}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[12px] font-semibold" style={{ opacity: 0.9 }}>{formatMD(date)} {"\uC8FC\uC77C"}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end leading-tight">
                      <span className="text-[10px] font-bold" style={{ opacity: 0.9 }}>{"\uC774\uBC88\uC8FC"}</span>
                      <span className="text-[20px] font-extrabold">+{dateTotal}</span>
                    </div>
                  </header>
                  <div style={{ borderTop: "2px dotted color-mix(in srgb, var(--brass) 45%, transparent)" }} />

                  <section className="flex flex-col gap-2.5 px-3.5 py-3.5">
                    {students.map((student) => {
                      const studentTotal = studentWeekTotal(student.id, date);
                      const present = isPresent(student.id, date);
                      const otherRecords = getOthers(student.id, date);
                      const otherTotal = getOtherTotal(student.id, date);
                      const rowKey = `${date}_${student.id}`;
                      const expanded = !!expandedStudents[rowKey];

                      return (
                        <div
                          key={student.id}
                          className="student-card rounded-3xl p-3.5"
                          style={{ background: "var(--surface)", border: "1.5px solid var(--hairline)" }}
                        >
                          <div className="mb-2.5 flex items-center gap-2.5">
                            <Avatar student={student} />
                            <div className="min-w-0 flex-1 truncate text-[16px] font-extrabold" style={{ color: "var(--ink)" }}>{student.name}</div>
                          </div>

                          <div className="mb-2.5 grid grid-cols-2 gap-2.5">
                            <TalentSummaryBox label={"\uC774\uBC88\uC8FC \uB2EC\uB780\uD2B8"} value={studentTotal} tone="week" />
                            <TalentSummaryBox label={"\uCD1D \uB2EC\uB780\uD2B8"} value={cumulative[student.id] ?? 0} tone="total" />
                          </div>

                          <button
                            type="button"
                            onClick={() => setExpandedStudents((prev) => ({ ...prev, [rowKey]: !expanded }))}
                            className="mb-3 flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border text-[13px] font-extrabold"
                            style={{
                              borderColor: expanded ? "color-mix(in srgb, var(--brass) 44%, transparent)" : "var(--hairline)",
                              background: expanded ? "color-mix(in srgb, var(--brass) 10%, #fff)" : "var(--card)",
                              color: expanded ? "var(--warning)" : "var(--ink-soft)",
                            }}
                          >
                            {expanded ? "\uC811\uAE30" : "\uD3BC\uCCD0\uC11C \uCCB4\uD06C"}
                            <ChevronDown size={15} strokeWidth={2.4} className={expanded ? "rotate-180 transition-transform" : "transition-transform"} />
                          </button>

                          {expanded && (
                            <>
                              <div
                                className="mb-2.5 flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 text-[14px] font-extrabold leading-tight"
                                style={present
                                  ? { background: "color-mix(in srgb, var(--success) 12%, var(--card))", border: "1.5px solid color-mix(in srgb, var(--success) 36%, transparent)", color: "var(--success)" }
                                  : { background: "var(--card)", border: "1.5px dashed var(--hairline-strong)", color: "var(--ink-faint)" }}
                              >
                                <span className="flex items-center gap-2">
                                  <span className="shrink-0 text-[18px] leading-none" aria-hidden>{RULE_EMOJI.attendance}</span>
                                  <span className="flex flex-col leading-tight">
                                    <span>{"\uCD9C\uC11D"}</span>
                                    <span className="text-[11px] font-semibold" style={{ opacity: 0.75 }}>{"\uCD9C\uC11D\uCCB4\uD06C \uC790\uB3D9\uCCB4\uD06C"}</span>
                                  </span>
                                </span>
                                <span className="shrink-0">{present ? `\uC790\uB3D9 +${getRulePoints("attendance")}` : "-"}</span>
                              </div>

                              <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-bold" style={{ color: "var(--ink-faint)" }}>
                                <Star size={12} fill="var(--warning)" strokeWidth={0} /> {"\uB204\uB974\uBA74 \uB2EC\uB780\uD2B8\uAC00 \uCC28\uACE1\uCC28\uACE1 \uBAA8\uC5EC\uC694"}
                              </div>

                              <div className="grid grid-cols-2 gap-2.5">
                                {checkRules.map((rule) => {
                                  const selected = isChecked(student.id, date, rule);
                                  const key = extraKey(student.id, date, rule.id);
                                  const label = rule.label;
                                  const disabled = !isEditableWeek || saving === key;

                                  return (
                                    <button
                                      key={rule.id}
                                      type="button"
                                      onClick={() => toggleWeeklyItem(student, date, rule)}
                                      disabled={disabled}
                                      className={[
                                        "coin-chip flex min-h-[40px] items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13.5px] font-bold leading-tight",
                                        selected ? "coin-on" : "",
                                        disabled ? "cursor-not-allowed" : "cursor-pointer",
                                        !isEditableWeek && !selected ? "opacity-60" : "",
                                      ].join(" ")}
                                      style={selected
                                        ? { background: "color-mix(in srgb, var(--accent) 18%, #fff)", color: "color-mix(in srgb, var(--accent) 75%, var(--ink))", border: "1.5px solid color-mix(in srgb, var(--accent) 45%, transparent)" }
                                        : { background: "color-mix(in srgb, var(--bg-soft) 70%, #fff)", color: "var(--ink-soft)", border: "1px solid var(--hairline)" }}
                                    >
                                      <span className="shrink-0 text-[17px] leading-none" aria-hidden>{RULE_EMOJI[rule.rule_key] || "?"}</span>
                                      <span className="flex-1 truncate">{label}</span>
                                      {selected && <Check size={14} strokeWidth={3} className="shrink-0" />}
                                    </button>
                                  );
                                })}

                                <button
                                  type="button"
                                  onClick={() => openOther(student, date)}
                                  disabled={!isEditableWeek}
                                  className={[
                                    "coin-chip flex min-h-[40px] items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13.5px] font-bold leading-tight",
                                    otherRecords.length > 0 ? "coin-on" : "",
                                    !isEditableWeek ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                                  ].join(" ")}
                                  style={otherRecords.length > 0
                                    ? { background: "color-mix(in srgb, var(--warning) 20%, #fff)", color: "color-mix(in srgb, var(--warning) 78%, var(--ink))", border: "1.5px solid color-mix(in srgb, var(--warning) 48%, transparent)" }
                                    : { background: "color-mix(in srgb, var(--bg-soft) 70%, #fff)", color: "var(--ink-soft)", border: "1px solid var(--hairline)" }}
                                >
                                  <span className="shrink-0 text-[17px] leading-none" aria-hidden>{OTHER_EMOJI}</span>
                                  <span className="flex-1 truncate">{"\uAE30\uD0C0 (\uC9C1\uC811\uC785\uB825)"}</span>
                                  {otherRecords.length > 0 && <span className="shrink-0 text-[12px] font-extrabold">+{otherTotal}</span>}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </section>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {otherModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50 p-4" onClick={() => !otherSaving && setOtherModal(null)}>
          <div className="w-full max-w-sm rounded-lg bg-card p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-1 text-[19px] font-extrabold text-ink">
              기타 달란트
            </div>
            <div className="mb-4 text-[14px] font-semibold text-ink-soft">
              {otherModal.student.name} · {formatMD(otherModal.date)} 주일
            </div>

            {getOthers(otherModal.student.id, otherModal.date).length > 0 && (
              <div className="mb-4 flex flex-col gap-2">
                <div className="text-[13px] font-extrabold text-ink-mid">등록된 직접입력</div>
                {getOthers(otherModal.student.id, otherModal.date).map((record, index) => (
                  <div key={record.id} className="flex items-center gap-2 rounded-lg border border-hairline bg-bg-soft px-3 py-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-warning-soft text-[12px] font-extrabold text-warning">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink-mid">{record.note || "기타"}</span>
                    <span className="shrink-0 text-[13px] font-extrabold text-warning">+{record.pts_other}</span>
                    <button type="button" onClick={() => deleteOther(record)} disabled={otherSaving} aria-label={`${record.note || "기타"} 삭제`} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-card">
                      <X size={14} strokeWidth={2.2} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className="mb-1 block text-[15px] font-bold text-ink-mid">사유</label>
            <input
              type="text"
              value={otherNote}
              onChange={(event) => setOtherNote(event.target.value)}
              placeholder="예: 특별활동, 찬양, 선생님 재량"
              className="mb-3 w-full rounded-md border border-hairline-strong px-3 py-3 text-[16px] outline-none focus:border-accent-muted"
            />

            <label className="mb-1 block text-[15px] font-bold text-ink-mid">달란트 수량</label>
            <input
              type="number"
              min={0}
              value={otherAmount}
              onChange={(event) => setOtherAmount(event.target.value)}
              className="mb-4 w-full rounded-md border border-hairline-strong px-3 py-3 text-center text-[18px] font-extrabold outline-none focus:border-accent-muted"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOtherModal(null)}
                disabled={otherSaving}
                className="min-h-12 flex-1 rounded-md bg-bg-soft text-[16px] font-extrabold text-ink-mid"
              >
                취소
              </button>
              <button
                type="button"
                onClick={saveOther}
                disabled={otherSaving}
                className="min-h-12 flex-[1.4] rounded-md bg-ink text-[16px] font-extrabold text-white"
              >
                {otherSaving ? "추가 중..." : "추가"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
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

function getTodayWeekIndex(sundays: string[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return sundays.findIndex((dateKey) => {
    const start = parseDateKey(dateKey);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return today >= start && today <= end;
  });
}

function getCurrentSundayKey() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() - today.getDay());
  return formatDateKey(today);
}

function getWeekEditState(dateKey: string, currentSundayKey: string) {
  if (dateKey < currentSundayKey) return "past";
  if (dateKey > currentSundayKey) return "future";
  return "current";
}

function getMonthEndKey(year: number, month: number) {
  return formatDateKey(new Date(year, month, 0));
}

function formatDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatMD(dateKey: string) {
  const date = parseDateKey(dateKey);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function prevMonth(year: number, month: number, setYear: (y: number) => void, setMonth: (m: number) => void) {
  if (month === 1) {
    setYear(year - 1);
    setMonth(12);
  } else {
    setMonth(month - 1);
  }
}

function nextMonth(year: number, month: number, setYear: (y: number) => void, setMonth: (m: number) => void) {
  if (month === 12) {
    setYear(year + 1);
    setMonth(1);
  } else {
    setMonth(month + 1);
  }
}

function extraKey(studentId: string, date: string, ruleId: string) {
  return `${studentId}_${date}_${ruleId}`;
}

function fmt(n: number) {
  return (n || 0).toLocaleString("ko-KR");
}

// 달란트 = 금화색 (아이들 통장 동전 톤). brass/warning 토큰은 어두운 갈색이라
// 동전 느낌을 위해 밝은 골드 그라데이션을 이 화면 전용 상수로 둔다.
const COIN_GRAD = "linear-gradient(135deg, #E7C25A, #C9923B)";

// 아이별 둥근 아바타 — 이름 해시로 톤을 고정 배정(장식용, 성별 데이터 미사용)
function TalentSummaryBox({ label, value, tone }: { label: string; value: number; tone: "week" | "total" }) {
  const isTotal = tone === "total";

  return (
    <div
      className="flex min-h-[76px] flex-col justify-between rounded-2xl px-3 py-2.5"
      style={{
        border: isTotal
          ? "1.5px solid color-mix(in srgb, var(--brass) 30%, transparent)"
          : "1.5px solid color-mix(in srgb, var(--success) 30%, transparent)",
        background: isTotal
          ? "linear-gradient(135deg, color-mix(in srgb, var(--brass) 14%, #fff), color-mix(in srgb, var(--warning) 12%, #fff))"
          : "linear-gradient(135deg, color-mix(in srgb, var(--success) 12%, #fff), color-mix(in srgb, var(--info) 8%, #fff))",
      }}
    >
      <span className="flex items-center gap-1.5 text-[12px] font-extrabold" style={{ color: isTotal ? "var(--warning)" : "var(--success)" }}>
        <PiggyBank size={14} strokeWidth={2.2} /> {label}
      </span>
      <span className="flex items-baseline justify-end gap-1">
        <span className="text-[24px] font-extrabold leading-none" style={{ color: "var(--ink)" }}>{fmt(value)}</span>
        <span className="text-[13px] font-extrabold" style={{ color: isTotal ? "var(--warning)" : "var(--success)" }}>달란트</span>
      </span>
    </div>
  );
}

function Avatar({ student }: { student: Student }) {
  const displaySrc = student.photo_url || kidDefaultFace(student.gender, student.id);
  const transform = isKidDefaultFace(displaySrc) ? kidFaceTransform(displaySrc) : undefined;

  return (
    <div
      className="kid-avatar grid shrink-0 place-items-center overflow-hidden"
      style={{
        width: 44,
        height: 44,
        borderRadius: 999,
        background: "color-mix(in srgb, var(--accent-muted) 14%, #f7f2e8)",
        border: "2.5px solid #fff",
        boxShadow: "0 4px 10px rgba(43,39,34,0.12), 0 0 0 1.5px var(--hairline)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photoThumb(displaySrc, 128)}
        alt={`${student.name} 얼굴`}
        loading="lazy"
        decoding="async"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center",
          transform,
        }}
      />
    </div>
  );
}
const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "linear-gradient(180deg, color-mix(in srgb, var(--info) 9%, var(--bg-soft)) 0%, var(--bg-soft) 320px)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)",
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  flex: 1,
  minWidth: 0,
};
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit",
  whiteSpace: "nowrap", flexShrink: 0,
};
const navBtnStyle: React.CSSProperties = { padding: "7px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 16, cursor: "pointer", fontFamily: "inherit", color: "var(--ink-mid)" };
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 14, fontWeight: 700, zIndex: 1100, fontFamily: "inherit", whiteSpace: "nowrap" };
