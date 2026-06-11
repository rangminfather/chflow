// 직분 정의 - PPT 슬라이드 4 순서 (21개)
export type RoleId =
  | "pastor" | "missionary" | "evangelist" | "pastor_wife"
  | "elder" | "educator" | "coordinator" | "serving_deacon"
  | "deaconess" | "acting_deacon_male" | "acting_deacon_female"
  | "member_male" | "member_female"
  | "youth_male" | "youth_female"
  | "teen_male" | "teen_female"
  | "child_male" | "child_female"
  | "toddler_male" | "toddler_female";

export interface SubRole {
  label: string;
  image: string;
}

export interface Role {
  id: RoleId;
  label: string;
  image: string;
  subRoles?: SubRole[];
}

export const ROLES: Role[] = [
  {
    id: "pastor",
    label: "목사",
    image: "/roles/01_pastor.png",
    subRoles: [
      { label: "담임목사", image: "/roles/sub_pastor_senior.png" },
      { label: "부목사",   image: "/roles/sub_pastor_assistant.png" },
      { label: "은퇴목사", image: "/roles/sub_pastor_retired.png" },
    ],
  },
  { id: "missionary", label: "선교사", image: "/roles/02_missionary.png" },
  { id: "evangelist", label: "전도사", image: "/roles/03_evangelist.png" },
  { id: "pastor_wife", label: "사모", image: "/roles/04_pastor_wife.png" },
  {
    id: "elder",
    label: "장로",
    image: "/roles/05_elder.png",
    subRoles: [
      { label: "시무장로", image: "/roles/sub_elder_serving.png" },
      { label: "원로장로", image: "/roles/sub_elder_senior.png" },
      { label: "은퇴장로", image: "/roles/sub_elder_retired.png" },
      { label: "명예장로", image: "/roles/sub_elder_honorary.png" },
    ],
  },
  { id: "educator", label: "교육사", image: "/roles/06_educator.png" },
  { id: "coordinator", label: "간사", image: "/roles/07_coordinator.png" },
  {
    id: "serving_deacon",
    label: "시무집사",
    image: "/roles/08_serving_deacon.png",
    subRoles: [
      { label: "시무집사",   image: "/roles/sub_serving_deacon_active.png" },
      { label: "명예시무집사", image: "/roles/sub_serving_deacon_honorary.png" },
      { label: "은퇴시무집사", image: "/roles/sub_serving_deacon_retired.png" },
    ],
  },
  {
    id: "deaconess",
    label: "권사",
    image: "/roles/09_deaconess.png",
    subRoles: [
      { label: "시무권사",   image: "/roles/sub_deaconess_active.png" },
      { label: "명예시무권사", image: "/roles/sub_deaconess_honorary.png" },
      { label: "은퇴시무권사", image: "/roles/sub_deaconess_retired.png" },
    ],
  },
  { id: "acting_deacon_male", label: "서리집사 (남)", image: "/roles/10_acting_deacon_male.png" },
  { id: "acting_deacon_female", label: "서리집사 (여)", image: "/roles/11_acting_deacon_female.png" },
  { id: "member_male", label: "성도 (남)", image: "/roles/12_member_male.png" },
  { id: "member_female", label: "성도 (여)", image: "/roles/13_member_female.png" },
  { id: "youth_male", label: "청년 (남)", image: "/roles/14_youth_male.png" },
  { id: "youth_female", label: "청년 (여)", image: "/roles/15_youth_female.png" },
  { id: "teen_male", label: "청소년 (남)", image: "/roles/16_teen_male.png" },
  { id: "teen_female", label: "청소년 (여)", image: "/roles/17_teen_female.png" },
  { id: "child_male", label: "어린이 (남)", image: "/roles/18_child_male.png" },
  { id: "child_female", label: "어린이 (여)", image: "/roles/19_child_female.png" },
  { id: "toddler_male", label: "유아 (남)", image: "/roles/20_toddler_male.png" },
  { id: "toddler_female", label: "유아 (여)", image: "/roles/21_toddler_female.png" },
];

// 시스템 역할 매핑 (직분 → 권한)
export function mapToSystemRole(roleId: RoleId): string {
  if (["pastor", "evangelist", "pastor_wife"].includes(roleId)) return "pastor";
  if (["elder", "educator"].includes(roleId)) return "leader";
  return "member";
}

// =============================================================
// sub_role 문자열 → 이미지 경로 매핑
// 관리자가 DB에서 sub_role을 바꾸면 자동으로 이미지도 따라감
// =============================================================
// 라벨 별칭 (이름 변경 전 DB값 + 요람 직분 표기 호환)
const LABEL_ALIASES: Record<string, string> = {
  "교인 (남)": "성도 (남)",
  "교인 (여)": "성도 (여)",
  "교인(남)": "성도 (남)",
  "교인(여)": "성도 (여)",
  // 요람(members.sub_role) 표기 → 시스템 라벨
  // 관례: 권사 = 시무권사, 집사 = 서리집사, 장로 = 시무장로
  "권사": "시무권사",
  "명예권사": "명예시무권사",
  "은퇴권사": "은퇴시무권사",
  "협동권사": "시무권사",
  "장로": "시무장로",
  "집사": "서리집사",
  "협동시무집사": "시무집사",
  "초등학생": "어린이",
};

// 성별을 붙여야 완성되는 직분 (요람엔 "성도"/"청년"처럼 성별 없이 기록됨)
const GENDERED_BASES = ["성도", "청년", "청소년", "어린이", "유아", "서리집사"];

