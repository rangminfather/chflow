// 학생별 달란트 기간 집계 공용 로직 — 달란트통계·달란트잔치에서 사용
// 합계 = 자동적립(get_student_auto_talent_range) + 기타(edu_talent_records) + 공과퀴즈(edu_quiz_talent)

import { supabase } from "@/lib/supabase";

export const UNASSIGNED = "반 미배정";

export interface StudentRow {
  id: string;
  name: string;
  student_no: number | null;
  order_no: number | null;
  class_no: string | null;
  grade_year: number | null;
}

interface AutoTalentRow {
  total: number;
}

export interface StudentTotal {
  id: string;
  name: string;
  classLabel: string;
  auto: number;
  other: number;
  quiz: number;
  total: number;
  rank: number;
}

export function classLabel(student: { grade_year: number | null; class_no: string | null }) {
  if (!student.class_no) return UNASSIGNED;
  return `${student.grade_year ? `${student.grade_year}학년 ` : ""}${student.class_no}반`;
}

export async function fetchActiveStudents(deptId: string): Promise<StudentRow[]> {
  const { data } = await supabase
    .from("edu_students")
    .select("id, name, student_no, order_no, class_no, grade_year")
    .eq("department_id", deptId)
    .eq("is_active", true);
  return (data || []) as StudentRow[];
}

/** 한 기간(날짜 범위) 학생별 집계 — 동점자 동일 순위(경쟁 순위) 포함, 합계 내림차순 정렬 */
export async function buildHalfTotals(
  deptId: string,
  students: StudentRow[],
  dateFrom: string,
  dateTo: string,
): Promise<StudentTotal[]> {
  const otherQuery = supabase
    .from("edu_talent_records")
    .select("student_id, pts_other, record_date")
    .eq("department_id", deptId)
    .gte("record_date", dateFrom)
    .lte("record_date", dateTo);
  const quizQuery = supabase
    .from("edu_quiz_talent")
    .select("student_id, points, quiz_date")
    .eq("department_id", deptId)
    .gte("quiz_date", dateFrom)
    .lte("quiz_date", dateTo);

  const [otherResp, quizResp, ...autoResults] = await Promise.all([
    otherQuery,
    quizQuery,
    ...students.map((student) =>
      supabase.rpc("get_student_auto_talent_range", {
        p_student_id: student.id,
        p_date_from: dateFrom,
        p_date_to: dateTo,
      }),
    ),
  ]);

  const otherMap: Record<string, number> = {};
  ((otherResp.data || []) as { student_id: string; pts_other: number | null }[]).forEach((row) => {
    otherMap[row.student_id] = (otherMap[row.student_id] || 0) + (row.pts_other || 0);
  });

  const quizMap: Record<string, number> = {};
  ((quizResp.data || []) as { student_id: string; points: number | null }[]).forEach((row) => {
    quizMap[row.student_id] = (quizMap[row.student_id] || 0) + (row.points || 0);
  });

  const list: StudentTotal[] = students.map((student, index) => {
    const autoRows = (autoResults[index]?.data || []) as AutoTalentRow[];
    const auto = autoRows.reduce((sum, row) => sum + (row.total || 0), 0);
    const other = otherMap[student.id] || 0;
    const quiz = quizMap[student.id] || 0;
    return {
      id: student.id,
      name: student.name,
      classLabel: classLabel(student),
      auto,
      other,
      quiz,
      total: auto + other + quiz,
      rank: 0,
    };
  });

  list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ko"));
  list.forEach((item, index) => {
    item.rank = index > 0 && list[index - 1].total === item.total ? list[index - 1].rank : index + 1;
  });
  return list;
}

/** 출력·배부용 정렬: 반 → 이름 순 */
export function sortForHandout(items: StudentTotal[]): StudentTotal[] {
  return [...items].sort((a, b) =>
    a.classLabel.localeCompare(b.classLabel, "ko") || a.name.localeCompare(b.name, "ko"));
}
