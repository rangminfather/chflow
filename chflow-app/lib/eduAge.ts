// 부서별 학년/나이 개념 헬퍼 — 교육사역국 진급 체인 전체를 고려한다.
//  나이 기반 부서(grade_year = 세는나이): 영아부 1~3세 → 유아부 4~5세 → 유치부 6~7세,
//    청소년부 14~19세. 출생연도 = 올해 - 나이 + 1 (2026년 4세 = 2023년생)
//  학년 기반 부서(grade_year = 학년): 초등1부 1~3학년, 초등2부 4~6학년.
//    출생연도 = 올해 - 6 - 학년 (2026년 초1 = 2019년생)
//  미취학 부서(영아·유아·유치)는 학교 대신 어린이집·유치원을 적는다(필수 아님).
//  DB(promote_finalize)의 '세'/'학년' 표기 분기와 부서명 목록이 일치해야 한다.

const AGE_DEPTS: Record<string, number[]> = {
  영아부: [1, 2, 3],
  유아부: [4, 5],
  유치부: [6, 7],
  청소년부: [14, 15, 16, 17, 18, 19],
};

const PRESCHOOL_DEPTS = new Set(["영아부", "유아부", "유치부"]);

export function isAgeBasedDept(deptName?: string | null): boolean {
  return !!AGE_DEPTS[(deptName || "").trim()];
}

/** 나이 기반 부서의 필수 선택 나이 목록 (학년 기반 부서는 빈 배열) */
export function ageOptionsFor(deptName?: string | null): number[] {
  return AGE_DEPTS[(deptName || "").trim()] || [];
}

/** 학년(또는 나이) → 출생연도. 수정 가능한 기본값으로 쓴다. */
export function birthYearForGrade(deptName: string | null | undefined, gradeYear: number): string {
  const year = new Date().getFullYear();
  return String(isAgeBasedDept(deptName) ? year - gradeYear + 1 : year - 6 - gradeYear);
}

/** "학년" | "나이" — 폼 라벨용 */
export function gradeFieldLabel(deptName?: string | null): string {
  return isAgeBasedDept(deptName) ? "나이" : "학년";
}

/** grade_year 값 표시: "3학년" | "4세" */
export function gradeText(deptName: string | null | undefined, gradeYear: number | null | undefined): string {
  if (!gradeYear) return "";
  return `${gradeYear}${isAgeBasedDept(deptName) ? "세" : "학년"}`;
}

/** "학교" | "어린이집·유치원" */
export function schoolFieldLabel(deptName?: string | null): string {
  return PRESCHOOL_DEPTS.has((deptName || "").trim()) ? "어린이집·유치원" : "학교";
}

export function schoolFieldPlaceholder(deptName?: string | null): string {
  return PRESCHOOL_DEPTS.has((deptName || "").trim()) ? "어린이집명 혹은 유치원명" : "학교명";
}