// 요람 직분 문자열 정규화: 별칭 치환 + 복수 직분("시무집사/권사")은 첫 직분 기준
function normalizeSubRoleLabel(value: string): string {
  let label = value.trim();
  if (LABEL_ALIASES[label]) label = LABEL_ALIASES[label];
  if (label.includes("/")) {
    label = label.split("/")[0].trim();
    if (LABEL_ALIASES[label]) label = LABEL_ALIASES[label];
  }
  return label;
}

// members.sub_role + 성별 → ROLES 매칭 (회원가입 직분 자동 고정용)
export function resolveRoleFromMemberSubRole(
  memberSubRole: string | null | undefined,
  gender?: string | null,
): { role: Role; subRole?: string } | null {
  if (!memberSubRole) return null;
  let label = normalizeSubRoleLabel(memberSubRole);

  const g = gender === "M" || gender === "남" ? "남"
    : gender === "F" || gender === "여" ? "여" : null;
  if (GENDERED_BASES.includes(label) && g) label = `${label} (${g})`;

  for (const role of ROLES) {
    if (role.label === label) return { role };
    const sub = role.subRoles?.find((s) => s.label === label);
    if (sub) return { role, subRole: sub.label };
  }
  // 띄어쓰기 차이 무시 재시도
  const stripped = label.replace(/\s+/g, "");
  for (const role of ROLES) {
    if (role.label.replace(/\s+/g, "") === stripped) return { role };
    const sub = role.subRoles?.find((s) => s.label.replace(/\s+/g, "") === stripped);
    if (sub) return { role, subRole: sub.label };
  }
  // 접두어 제거 fallback: "명예집사" → "집사"(=서리집사) 기준으로 재시도
  const prefixed = label.match(/^(명예|은퇴|원로|협동)(.+)$/);
  if (prefixed) return resolveRoleFromMemberSubRole(prefixed[2], gender);
  return null;
}

export function getRoleImageByLabel(label: string | null | undefined): string {
  if (!label) return "/roles/default.png";
  const normalized = normalizeSubRoleLabel(label);

  // 1. 서브직분 먼저 매칭 (담임목사, 시무장로 등)
  for (const role of ROLES) {
    if (role.subRoles) {
      const sub = role.subRoles.find((s) => s.label === normalized);
      if (sub) return sub.image;
    }
  }

  // 2. 메인 직분 매칭 (목사, 장로, 선교사 등)
  const main = ROLES.find((r) => r.label === normalized);
  if (main) return main.image;

  // 3. fallback - 띄어쓰기 차이 등 무시하고 재시도
  const stripped = normalized.replace(/\s+/g, "");
  for (const role of ROLES) {
    if (role.label.replace(/\s+/g, "") === stripped) return role.image;
    if (role.subRoles) {
      const sub = role.subRoles.find((s) => s.label.replace(/\s+/g, "") === stripped);
      if (sub) return sub.image;
    }
  }

  // 4. 접두어 제거 fallback: "명예집사" → "집사"(=서리집사) 이미지
  const prefixed = normalized.match(/^(명예|은퇴|원로|협동)(.+)$/);
  if (prefixed) return getRoleImageByLabel(prefixed[2]);

  return "/roles/default.png";
}

// 부모 직분 라벨 찾기 (예: "담임목사" → "목사")
export function getParentRoleLabel(subLabel: string | null | undefined): string | null {
  if (!subLabel) return null;
  for (const role of ROLES) {
    if (role.subRoles?.some((s) => s.label === subLabel)) return role.label;
  }
  return null;
}

// members.sub_role(요람 원본 직분)에 기반한 허용 라벨 목록 반환
// null이면 제한 없음, string[]이면 해당 그룹 내에서만 변경 가능
export function getLockedGroupLabels(membersSubRole: string | null | undefined): string[] | null {
  if (!membersSubRole) return null;
  const normalized = normalizeSubRoleLabel(membersSubRole);
  // 성별 구분 직분(성도, 청년 등)은 남/여 한 쌍 내에서만 변경 가능
  if (GENDERED_BASES.includes(normalized)) {
    return [`${normalized} (남)`, `${normalized} (여)`];
  }
  for (const role of ROLES) {
    if (role.label === normalized) {
      if (role.subRoles && role.subRoles.length > 0) {
        return [role.label, ...role.subRoles.map((s) => s.label)];
      }
      return [role.label];
    }
    if (role.subRoles?.some((s) => s.label === normalized)) {
      return [role.label, ...role.subRoles!.map((s) => s.label)];
    }
  }
  // 접두어 제거 fallback: "명예집사" → "집사"(=서리집사) 그룹으로 제한
  const prefixed = normalized.match(/^(명예|은퇴|원로|협동)(.+)$/);
  if (prefixed) return getLockedGroupLabels(prefixed[2]);
  return null;
}

// 승인 모달용: 전체 직분 라벨 flat 목록 (그룹 구분자 포함)
export interface SubRoleOption { label: string; isHeader: boolean }
export function getAllSubRoleOptions(): SubRoleOption[] {
  const result: SubRoleOption[] = [];
  for (const role of ROLES) {
    if (role.subRoles && role.subRoles.length > 0) {
      result.push({ label: role.label, isHeader: true });
      for (const sub of role.subRoles) {
        result.push({ label: sub.label, isHeader: false });
      }
    } else {
      result.push({ label: role.label, isHeader: false });
    }
  }
  return result;
}
