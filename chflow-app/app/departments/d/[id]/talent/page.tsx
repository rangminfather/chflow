"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Medal } from "lucide-react";

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

const DEFAULT_WEEKLY_RULES = [
  { rule_key: "attendance", label: "출석", points: 1, order_no: 0 },
  { rule_key: "bible_book", label: "성경책 지참", points: 1, order_no: 1 },
  { rule_key: "verse_memory", label: "요절암송", points: 1, order_no: 2 },
  { rule_key: "verse_presentation", label: "요절암송발표", points: 1, order_no: 3 },
  { rule_key: "representative_prayer", label: "대표기도", points: 1, order_no: 4 },
  { rule_key: "evangelism", label: "전도", points: 1, order_no: 5 },
  { rule_key: "new_friend_promotion", label: "새친구등반", points: 1, order_no: 6 },
  { rule_key: "lesson_homework", label: "공과숙제", points: 1, order_no: 7 },
];

const CHECK_RULE_KEYS = DEFAULT_WEEKLY_RULES
  .map((rule) => rule.rule_key)
  .filter((key) => key !== "attendance");

export default function TalentPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;
  const weekCardRefs = useRef<Record<string, HTMLElement | null>>({});

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [myTeacherId, setMyTeacherId] = useState<string | null>(null);
  const [myClassName, setMyClassName] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<AttendRow[]>([]);
  const [rules, setRules] = useState<TalentRule[]>([]);
  const [extras, setExtras] = useState<WeeklyExtra[]>([]);
  const [others, setOthers] = useState<OtherRecord[]>([]);
  const [saving, setSaving] = useState("");
  const [toast, setToast] = useState("");
  const [otherModal, setOtherModal] = useState<{ student: Student; date: string } | null>(null);
  const [otherNote, setOtherNote] = useState("");
  const [otherAmount, setOtherAmount] = useState("1");
  const [otherSaving, setOtherSaving] = useState(false);

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

      const { data: teacher } = await supabase
        .from("edu_teachers")
        .select("id")
        .eq("department_id", deptId)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      setMyTeacherId(teacher?.id || null);
      setAuthChecked(true);
    })();
  }, [deptId, router]);

  useEffect(() => {
    if (!authChecked) return;
    if (!myTeacherId) {
      setStudents([]);
      setLoading(false);
      return;
    }
    loadAll(myTeacherId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, myTeacherId, year, month]);

  useEffect(() => {
    if (loading || todayWeekIndex < 0) return;

    const target = weekCardRefs.current[sundays[todayWeekIndex]];
    const timer = window.setTimeout(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [loading, students.length, sundays, todayWeekIndex]);

  async function loadAll(teacherId: string) {
    setLoading(true);

    const classStudents = await loadStudents(teacherId);
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
    setLoading(false);
  }

  async function loadStudents(teacherId: string) {
    const { data } = await supabase.rpc("edu_list_students", { p_dept_id: deptId });
    const all = (data || []) as Student[];
    const mine = all
      .filter((student) => student.teacher_id === teacherId)
      .sort((a, b) => (a.order_no || 0) - (b.order_no || 0) || (a.student_no || 0) - (b.student_no || 0));

    setStudents(mine);

    if (mine.length > 0) {
      const { data: cls } = await supabase
        .from("edu_students")
        .select("class_no")
        .eq("id", mine[0].id)
        .maybeSingle();
      setMyClassName(cls?.class_no || "");
    } else {
      setMyClassName("");
    }

    return mine;
  }

  async function ensureDefaultRules() {
    const { data: listed } = await supabase.rpc("list_talent_rules", { p_dept_id: deptId });
    const current = ((listed || []) as TalentRule[]).filter((rule) => rule.rule_kind === "weekly");
    const existingKeys = new Set(current.map((rule) => rule.rule_key));
    const missing = DEFAULT_WEEKLY_RULES.filter((rule) => !existingKeys.has(rule.rule_key));

    if (missing.length > 0) {
      await supabase.from("edu_talent_rules").insert(
        missing.map((rule) => ({
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
      .gt("pts_other", 0);

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
    const map: Record<string, OtherRecord> = {};
    others.forEach((record) => {
      const key = `${record.student_id}_${record.record_date}`;
      if (!map[key]) map[key] = record;
      else {
        map[key] = {
          ...map[key],
          pts_other: map[key].pts_other + record.pts_other,
          note: [map[key].note, record.note].filter(Boolean).join(" / "),
        };
      }
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

  function getAttendance(studentId: string, date: string) {
    return attendanceMap[studentId]?.[date];
  }

  function isPresent(studentId: string, date: string) {
    return getAttendance(studentId, date)?.attend_status === "출";
  }

  function isChecked(studentId: string, date: string, rule: TalentRule) {
    return !!extraMap[extraKey(studentId, date, rule.id)];
  }

  function getOther(studentId: string, date: string) {
    return otherMap[`${studentId}_${date}`];
  }

  function studentWeekTotal(studentId: string, date: string) {
    const attendancePoints = isPresent(studentId, date) ? getRulePoints("attendance") : 0;
    const checkPoints = CHECK_RULE_KEYS.reduce((sum, key) => {
      const rule = ruleMap[key];
      return sum + (rule && isChecked(studentId, date, rule) ? getRulePoints(key) : 0);
    }, 0);
    return attendancePoints + checkPoints + (getOther(studentId, date)?.pts_other || 0);
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
  }

  function openOther(student: Student, date: string) {
    if (getWeekEditState(date, currentSundayKey) !== "current") return;
    const current = getOther(student.id, date);
    setOtherModal({ student, date });
    setOtherAmount(String(current?.pts_other || 1));
    setOtherNote(current?.note || "");
  }

  async function saveOther() {
    if (!otherModal) return;
    if (getWeekEditState(otherModal.date, currentSundayKey) !== "current") return;

    const amount = Math.max(0, Number(otherAmount) || 0);
    const current = getOther(otherModal.student.id, otherModal.date);
    setOtherSaving(true);

    try {
      if (amount === 0 && current?.id) {
        await supabase.rpc("edu_delete_talent", { p_id: current.id });
      } else if (amount > 0) {
        const { error } = await supabase.rpc("edu_save_talent", {
          p_id: current?.id ?? null,
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
      }

      await loadOtherRecords(students.map((student) => student.id));
      setOtherModal(null);
      showToast("저장되었습니다");
    } catch (error) {
      showToast("저장 실패: " + (error as Error).message);
    } finally {
      setOtherSaving(false);
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  if (!authChecked) return <LoadingView full />;

  if (!myTeacherId) {
    return (
      <div style={pageStyle}>
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
            <HeaderLogo />
          </div>
          <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}><Medal size={18} strokeWidth={1.8} /> 달란트통장</div>
          <div style={{ width: 80 }} />
        </div>
        <div className="mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-hairline bg-white text-center">
            <EmptyState message="본인이 담임으로 등록된 반이 없습니다" hint="부장 또는 전도사에게 담임 등록을 요청하세요." />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>

      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
          <HeaderLogo />
        </div>
        <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Medal size={18} strokeWidth={1.8} /> 달란트통장 {myClassName && <span style={{ color: "var(--accent)", marginLeft: 6 }}>{myClassName}반</span>}
        </div>
        <div style={{ width: 80 }} />
      </div>

      <main className="mx-auto w-full max-w-6xl px-0 py-4 md:px-4">
        <div className="mx-4 mb-4 flex flex-wrap items-center justify-center gap-3 rounded-lg border border-hairline bg-white px-4 py-3 md:mx-0">
          <button onClick={() => prevMonth(year, month, setYear, setMonth)} style={navBtnStyle}>◀</button>
          <div className="min-w-[140px] text-center text-[19px] font-extrabold text-ink">
            {year}년 {month}월
          </div>
          <button onClick={() => nextMonth(year, month, setYear, setMonth)} style={navBtnStyle}>▶</button>
          <div className="w-full text-center text-[13px] font-semibold text-ink-faint">
            주일 {todayWeekIndex >= 0 ? todayWeekIndex + 1 : Math.min(1, sundays.length)}주차/{sundays.length}주차
          </div>
        </div>

        {loading ? (
          <div className="mx-4 rounded-lg border border-hairline bg-white py-16 text-center text-[17px] text-ink-faint md:mx-0">
            불러오는 중...
          </div>
        ) : students.length === 0 ? (
          <div className="mx-4 rounded-lg border border-hairline bg-white py-16 text-center text-[17px] text-ink-faint md:mx-0">
            담당 반 학생이 없습니다.
          </div>
        ) : (
          <div className="flex overflow-x-auto snap-x snap-mandatory gap-4 px-[8vw] pb-2 scrollbar-hide md:grid md:grid-cols-2 lg:grid-cols-3 md:overflow-visible md:px-0 md:pb-0">
            {sundays.map((date, index) => {
              const editState = getWeekEditState(date, currentSundayKey);
              const isEditableWeek = editState === "current";
              const isTodayWeek = index === todayWeekIndex;

              return (
                <article
                  key={date}
                  ref={(node) => { weekCardRefs.current[date] = node; }}
                  className={[
                    "shrink-0 w-[84vw] snap-center overflow-hidden rounded-lg bg-white shadow-sm md:w-auto",
                    isTodayWeek
                      ? "border-2 border-amber-500 shadow-[0_10px_30px_rgba(165, 119, 42,0.16)]"
                      : "border border-hairline-strong",
                  ].join(" ")}
                >
                  <header className={[
                    "border-b px-4 py-3",
                    isTodayWeek ? "border-amber-200 bg-gradient-to-r from-amber-50 to-white" : "border-hairline bg-surface",
                  ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-[19px] font-extrabold text-ink">
                          {index + 1}주차
                          {isTodayWeek && (
                            <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[12px] font-extrabold text-amber-800">
                              오늘 주차
                            </span>
                          )}
                          {!isEditableWeek && (
                            <span
                              className={[
                                "rounded-full border px-2 py-0.5 text-[12px] font-extrabold",
                                editState === "past"
                                  ? "border-hairline bg-white text-ink-faint"
                                  : "border-accent-line bg-accent-soft text-accent-strong",
                              ].join(" ")}
                            >
                              {editState === "past" ? "수정 마감" : "예정"}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[13px] font-semibold text-ink-soft">{formatMD(date)} 주일</div>
                      </div>
                      <div className={[
                        "rounded-md border bg-white px-2.5 py-1 text-[13px] font-extrabold",
                        isTodayWeek ? "border-amber-200 text-amber-800" : "border-hairline text-ink-mid",
                      ].join(" ")}
                      >
                        {weekTotal(date)}개
                      </div>
                    </div>
                  </header>

                  <section className="space-y-3 bg-white px-4 py-4">
                    {students.map((student) => {
                      const studentTotal = studentWeekTotal(student.id, date);
                      const present = isPresent(student.id, date);
                      const other = getOther(student.id, date);

                      return (
                        <div key={student.id} className="rounded-lg border border-hairline bg-surface p-3">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="min-w-0 truncate text-[16px] font-extrabold text-ink">{student.name}</div>
                            <span className="shrink-0 rounded-md border border-amber-200 bg-white px-2 py-1 text-[13px] font-extrabold text-amber-700">
                              {studentTotal}개
                            </span>
                          </div>

                          <div className="mb-2 grid grid-cols-2 gap-2">
                            <div
                              className={[
                                "min-h-12 rounded-md border px-2 py-2 text-center text-[15px] font-extrabold leading-tight",
                                present
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                  : "border-hairline bg-white text-ink-faint",
                              ].join(" ")}
                            >
                              출석 자동 +{getRulePoints("attendance")}
                            </div>

                            <button
                              type="button"
                              onClick={() => openOther(student, date)}
                              disabled={!isEditableWeek}
                              className={[
                                "min-h-12 rounded-md border px-2 py-2 text-center text-[15px] font-extrabold leading-tight",
                                other
                                  ? "border-accent-line bg-accent-soft text-accent-strong"
                                  : "border-hairline bg-white text-ink-mid",
                                !isEditableWeek ? "cursor-not-allowed opacity-60" : "",
                              ].join(" ")}
                            >
                              기타 {other ? `+${other.pts_other}` : ""}
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {CHECK_RULE_KEYS.map((ruleKey) => {
                              const rule = ruleMap[ruleKey];
                              const selected = rule ? isChecked(student.id, date, rule) : false;
                              const key = rule ? extraKey(student.id, date, rule.id) : `${student.id}-${date}-${ruleKey}`;

                              return (
                                <button
                                  key={ruleKey}
                                  type="button"
                                  onClick={() => rule && toggleWeeklyItem(student, date, rule)}
                                  disabled={!rule || !isEditableWeek || saving === key}
                                  className={[
                                    "min-h-12 rounded-md border px-2 py-2 text-[15px] font-extrabold leading-tight",
                                    selected
                                      ? "border-ink bg-ink text-white"
                                      : "border-hairline bg-white text-ink-mid",
                                    (!rule || !isEditableWeek) ? "cursor-not-allowed opacity-60" : "",
                                  ].join(" ")}
                                >
                                  {rule?.label || DEFAULT_WEEKLY_RULES.find((item) => item.rule_key === ruleKey)?.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </section>

                  <footer className="border-t border-hairline bg-surface px-4 py-3">
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[15px] leading-6 text-amber-900">
                      출석은 내반출결에서 자동 반영됩니다. 기타는 사유와 수량을 직접 입력합니다.
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {otherModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50 p-4" onClick={() => !otherSaving && setOtherModal(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-1 text-[19px] font-extrabold text-ink">
              기타 달란트
            </div>
            <div className="mb-4 text-[14px] font-semibold text-ink-soft">
              {otherModal.student.name} · {formatMD(otherModal.date)} 주일
            </div>

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
                {otherSaving ? "저장 중..." : "저장"}
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

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)" };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit" };
const navBtnStyle: React.CSSProperties = { padding: "7px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 16, cursor: "pointer", fontFamily: "inherit", color: "var(--ink-mid)" };
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 14, fontWeight: 700, zIndex: 1100, fontFamily: "inherit", whiteSpace: "nowrap" };
