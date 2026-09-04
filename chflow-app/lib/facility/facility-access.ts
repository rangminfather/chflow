/* ============================================================
   시설 사용신청 접근 권한

   교회 결정: **목사 ~ 서리집사** 직분과 **청년·청소년** 은 쓸 수 있고,
   일반 성도와 청소년 미만(어린이·유아·영아)은 쓸 수 없다.
   청년부·청소년부 아이들이 직접 신청하는 경우가 있어 그 둘은 열어 둔다.

   화면을 여는 조건과 예약 현황(신청자 이름·목적·연락처)을 보는 조건이 같다.
   같은 시간을 원하는 사람끼리 협의하려면 서로 보여야 하기 때문이다.

   직분 문자열은 요람에서 온 그대로라 "부목사", "은퇴시무권사" 처럼 앞뒤가 붙는다.
   그래서 정확히 일치가 아니라 낱말 포함으로 본다 (DB facility_requester_ok() 와 같은 규칙).
   ============================================================ */

/** 직분 문자열에 이 낱말이 들어 있으면 신청할 수 있다 */
const ALLOWED_ROLE_WORDS = [
  "목사",   // 담임목사·부목사·은퇴목사
  "선교사",
  "전도사",
  "사모",
  "장로",   // 시무·원로·은퇴·명예
  "교육사",
  "간사",
  "집사",   // 시무집사·서리집사(남/여)
  "권사",   // 시무·명예시무·은퇴시무
  "청년",
  "청소년",
];

/** 시스템 역할이 이것이면 직분과 무관하게 열어 둔다 (결재자) */
const ALWAYS_ALLOWED_SYSTEM_ROLES = ["admin", "office", "pastor"];

export function canUseFacility(subRole: string | null | undefined, systemRole?: string | null): boolean {
  if (systemRole && ALWAYS_ALLOWED_SYSTEM_ROLES.includes(systemRole)) return true;
  const role = (subRole ?? "").trim();
  if (role === "") return false;
  return ALLOWED_ROLE_WORDS.some((word) => role.includes(word));
}

/** 막혔을 때 화면에 띄울 안내 */
export const FACILITY_ACCESS_NOTICE =
  "시설 사용신청은 서리집사 이상 직분과 청년·청소년만 이용할 수 있습니다. 필요하시면 담당 교역자나 부서 임원께 문의해 주세요.";
