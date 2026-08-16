// 부서 등급(grade) ↔ 표시 직책(role) 규칙 — DB의 edu_role_grade / edu_resolve_role_label 과 같은 정책.
//
// grade  = 권한 등급 (0~4)
// role   = 실제 표시 직책. 한 등급이 여러 직책을 가질 수 있다 (grade 2 = 부부장·총무·서기).
// 등급만 바꿨다고 총무/서기 같은 구체 직책이나 사용자가 직접 넣은 직책을 잃지 않는다.

export const GRADE_OPTIONS = [
  { value: 0, label: "0 — 전도사 / 교육사" },
  { value: 1, label: "1 — 부장" },
  { value: 2, label: "2 — 부부장 / 총무 / 서기" },
  { value: 3, label: "3 — 교사" },
  { value: 4, label: "4 — 학부모" },
];

export const ROLE_OPTIONS: { grade: number; role: string; label: string }[] = [
  { grade: 0, role: "전도사",  label: "전도사 / 교육사" },
  { grade: 1, role: "부장",    label: "부장" },
  { grade: 2, role: "부부장",  label: "부부장" },
  { grade: 2, role: "총무",    label: "총무" },
  { grade: 2, role: "서기",    label: "서기" },
  { grade: 3, role: "교사",    label: "교사" },
  { grade: 4, role: "학부모",  label: "학부모" },
];

const ROLE_TO_GRADE: Record<string, number> = {
  전도사: 0, 교육사: 0,
  부장: 1,
  부부장: 2, 총무: 2, 서기: 2,
  교사: 3,
  학부모: 4,
};

const DEFAULT_ROLE_BY_GRADE: Record<number, string> = {
  0: "전도사", 1: "부장", 2: "부부장", 3: "교사", 4: "학부모",
};

// 가입 신청 경로에서 들어온 레거시 라벨 — 등급 기본 직책으로 교체해도 되는 값
const REPLACEABLE = new Set(["member", "teacher", "leader", "parent", "student", "staff"]);

/** 표준 직책이면 해당 등급, 사용자 지정·레거시 라벨이면 null */
export function roleGrade(role: string | null | undefined): number | null {
  const r = (role || "").trim();
  if (!r) return null;
  return r in ROLE_TO_GRADE ? ROLE_TO_GRADE[r] : null;
}

/** 비어 있거나 레거시 영문 라벨이면 true (덮어써도 되는 값) */
export function isReplaceableRole(role: string | null | undefined): boolean {
  const r = (role || "").trim();
  if (!r) return true;
  return REPLACEABLE.has(r.toLowerCase());
}

export function defaultRoleForGrade(grade: number): string {
  return DEFAULT_ROLE_BY_GRADE[grade] ?? "교사";
}

/**
 * 등급이 바뀔 때 표시 직책을 어떻게 할지 결정한다.
 *  - 비어 있음/레거시 라벨 → 등급 기본 직책
 *  - 사용자 지정 직책(예: 부감) → 보존
 *  - 같은 등급의 직책(총무·서기) → 보존
 *  - 다른 등급의 직책 → 등급 기본 직책
 */
export function resolveRoleLabel(grade: number, current: string | null | undefined): string {
  if (isReplaceableRole(current)) return defaultRoleForGrade(grade);
  const cur = (current as string).trim();
  const g = roleGrade(cur);
  if (g === null) return cur;
  return g === grade ? cur : defaultRoleForGrade(grade);
}

/** 교사 출석 대상 등급인지 (학부모 grade 4 는 교사 명단에 넣지 않는다) */
export function isTeacherRosterGrade(grade: number | null | undefined): boolean {
  return typeof grade === "number" && grade >= 0 && grade <= 3;
}
