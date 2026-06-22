"use client";

// 내 반 출결 — 담임 본인이 맡고 있는 반 학생만 표시.
// 학생 추가/삭제 X (관리자가 행정관리 → 출결 통합 조회 에서 수행).
// 본인이 담임으로 등록되지 않은 사용자는 빈 화면 + 안내.

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { type LucideIcon, BadgeCheck, CheckCircle2, ClipboardCheck, XCircle } from "lucide-react";

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
  gender?: string | null;
  school_name?: string | null;
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

const ATTENDANCE_OPTIONS = [
  { value: "출", label: "출석" },
  { value: "결", label: "결석" },
  { value: "인", label: "출석인정" },
];

const STATUS_COLOR: Record<string, string> = {
  출: "var(--success)",
  결: "var(--danger)",
  인: "var(--info)",
};

export default function MyClassAttendancePage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;
  const weekCardRefs = useRef<Record<string, HTMLElement | null>>({});

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

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }

      // 본인이 담임으로 등록된 edu_teachers row 찾기
      const { data: t } = await supabase
        .from("edu_teachers")
        .select("id, teacher_role")
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
    const memberIds = mine.map((s) => s.member_id).filter(Boolean) as string[];
    const memberInfo: Record<string, { gender: string | null; school_name: string | null }> = {};

    if (memberIds.length > 0) {
      const { data: members } = await supabase
        .from("members")
        .select("id, gender")
        .in("id", memberIds);

      (members || []).forEach((m: { id: string; gender: string | null }) => {
        memberInfo[m.id] = { gender: m.gender, school_name: null };
      });
    }

    const enriched = mine.map((student) => ({
      ...student,
      gender: student.member_id ? memberInfo[student.member_id]?.gender ?? null : null,
      school_name: student.member_id ? memberInfo[student.member_id]?.school_name ?? null : null,
    }));

    setStudents(enriched);
    // 반 이름 추측 — 첫 학생의 class_no (없으면 빈)
    if (enriched.length > 0) {
      const { data: cls } = await supabase
        .from("edu_students")
        .select("class_no")
        .eq("id", enriched[0].id)
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
  const currentSundayKey = useMemo(() => getCurrentSundayKey(), []);
  const todayWeekIndex = useMemo(() => getTodayWeekIndex(sundays), [sundays]);

  useEffect(() => {
    if (loading || todayWeekIndex < 0) return;

    const target = weekCardRefs.current[sundays[todayWeekIndex]];
    const timer = window.setTimeout(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [loading, students.length, sundays, todayWeekIndex]);

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

  const setStatus = async (studentId: string, date: string, status: string) => {
    if (getWeekEditState(date, currentSundayKey) !== "current") return;

    const cell = getCell(studentId, date);
    const key = `${studentId}-${date}-${status}`;
    setSaving(key);
    await supabase.rpc("edu_set_my_class_attendance", {
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
    setSaving("");
  };

  const weeklySummary = (date: string) => {
    const cells = students.map((student) => getCell(student.id, date));
    const attend = cells.filter((c) => normalizeStatus(c?.attend_status) === "출").length;
    const absent = cells.filter((c) => normalizeStatus(c?.attend_status) === "결").length;
    const otherChurch = cells.filter((c) => normalizeStatus(c?.attend_status) === "인").length;
    return { total: students.length, attend, absent, otherChurch };
  };

  if (!authChecked) return <LoadingView full />;

  // 담임 아닌 경우
  if (!myTeacherId) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>
        <div style={headerStyle}>
          <HeaderLogo />
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
          <div style={headerTitleStyle}><ClipboardCheck size={18} strokeWidth={1.8} style={{ flexShrink: 0 }} /> 내 반 출결</div>
          <div style={{ width: 80 }} />
        </div>
        <div style={{ maxWidth: 600, margin: "60px auto", padding: 16 }}>
          <div style={{ ...cardStyle, textAlign: "center" }}>
            <EmptyState message="본인이 담임으로 등록된 반이 없습니다" hint="부장 또는 전도사에게 담임 등록을 요청하세요. (행정관리 → 담임선생님 지정)" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <style>{`
        .seg-btn { transition: background 0.16s, color 0.16s, box-shadow 0.16s, transform 0.12s; }
        .seg-btn:active:not(:disabled) { transform: scale(0.96); }
        .seg-on { animation: segPop 0.2s ease-out; }
        @keyframes segPop {
          0%   { transform: scale(0.92); }
          60%  { transform: scale(1.03); }
          100% { transform: scale(1); }
        }
        .kid-avatar { transition: transform 0.16s ease; }
        .student-card:hover .kid-avatar { transform: scale(1.06); }
      `}</style>

      <div style={headerStyle}>
        <HeaderLogo />
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={headerTitleStyle}>
          <ClipboardCheck size={18} strokeWidth={1.8} style={{ flexShrink: 0 }} /> 내 반 출결 {myClassName && <span style={{ color: "var(--accent)", marginLeft: 6 }}>{myClassName}반</span>}
        </div>
        <div style={{ width: 80 }} />
      </div>

      <main className="mx-auto w-full max-w-6xl px-0 py-4 md:px-4">
        {/* 월 선택 */}
        <div className="mx-4 mb-4 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-hairline bg-white px-4 py-3 md:mx-0">
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
            담당 반 학생이 없습니다. 부장 또는 전도사에게 학생 배정을 요청하세요.
          </div>
        ) : (
          <div className="flex overflow-x-auto snap-x snap-mandatory gap-4 px-[8vw] pb-2 scrollbar-hide md:grid md:grid-cols-2 lg:grid-cols-3 md:overflow-visible md:px-0 md:pb-0">
            {sundays.map((date, index) => {
              const summary = weeklySummary(date);
              const isTodayWeek = index === todayWeekIndex;
              const editState = getWeekEditState(date, currentSundayKey);
              const isEditableWeek = editState === "current";

              return (
                <article
                  key={date}
                  ref={(node) => { weekCardRefs.current[date] = node; }}
                  className="shrink-0 w-[84vw] snap-center overflow-hidden rounded-3xl md:w-auto"
                  style={{
                    background: "var(--card)",
                    border: isTodayWeek ? "1.5px solid var(--accent-line)" : "1px solid var(--hairline)",
                    boxShadow: isTodayWeek
                      ? "0 12px 30px color-mix(in srgb, var(--accent) 14%, transparent)"
                      : "0 4px 16px rgba(43,39,34,0.06)",
                  }}
                >
                  <header
                    className="flex items-center justify-between gap-3 px-4 py-4"
                    style={{
                      borderBottom: "1px solid var(--hairline)",
                      background: isTodayWeek ? "linear-gradient(135deg, var(--accent-soft), var(--surface))" : "transparent",
                    }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[20px] font-extrabold" style={{ color: "var(--ink)" }}>
                        {index + 1}주차
                        {isTodayWeek && (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                            style={{ background: "var(--accent)", color: "#fff" }}
                          >
                            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#fff" }} /> 오늘
                          </span>
                        )}
                        {!isEditableWeek && (
                          <span
                            className="rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                            style={
                              editState === "past"
                                ? { background: "var(--bg-soft)", color: "var(--ink-faint)" }
                                : { background: "var(--accent-soft)", color: "var(--accent-strong)" }
                            }
                          >
                            {editState === "past" ? "수정 마감" : "예정"}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[13px] font-semibold" style={{ color: "var(--ink-soft)" }}>{formatMD(date)} 주일</div>
                    </div>
                    <div
                      className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-extrabold"
                      style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}
                    >
                      {summary.total}명
                    </div>
                  </header>

                  <section className="flex flex-col gap-2.5 px-3.5 py-3.5">
                    {students.map((student) => {
                      const cell = getCell(student.id, date);
                      const currentStatus = normalizeStatus(cell?.attend_status);

                      return (
                        <div
                          key={student.id}
                          className="student-card rounded-2xl p-3.5"
                          style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
                        >
                          <div className="mb-3 flex items-center gap-3">
                            <Avatar name={student.name} gender={student.gender} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[17px] font-extrabold leading-tight" style={{ color: "var(--ink)" }}>{student.name}</div>
                              {studentMeta(student) && (
                                <div className="truncate text-[12px] font-semibold" style={{ color: "var(--ink-faint)" }}>
                                  {studentMeta(student)}
                                </div>
                              )}
                            </div>
                            <span
                              className="shrink-0 rounded-full px-3 py-1 text-[12px] font-extrabold"
                              style={{ color: STATUS_COLOR[currentStatus], background: `color-mix(in srgb, ${STATUS_COLOR[currentStatus]} 14%, transparent)` }}
                            >
                              {statusLabel(currentStatus)}
                            </span>
                          </div>

                          <div
                            className="flex gap-1 rounded-2xl p-1"
                            style={{ background: isEditableWeek ? "var(--bg-soft)" : "color-mix(in srgb, var(--bg-soft) 60%, transparent)" }}
                          >
                            {ATTENDANCE_OPTIONS.map((option) => {
                              const selected = currentStatus === option.value;
                              const savingKey = `${student.id}-${date}-${option.value}`;
                              const tone = attendanceTone(option.value);
                              const Icon = tone.Icon;
                              const disabled = !isEditableWeek || saving === savingKey;

                              let btnStyle: React.CSSProperties;
                              if (selected) {
                                btnStyle = {
                                  background: tone.color,
                                  color: "#fff",
                                  boxShadow: `0 5px 12px color-mix(in srgb, ${tone.color} 36%, transparent)`,
                                  opacity: isEditableWeek ? 1 : 0.78,
                                };
                              } else {
                                btnStyle = { background: "transparent", color: "var(--ink-soft)", opacity: isEditableWeek ? 1 : 0.55 };
                              }

                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => setStatus(student.id, date, option.value)}
                                  disabled={disabled}
                                  className={[
                                    "seg-btn flex min-h-[48px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[14px] font-extrabold leading-tight",
                                    selected ? "seg-on" : "",
                                    disabled ? "cursor-not-allowed" : "cursor-pointer",
                                  ].join(" ")}
                                  style={btnStyle}
                                >
                                  <Icon size={19} strokeWidth={2.3} />
                                  <span className="whitespace-nowrap">{option.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </section>

                  <footer className="px-3.5 pb-4">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <SummaryBox label="출석" value={summary.attend} color="var(--success)" Icon={CheckCircle2} />
                      <SummaryBox label="결석" value={summary.absent} color="var(--danger)" Icon={XCircle} />
                      <SummaryBox label="출석인정" value={summary.otherChurch} color="var(--info)" Icon={BadgeCheck} />
                    </div>
                    <div
                      className="mt-3 rounded-xl px-3 py-2 text-[13px] leading-6"
                      style={{ border: "1px solid color-mix(in srgb, var(--warning) 26%, transparent)", background: "var(--warning-soft)", color: "var(--ink-mid)" }}
                    >
                      ※ 출석인정 : 타교회 출석, 전염병 등 부서 재량 출석인정되는 경우
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </main>

    </div>
  );
}

function getSundaysInMonth(year: number, month: number): string[] {
  const sundays: string[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  while (d.getMonth() === month - 1) {
    sundays.push(formatDateKey(d));
    d.setDate(d.getDate() + 7);
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

function formatMD(d: string) {
  const date = parseDateKey(d);
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

function statusLabel(status: string) {
  const labels: Record<string, string> = { 출: "출석", 결: "결석", 인: "출석인정" };
  return labels[status] || status;
}

function attendanceTone(status: string) {
  if (status === "출") return { Icon: CheckCircle2, color: "var(--success)" };
  if (status === "결") return { Icon: XCircle, color: "var(--danger)" };
  return { Icon: BadgeCheck, color: "var(--info)" };
}

function normalizeStatus(status: string | null | undefined) {
  if (status === "출" || status === "인") return status;
  return "결";
}

function genderLabel(gender: string | null | undefined) {
  if (gender === "M" || gender === "남") return "남";
  if (gender === "F" || gender === "여") return "여";
  return "";
}

function studentMeta(student: Student) {
  return [genderLabel(student.gender), student.school_name].filter(Boolean).join(" · ");
}

// 아이 이름 기반 아기자기 아바타 — 성별 톤(--male/--female)으로 부드럽게 채색
function avatarTone(gender: string | null | undefined) {
  if (gender === "M" || gender === "남") return "var(--male)";
  if (gender === "F" || gender === "여") return "var(--female)";
  return "var(--accent-muted)";
}

function Avatar({ name, gender }: { name: string; gender: string | null | undefined }) {
  const clean = (name || "").replace(/\s/g, "");
  // 세 글자 이상이면 이름(성 제외) 2글자, 아니면 전체 — 반 아이 구분이 쉽도록
  const label = clean.length >= 3 ? clean.slice(-2) : clean || "?";
  const tone = avatarTone(gender);
  return (
    <div
      className="kid-avatar grid shrink-0 place-items-center font-extrabold text-white"
      style={{
        width: 46,
        height: 46,
        borderRadius: 999,
        fontSize: label.length >= 2 ? 15 : 18,
        background: `linear-gradient(140deg, color-mix(in srgb, ${tone} 72%, #fff), ${tone})`,
        boxShadow: `0 4px 10px color-mix(in srgb, ${tone} 32%, transparent)`,
      }}
      aria-hidden
    >
      {label}
    </div>
  );
}

function SummaryBox({ label, value, color, Icon }: { label: string; value: number; color: string; Icon: LucideIcon }) {
  return (
    <div
      className="rounded-2xl px-2 py-2.5"
      style={{ border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`, background: `color-mix(in srgb, ${color} 7%, var(--card))` }}
    >
      <div className="flex items-center justify-center gap-1 text-[12px] font-extrabold" style={{ color }}>
        <Icon size={13} strokeWidth={2.4} /> {label}
      </div>
      <div className="mt-0.5 text-[19px] font-extrabold" style={{ color: "var(--ink)" }}>{value}</div>
    </div>
  );
}

const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 };
const headerTitleStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  fontSize: 19,
  fontWeight: 800,
  color: "var(--ink)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const cardStyle: React.CSSProperties = { background: "var(--card)", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit",
  whiteSpace: "nowrap", flexShrink: 0,
};
const navBtnStyle: React.CSSProperties = { padding: "7px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 16, cursor: "pointer", fontFamily: "inherit", color: "var(--ink-mid)" };
