"use client";

// 참여율 조사 — 초등1·2부 부서관리 전용.
// 상태 칩은 누르면 미체크 → 참석 → 불참 → 미체크 순으로 돌고, 누르는 즉시 저장된다.
// 비고·새친구 수는 입력칸을 벗어날 때 저장되고, [저장] 버튼으로 남은 입력을 한 번에 확정할 수 있다.
// 학년별 참석·새친구 통계는 표로, 카톡 공유용 텍스트는 복사 버튼으로 만든다.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView } from "@/components/StatusViews";
import { ChevronLeft, ChevronRight, Copy, Lock, Save } from "lucide-react";

interface StudentRow {
  student_id: string;
  name: string;
  class_no: string | null;
  grade_year: number | null;
  gender: string | null;
  teacher_name: string | null;
  status: "" | "참석" | "불참";
  note: string | null;
  new_friend_male_count: number;
  new_friend_female_count: number;
}

interface TeacherRow {
  teacher_id: string;
  name: string;
  teacher_role: string | null;
  status: "" | "참석" | "불참";
  note: string | null;
}

type Tally = { male: number; female: number; total: number };
type GradeTally = Tally & { grade: number };

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

/** 카톡 메시지·화면용 짧은 날짜 표기 ("9월 8일(월)") */
function dateLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = "일월화수목금토"[new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일(${weekday})`;
}

function genderLabel(value: string | null | undefined) {
  if (value === "M" || value === "남") return "남";
  if (value === "F" || value === "여") return "여";
  return "";
}

/** 반 이름. class_no 가 이미 "3-1"처럼 학년을 담고 있으면 학년을 앞에 또 붙이지 않는다. */
function classLabel(row: { grade_year: number | null; class_no: string | null }) {
  const classNo = row.class_no?.trim();
  if (!classNo) return row.grade_year ? `${row.grade_year}학년 미배정` : "반 미배정";
  if (row.grade_year && classNo.startsWith(`${row.grade_year}-`)) return `${classNo}반`;
  return row.grade_year ? `${row.grade_year}학년 ${classNo}반` : `${classNo}반`;
}

/** 직책 표기 — 그냥 "교사"는 굳이 적지 않는다(부장·임원·전도사 등만 표시) */
function roleLabel(role: string | null) {
  const value = role?.trim();
  return value && value !== "교사" ? value : "";
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

function parseCount(value: string) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 학년별 표 — 학년 · 남 · 여 · 계 + 합계. 한 줄로 길게 늘어나 잘리지 않게 표로 고정한다. */
function GradeStatTable({ rows, total, emptyLabel }: { rows: GradeTally[]; total: Tally; emptyLabel: string }) {
  if (rows.length === 0) {
    return <div style={emptyLineStyle}>{emptyLabel}</div>;
  }
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: "left" }}>학년</th>
          <th style={thStyle}>남</th>
          <th style={thStyle}>여</th>
          <th style={thStyle}>계</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.grade}>
            <td style={{ ...tdStyle, textAlign: "left", fontWeight: 600 }}>{r.grade}학년</td>
            <td style={tdStyle}>{r.male}</td>
            <td style={tdStyle}>{r.female}</td>
            <td style={{ ...tdStyle, fontWeight: 700, color: "var(--ink)" }}>{r.total}</td>
          </tr>
        ))}
        <tr>
          <td style={{ ...totalTdStyle, textAlign: "left" }}>합계</td>
          <td style={totalTdStyle}>{total.male}</td>
          <td style={totalTdStyle}>{total.female}</td>
          <td style={{ ...totalTdStyle, color: "var(--accent-strong)" }}>{total.total}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** 담임 참석 여부 칩 — 참석 명단의 반 이름 옆에 표시만 한다(여기서는 저장하지 않는다). */
function TeacherStatusChip({ status }: { status: "" | "참석" | "불참" }) {
  return (
    <span
      style={{
        ...teacherStatusChipStyle,
        color: STATUS_COLOR[status],
        background: `color-mix(in srgb, ${STATUS_COLOR[status]} 14%, transparent)`,
      }}
    >
      {status || "미입력"}
    </span>
  );
}

export default function ParticipationCheckPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [deptName, setDeptName] = useState("");
  const [date, setDate] = useState(() => toISO(new Date()));
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [teacherNoteDraft, setTeacherNoteDraft] = useState<Record<string, string>>({});
  const [newFriendDraft, setNewFriendDraft] = useState<Record<string, { male: string; female: string }>>({});

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
    setStudents(((listResp.data || []) as StudentRow[]).slice().sort(compareRows));
    setNoteDraft({});
    setNewFriendDraft({});
    if (teacherResp.error) {
      showToast(`교사 목록 조회 실패: ${teacherResp.error.message}`);
      setTeachers([]);
    } else {
      setTeachers(((teacherResp.data || []) as TeacherRow[]).slice()
        .sort((a, b) => a.name.localeCompare(b.name, "ko")));
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

  // ── 저장 (개별) ──

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

  const persistNote = async (row: StudentRow, value: string) => {
    setStudents((prev) => prev.map((s) => (s.student_id === row.student_id ? { ...s, note: value } : s)));
    const { error } = await supabase.rpc("edu_participation_set_note", {
      p_dept_id: deptId, p_student_id: row.student_id, p_check_date: date, p_note: value,
    });
    if (error) {
      showToast(`비고 저장 실패: ${error.message}`);
      return false;
    }
    return true;
  };

  const persistNewFriends = async (row: StudentRow, male: number, female: number) => {
    setStudents((prev) => prev.map((s) => (
      s.student_id === row.student_id ? { ...s, new_friend_male_count: male, new_friend_female_count: female } : s
    )));
    const { error } = await supabase.rpc("edu_participation_set_new_friends", {
      p_dept_id: deptId, p_student_id: row.student_id, p_check_date: date, p_male: male, p_female: female,
    });
    if (error) {
      setStudents((prev) => prev.map((s) => (
        s.student_id === row.student_id
          ? { ...s, new_friend_male_count: row.new_friend_male_count, new_friend_female_count: row.new_friend_female_count }
          : s
      )));
      showToast(`새친구 수 저장 실패: ${error.message}`);
      return false;
    }
    return true;
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

  const persistTeacherNote = async (row: TeacherRow, value: string) => {
    setTeachers((prev) => prev.map((t) => (t.teacher_id === row.teacher_id ? { ...t, note: value } : t)));
    const { error } = await supabase.rpc("edu_participation_teacher_set_note", {
      p_dept_id: deptId, p_teacher_id: row.teacher_id, p_check_date: date, p_note: value,
    });
    if (error) {
      showToast(`비고 저장 실패: ${error.message}`);
      return false;
    }
    return true;
  };

  // ── 저장 (남은 입력 일괄) ──
  // 입력칸을 벗어나지 않은 값(모바일에서 키보드를 닫지 않은 경우 등)까지 확정 저장한다.

  const pendingCount = useMemo(() => {
    let count = 0;
    students.forEach((s) => {
      const note = noteDraft[s.student_id];
      if (note !== undefined && note !== (s.note ?? "")) count += 1;
      const nf = newFriendDraft[s.student_id];
      if (nf) {
        if (parseCount(nf.male) !== s.new_friend_male_count) count += 1;
        else if (parseCount(nf.female) !== s.new_friend_female_count) count += 1;
      }
    });
    teachers.forEach((t) => {
      const note = teacherNoteDraft[t.teacher_id];
      if (note !== undefined && note !== (t.note ?? "")) count += 1;
    });
    return count;
  }, [students, teachers, noteDraft, teacherNoteDraft, newFriendDraft]);

  const flushDrafts = async () => {
    let saved = 0;
    let failed = 0;
    for (const row of students) {
      const note = noteDraft[row.student_id];
      if (note !== undefined && note !== (row.note ?? "")) {
        if (await persistNote(row, note)) saved += 1; else failed += 1;
      }
      const nf = newFriendDraft[row.student_id];
      if (nf) {
        const male = parseCount(nf.male);
        const female = parseCount(nf.female);
        if (male !== row.new_friend_male_count || female !== row.new_friend_female_count) {
          if (await persistNewFriends(row, male, female)) saved += 1; else failed += 1;
        }
      }
    }
    for (const row of teachers) {
      const note = teacherNoteDraft[row.teacher_id];
      if (note !== undefined && note !== (row.note ?? "")) {
        if (await persistTeacherNote(row, note)) saved += 1; else failed += 1;
      }
    }
    return { saved, failed };
  };

  const handleSave = async () => {
    setSaving(true);
    const { saved, failed } = await flushDrafts();
    setSaving(false);
    if (failed > 0) return; // 실패 사유는 각 저장 함수가 토스트로 알린다
    showToast(saved > 0 ? `${saved}건 저장했습니다` : "이미 모두 저장되어 있습니다");
  };

  // ── 통계 ──

  const gradeYears = useMemo(() => {
    const set = new Set<number>();
    students.forEach((s) => { if (s.grade_year) set.add(s.grade_year); });
    return Array.from(set).sort((a, b) => a - b);
  }, [students]);

  const attend = useMemo(() => {
    const rows: GradeTally[] = gradeYears.map((grade) => ({ grade, male: 0, female: 0, total: 0 }));
    const byGrade = new Map(rows.map((r) => [r.grade, r]));
    const total: Tally = { male: 0, female: 0, total: 0 };
    students.forEach((s) => {
      if (s.status !== "참석") return;
      const male = s.gender === "M" || s.gender === "남";
      const female = s.gender === "F" || s.gender === "여";
      total.total += 1;
      if (male) total.male += 1;
      if (female) total.female += 1;
      const row = s.grade_year ? byGrade.get(s.grade_year) : undefined;
      if (row) {
        row.total += 1;
        if (male) row.male += 1;
        if (female) row.female += 1;
      }
    });
    return { rows, total };
  }, [students, gradeYears]);

  const newFriend = useMemo(() => {
    const rows: GradeTally[] = gradeYears.map((grade) => ({ grade, male: 0, female: 0, total: 0 }));
    const byGrade = new Map(rows.map((r) => [r.grade, r]));
    const total: Tally = { male: 0, female: 0, total: 0 };
    students.forEach((s) => {
      const male = s.new_friend_male_count || 0;
      const female = s.new_friend_female_count || 0;
      if (male === 0 && female === 0) return;
      total.male += male;
      total.female += female;
      total.total += male + female;
      const row = s.grade_year ? byGrade.get(s.grade_year) : undefined;
      if (row) {
        row.male += male;
        row.female += female;
        row.total += male + female;
      }
    });
    return { rows, total };
  }, [students, gradeYears]);

  const teacherStats = useMemo(() => ({
    present: teachers.filter((t) => t.status === "참석").length,
    total: teachers.length,
  }), [teachers]);

  // 참석 명단에 담임 상태를 붙이기 위한 이름 → 상태 맵.
  // edu_participation_list 는 담임을 teacher_name(텍스트)로만 주므로 이름으로 맞춘다.
  const teacherStatusByName = useMemo(() => {
    const map = new Map<string, "" | "참석" | "불참">();
    teachers.forEach((t) => {
      const key = t.name?.trim();
      if (key && !map.has(key)) map.set(key, t.status);
    });
    return map;
  }, [teachers]);

  const classGroups = useMemo(() => groupByClass(students), [students]);
  const presentTeachers = useMemo(() => teachers.filter((t) => t.status === "참석"), [teachers]);
  // 참석 명단(화면·카톡 공통) — 반 목록은 학생 참석 여부와 무관하게 전부 만들고(담임
  // 참여여부를 반마다 보여주기 위해), 각 반 안에는 참석 체크된 학생만 담는다.
  const rosterClassGroups = useMemo(
    () => groupByClass(students).map(({ classNo, students: rows }) => ({
      classNo,
      head: rows[0],
      present: rows.filter((r) => r.status === "참석"),
    })),
    [students],
  );

  // ── 카톡 공유용 텍스트 ──

  /** "홍길동 선생님 참석" — 담임 이름 + 참여여부(미입력 포함) */
  const teacherLabelWithStatus = (teacherName: string) =>
    `${teacherName} 선생님 ${teacherStatusByName.get(teacherName.trim()) || "미입력"}`;

  const buildOutputText = () => {
    const lines: string[] = [];
    lines.push(`[${deptName || "부서"} 참여현황] ${dateLabel(date)}`);
    lines.push("");
    lines.push(`■ 학생 출석 — 총 ${attend.total.total}명 (남${attend.total.male}·여${attend.total.female})`);
    if (attend.rows.length === 0) {
      lines.push("  등록된 학생이 없습니다");
    } else {
      attend.rows.forEach((r) => lines.push(`  ${r.grade}학년 ${r.total}명 (남${r.male}·여${r.female})`));
    }
    lines.push("");
    lines.push(`■ 새친구 — 총 ${newFriend.total.total}명 (남${newFriend.total.male}·여${newFriend.total.female})`);
    if (newFriend.total.total === 0) {
      lines.push("  없음");
    } else {
      newFriend.rows.forEach((r) => lines.push(`  ${r.grade}학년 ${r.total}명 (남${r.male}·여${r.female})`));
    }
    lines.push("");
    lines.push(`■ 교사 출석 — ${teacherStats.present}/${teacherStats.total}명`);
    lines.push("");
    lines.push("■ 참석 명단");
    if (rosterClassGroups.length === 0 && presentTeachers.length === 0) {
      lines.push("  참석 체크된 인원이 없습니다");
    } else {
      rosterClassGroups.forEach(({ head, present }) => {
        const teacher = head.teacher_name ? ` (${teacherLabelWithStatus(head.teacher_name)})` : "";
        lines.push(`· ${classLabel(head)}${teacher} ${present.length}명`);
        if (present.length === 0) {
          lines.push("  - 참석 체크된 학생 없음");
        }
        present.forEach((r) => {
          const parts = [`${r.name}${genderLabel(r.gender) ? `(${genderLabel(r.gender)})` : ""}`];
          const friends = (r.new_friend_male_count || 0) + (r.new_friend_female_count || 0);
          if (friends > 0) parts.push(`새친구 ${friends}명`);
          if (r.note && r.note.trim()) parts.push(r.note.trim());
          lines.push(`  - ${parts.join(" / ")}`);
        });
      });
      if (presentTeachers.length > 0) {
        lines.push(`· 교사 ${presentTeachers.length}명`);
        presentTeachers.forEach((t) => {
          const parts = [`${t.name}${roleLabel(t.teacher_role) ? `(${roleLabel(t.teacher_role)})` : ""}`];
          if (t.note && t.note.trim()) parts.push(t.note.trim());
          lines.push(`  - ${parts.join(" / ")}`);
        });
      }
    }
    return lines.join("\n").trimEnd();
  };

  const doCopy = async () => {
    setSaving(true);
    const { failed } = await flushDrafts();
    setSaving(false);
    if (failed > 0) return;
    try {
      await navigator.clipboard.writeText(buildOutputText());
      showToast("복사되었습니다 — 카톡방에 붙여넣기 하세요");
    } catch {
      showToast("복사에 실패했습니다");
    }
  };

  // ── 렌더 ──

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
        <div style={{ marginBottom: 14 }}>
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
            <section style={cardStyle}>
              <div style={cardTitleStyle}>학생 출석 <span style={cardTitleSubStyle}>참석 체크 기준</span></div>
              <GradeStatTable rows={attend.rows} total={attend.total} emptyLabel="등록된 학생이 없습니다" />

              <div style={cardDividerStyle} />
              <div style={cardTitleStyle}>새친구 <span style={cardTitleSubStyle}>학생이 데려온 인원</span></div>
              <GradeStatTable rows={newFriend.rows} total={newFriend.total} emptyLabel="등록된 학생이 없습니다" />

              <div style={cardDividerStyle} />
              <div style={inlineStatStyle}>
                <span style={inlineStatLabelStyle}>교사 출석</span>
                <span style={inlineStatValueStyle}>{teacherStats.present}<span style={{ color: "var(--ink-faint)", fontWeight: 600 }}> / {teacherStats.total}명</span></span>
              </div>
            </section>

            {/* 참석 명단 (실시간) */}
            <section style={cardStyle}>
              <div style={cardTitleStyle}>
                참석 명단
                <span style={cardTitleSubStyle}>학생 {attend.total.total}명 · 교사 {teacherStats.present}명</span>
              </div>
              {rosterClassGroups.length === 0 && presentTeachers.length === 0 ? (
                <div style={emptyLineStyle}>아직 참석 체크된 인원이 없습니다</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                  {rosterClassGroups.map(({ classNo, head, present }) => {
                    return (
                      <div key={classNo}>
                        <div style={rosterGroupTitleStyle}>
                          <span>
                            {classLabel(head)}
                            {head.teacher_name && (
                              <>
                                {` · ${head.teacher_name} 선생님`}
                                <TeacherStatusChip status={teacherStatusByName.get(head.teacher_name.trim()) ?? ""} />
                              </>
                            )}
                          </span>
                          <span style={{ color: "var(--ink-faint)", fontWeight: 700 }}>{present.length}명</span>
                        </div>
                        {present.length === 0 && <div style={rosterEmptyRowStyle}>참석 체크된 학생이 없습니다</div>}
                        {present.map((r) => {
                          const friends = (r.new_friend_male_count || 0) + (r.new_friend_female_count || 0);
                          return (
                            <div key={r.student_id} style={rosterRowStyle}>
                              <span style={{ fontWeight: 600 }}>{r.name}</span>
                              {genderLabel(r.gender) && <span style={rosterMetaStyle}>{genderLabel(r.gender)}</span>}
                              {friends > 0 && <span style={rosterBadgeStyle}>새친구 {friends}</span>}
                              {r.note && r.note.trim() && <span style={rosterNoteStyle}>{r.note.trim()}</span>}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {presentTeachers.length > 0 && (
                    <div>
                      <div style={rosterGroupTitleStyle}>
                        <span>교사</span>
                        <span style={{ color: "var(--ink-faint)", fontWeight: 700 }}>{presentTeachers.length}명</span>
                      </div>
                      {presentTeachers.map((t) => (
                        <div key={t.teacher_id} style={rosterRowStyle}>
                          <span style={{ fontWeight: 600 }}>{t.name}</span>
                          {roleLabel(t.teacher_role) && <span style={rosterMetaStyle}>{roleLabel(t.teacher_role)}</span>}
                          {t.note && t.note.trim() && <span style={rosterNoteStyle}>{t.note.trim()}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            <div style={hintStyle}>
              참석·불참 체크는 누르는 즉시 저장됩니다. 비고와 새친구 수는 입력칸을 벗어날 때 저장되며,
              아래 <strong style={{ fontWeight: 700 }}>저장</strong> 버튼으로 한 번에 확정할 수 있습니다.
            </div>

            {/* 교사 체크 */}
            {teachers.length > 0 && (
              <section style={cardStyle}>
                <div style={cardTitleStyle}>교사 체크 <span style={cardTitleSubStyle}>{teachers.length}명</span></div>
                {teachers.map((row) => (
                  <div key={row.teacher_id} style={checkRowStyle}>
                    <div style={checkRowTopStyle}>
                      <button
                        type="button"
                        onClick={() => cycleTeacherStatus(row)}
                        style={{
                          ...statusPillStyle,
                          background: `color-mix(in srgb, ${STATUS_COLOR[row.status]} 14%, transparent)`,
                          color: STATUS_COLOR[row.status],
                        }}
                      >
                        {row.status || "미체크"}
                      </button>
                      <span style={personNameStyle}>
                        {row.name}
                        {roleLabel(row.teacher_role) && <span style={personMetaStyle}> {roleLabel(row.teacher_role)}</span>}
                      </span>
                      <input
                        type="text"
                        placeholder="비고"
                        value={teacherNoteDraft[row.teacher_id] ?? row.note ?? ""}
                        onChange={(e) => setTeacherNoteDraft((prev) => ({ ...prev, [row.teacher_id]: e.target.value }))}
                        onBlur={(e) => {
                          if (e.target.value !== (row.note ?? "")) persistTeacherNote(row, e.target.value);
                        }}
                        style={noteInputStyle}
                      />
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* 반별 학생 체크 */}
            {classGroups.length === 0 ? (
              <div style={emptyLineStyle}>등록된 학생이 없습니다</div>
            ) : (
              classGroups.map(({ classNo, students: rows }) => {
                const head = rows[0];
                const presentCount = rows.filter((r) => r.status === "참석").length;
                return (
                  <section key={classNo} style={cardStyle}>
                    <div style={cardTitleStyle}>
                      {classLabel(head)}
                      <span style={cardTitleSubStyle}>
                        {head.teacher_name ? `${head.teacher_name} 선생님 · ` : ""}참석 {presentCount}/{rows.length}
                      </span>
                    </div>
                    {rows.map((row) => {
                      const draft = newFriendDraft[row.student_id];
                      const maleValue = draft?.male ?? String(row.new_friend_male_count);
                      const femaleValue = draft?.female ?? String(row.new_friend_female_count);
                      return (
                        <div key={row.student_id} style={checkRowStyle}>
                          <div style={checkRowTopStyle}>
                            <button
                              type="button"
                              onClick={() => cycleStatus(row)}
                              style={{
                                ...statusPillStyle,
                                background: `color-mix(in srgb, ${STATUS_COLOR[row.status]} 14%, transparent)`,
                                color: STATUS_COLOR[row.status],
                              }}
                            >
                              {row.status || "미체크"}
                            </button>
                            <span style={personNameStyle}>
                              {row.name}
                              {genderLabel(row.gender) && <span style={personMetaStyle}> {genderLabel(row.gender)}</span>}
                            </span>
                          </div>
                          <div style={checkRowBottomStyle}>
                            <div style={newFriendGroupStyle}>
                              <span style={newFriendLabelStyle}>새친구</span>
                              <label style={newFriendFieldStyle}>
                                남
                                <input
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  value={maleValue}
                                  onChange={(e) => setNewFriendDraft((prev) => ({
                                    ...prev,
                                    [row.student_id]: { female: femaleValue, male: e.target.value },
                                  }))}
                                  onBlur={(e) => {
                                    const male = parseCount(e.target.value);
                                    const female = parseCount(femaleValue);
                                    if (male !== row.new_friend_male_count || female !== row.new_friend_female_count) {
                                      persistNewFriends(row, male, female);
                                    }
                                  }}
                                  style={newFriendInputStyle}
                                />
                              </label>
                              <label style={newFriendFieldStyle}>
                                여
                                <input
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  value={femaleValue}
                                  onChange={(e) => setNewFriendDraft((prev) => ({
                                    ...prev,
                                    [row.student_id]: { male: maleValue, female: e.target.value },
                                  }))}
                                  onBlur={(e) => {
                                    const male = parseCount(maleValue);
                                    const female = parseCount(e.target.value);
                                    if (male !== row.new_friend_male_count || female !== row.new_friend_female_count) {
                                      persistNewFriends(row, male, female);
                                    }
                                  }}
                                  style={newFriendInputStyle}
                                />
                              </label>
                            </div>
                            <input
                              type="text"
                              placeholder="비고 (특이사항)"
                              value={noteDraft[row.student_id] ?? row.note ?? ""}
                              onChange={(e) => setNoteDraft((prev) => ({ ...prev, [row.student_id]: e.target.value }))}
                              onBlur={(e) => {
                                if (e.target.value !== (row.note ?? "")) persistNote(row, e.target.value);
                              }}
                              style={noteInputStyle}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </section>
                );
              })
            )}

            {/* 하단 고정 액션 */}
            <div style={actionBarStyle}>
              <button type="button" onClick={handleSave} disabled={saving} style={saveButtonStyle}>
                <Save size={15} strokeWidth={2} /> 저장{pendingCount > 0 ? ` (${pendingCount})` : ""}
              </button>
              <button type="button" onClick={doCopy} disabled={saving} style={copyButtonStyle}>
                <Copy size={15} strokeWidth={2} /> 통계·명단 복사
              </button>
            </div>
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
const containerStyle: CSSProperties = { maxWidth: 640, margin: "0 auto", padding: "20px 16px 24px" };
const eyebrowStyle: CSSProperties = { fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 600 };
const titleStyle: CSSProperties = { fontSize: 20, fontWeight: 800, color: "var(--ink)", margin: "2px 0 0" };
const dateBarStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 14 };
const iconButtonStyle: CSSProperties = { width: 34, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--card)", color: "var(--ink-mid)", cursor: "pointer" };
const dateInputStyle: CSSProperties = { padding: "8px 10px", border: "1.5px solid var(--hairline)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "var(--card)", color: "var(--ink)" };

const cardStyle: CSSProperties = { background: "var(--card)", borderRadius: 14, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const cardTitleStyle: CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, fontSize: 13.5, fontWeight: 800, color: "var(--ink)", marginBottom: 8 };
const cardTitleSubStyle: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--ink-faint)", textAlign: "right" };
const cardDividerStyle: CSSProperties = { height: 1, background: "var(--hairline)", margin: "14px 0" };
const emptyLineStyle: CSSProperties = { fontSize: 12.5, color: "var(--ink-faint)", padding: "6px 0" };

const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" };
const thStyle: CSSProperties = { padding: "4px 6px", textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--ink-faint)", borderBottom: "1px solid var(--hairline)" };
const tdStyle: CSSProperties = { padding: "6px", textAlign: "center", fontSize: 13, fontWeight: 500, color: "var(--ink-mid)" };
const totalTdStyle: CSSProperties = { padding: "7px 6px", textAlign: "center", fontSize: 13.5, fontWeight: 800, color: "var(--ink)", borderTop: "1px solid var(--hairline)" };

const inlineStatStyle: CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 };
const inlineStatLabelStyle: CSSProperties = { fontSize: 13.5, fontWeight: 800, color: "var(--ink)" };
const inlineStatValueStyle: CSSProperties = { fontSize: 15, fontWeight: 800, color: "var(--accent-strong)" };

const rosterGroupTitleStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, fontWeight: 800, color: "var(--ink-soft)", padding: "4px 0", borderBottom: "1px solid var(--hairline)", marginBottom: 3 };
const rosterRowStyle: CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, fontSize: 12.5, color: "var(--ink)", padding: "2px 0" };
const rosterMetaStyle: CSSProperties = { fontSize: 11, color: "var(--ink-faint)", fontWeight: 600 };
const rosterBadgeStyle: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--accent-strong)", background: "color-mix(in srgb, var(--accent) 12%, transparent)", padding: "1px 6px", borderRadius: 999 };
const teacherStatusChipStyle: CSSProperties = { display: "inline-block", marginLeft: 6, padding: "1px 7px", borderRadius: 999, fontSize: 10.5, fontWeight: 800, verticalAlign: "middle", whiteSpace: "nowrap" };
const rosterEmptyRowStyle: CSSProperties = { fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 500, padding: "2px 0" };
const rosterNoteStyle: CSSProperties = { fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 500 };

const hintStyle: CSSProperties = { fontSize: 11.5, lineHeight: 1.6, color: "var(--ink-faint)", padding: "2px 4px 12px" };

const checkRowStyle: CSSProperties = { padding: "8px 0", borderTop: "1px solid var(--hairline)" };
const checkRowTopStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const checkRowBottomStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginTop: 6, paddingLeft: 64 };
const statusPillStyle: CSSProperties = { flexShrink: 0, width: 56, padding: "7px 0", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };
const personNameStyle: CSSProperties = { fontSize: 14, fontWeight: 700, color: "var(--ink)", flex: "0 1 auto", minWidth: 0 };
const personMetaStyle: CSSProperties = { fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 600 };

const newFriendGroupStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 8, background: "var(--bg-soft)", flexShrink: 0 };
const newFriendLabelStyle: CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--ink-faint)" };
const newFriendFieldStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: "var(--ink-soft)" };
const newFriendInputStyle: CSSProperties = { width: 34, padding: "3px 2px", border: "1px solid var(--hairline)", borderRadius: 6, fontSize: 12, fontFamily: "inherit", background: "var(--card)", color: "var(--ink)", textAlign: "center" };
const noteInputStyle: CSSProperties = { flex: "1 1 90px", minWidth: 0, padding: "6px 8px", border: "1px solid var(--hairline)", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", background: "var(--card)", color: "var(--ink)" };

const actionBarStyle: CSSProperties = { position: "sticky", bottom: 0, display: "flex", gap: 8, padding: "10px 0 4px", background: "linear-gradient(to top, var(--bg-soft) 70%, transparent)", zIndex: 5 };
const saveButtonStyle: CSSProperties = { flex: "0 0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px 18px", background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--accent)", borderRadius: 10, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };
const copyButtonStyle: CSSProperties = { flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const toastStyle: CSSProperties = { position: "fixed", bottom: 88, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap" };
