// 부서별 학년/나이 개념 헬퍼
//  - 초등부(기본): grade_year = 학년(1~6). 출생연도 = 올해 - 6 - 학년 (2026년 초1 = 2019년생)
//  - 유아부: grade_year = 세는나이(4·5세). 출생연도 = 올해 - 나이 + 1 (2026년 4세 = 2023년생)
//    반(목장)은 나이와 독립적으로 배정한다.

export function isNurseryDept(deptName?: string | null): boolean {
  return (deptName || "").trim() === "유아부";
}

/** 유아부 필수 선택 나이 */
export const NURSERY_AGE_OPTIONS = [4, 5];

/** 학년(또는 유아부 나이) → 출생연도. 수정 가능한 기본값으로 쓴다. */
export function birthYearForGrade(deptName: string | null | undefined, gradeYear: number): string {
  const year = new Date().getFullYear();
  return String(isNurseryDept(deptName) ? year - gradeYear + 1 : year - 6 - gradeYear);
}

/** "학년" | "나이" — 폼 라벨용 */
export function gradeFieldLabel(deptName?: string | null): string {
  return isNurseryDept(deptName) ? "나이" : "학년";
}

/** grade_year 값 표시: "3학년" | "4세" */
export function gradeText(deptName: string | null | undefined, gradeYear: number | null | undefined): string {
  if (!gradeYear) return "";
  return `${gradeYear}${isNurseryDept(deptName) ? "세" : "학년"}`;
}

/** "학교" | "어린이집·유치원" */
export function schoolFieldLabel(deptName?: string | null): string {
  return isNurseryDept(deptName) ? "어린이집·유치원" : "학교";
}

export function schoolFieldPlaceholder(deptName?: string | null): string {
  return isNurseryDept(deptName) ? "어린이집명 혹은 유치원명" : "학교명";
}
