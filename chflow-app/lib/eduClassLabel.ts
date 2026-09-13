// 반(학급) 라벨 규칙 — 부서마다 반 편성 축이 다르다.
//  · 학년 종속 편성(초등1·2부): 반이 학년별로 나뉜다 → "1학년 1-1반"
//  · 학년 독립 편성(유아부 목장반 등): 반이 나이와 무관하게 편성된다 → "1목장반"
//    (한 목장에 4세·5세가 섞여 있으므로 나이를 라벨·그룹 키에 넣으면 한 반이 쪼개진다)
//
// 판정은 부서명 하드코딩이 아니라 반 등록부(edu_classes / list_dept_classes_full)를 본다.
// 등록된 반이 전부 grade_year 없이 만들어졌으면 그 부서는 학년 독립 편성이다.
// 학년/나이 단위 표기 자체는 lib/eduAge.ts (gradeText) 가 단일 진실이다.

import { gradeText } from "./eduAge";

export type ClassRegistryRow = {
  class_no?: string | null;
  grade_year?: number | null;
  /** list_dept_classes_full 기준 — 학생 명부에서 파생된 반은 false */
  in_registry?: boolean | null;
};

/** 반 편성이 학년(나이)과 독립인 부서인지. 등록된 반이 없으면 기존대로 학년 종속으로 본다. */
export function isClassGradeIndependent(rows: ClassRegistryRow[] | null | undefined): boolean {
  const registered = (rows || []).filter(
    (row) => row.in_registry !== false && (row.class_no?.trim() ?? "") !== "",
  );
  if (registered.length === 0) return false;
  return registered.every((row) => row.grade_year == null);
}

/**
 * 반 라벨 앞에 붙일 학년/나이 접두 — "1학년" · "4세" · (학년 독립 편성이면) "".
 * 각 화면은 이 값이 비었는지만 보고 접두를 붙이거나 뺀다.
 */
export function classGradePrefix(
  deptName: string | null | undefined,
  gradeYear: number | null | undefined,
  gradeIndependent: boolean,
): string {
  if (gradeIndependent || !gradeYear) return "";
  return gradeText(deptName, gradeYear);
}

/** 그룹 키·정렬용 — 학년 독립 편성이면 학년을 키에서 빼서 한 반이 나이별로 쪼개지지 않게 한다. */
export function classGroupKeyOf(
  row: { class_no?: string | null; grade_year?: number | null },
  gradeIndependent: boolean,
  unassignedKey = "미배정",
): string {
  const classNo = row.class_no?.trim() || unassignedKey;
  return gradeIndependent ? `class:${classNo}` : `grade:${row.grade_year ?? 0}:class:${classNo}`;
}

/** 반 이름 정렬 (1목장 · 2목장 · 10목장 순서가 맞도록 숫자 인식) */
export const CLASS_NAME_COLLATOR = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
