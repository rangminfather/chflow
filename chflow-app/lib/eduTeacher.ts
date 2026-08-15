// 교육부서 교사(edu_teachers) identity 규칙 — DB 함수들과 같은 정책을 UI에서도 쓴다.
//
//  member_id = 성도(members) identity. 앱 미가입이어도 동일인 판별의 기준이 된다.
//  user_id   = 앱 계정 연결 정보. identity 를 대체하지 않는다.
//  수동 교사 = member_id, user_id 가 모두 없는 행 → 출석부 화면이 이름·직책의 주인
//  성도 교사 = member_id 가 있는 행 → 이름은 members, 직책은 부서원관리(임명·등급)가 원본

export interface TeacherIdentity {
  id: string;
  member_id: string | null;
  user_id: string | null;
  is_active?: boolean;
  created_at?: string | null;
}

/** 출석부 화면에서 직접 만든 교사 (성도·계정 어느 쪽과도 연결되지 않음) */
export function isManualTeacher(t: TeacherIdentity): boolean {
  return !t.member_id && !t.user_id;
}

/** 실제 성도와 연결된 교사. user_id 가 없어도(앱 미가입) 성도 교사다. */
export function isMemberTeacher(t: TeacherIdentity): boolean {
  return !!t.member_id;
}

/** 출석부 화면에서 이름·직책을 고칠 수 있는가 */
export function canEditInRoster(t: TeacherIdentity): boolean {
  return isManualTeacher(t);
}

/**
 * 같은 사람의 교사 행이 여러 개일 때 어느 행을 canonical 로 삼을지.
 * 성도 연결 행 > 활성 행 > 먼저 만들어진 행 순.
 */
export function pickCanonicalTeacher<T extends TeacherIdentity>(rows: T[]): T | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => {
    const byMember = Number(isMemberTeacher(b)) - Number(isMemberTeacher(a));
    if (byMember) return byMember;
    const byActive = Number(b.is_active !== false) - Number(a.is_active !== false);
    if (byActive) return byActive;
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  })[0];
}

/**
 * placeholder 를 실제 성도와 연결할 때 쓸 member_id 결정.
 * members.app_user_id = profiles.id 가 이 프로젝트의 identity 방향이므로 members 를 우선한다.
 * profiles.member_id 는 일부만 채워져 있어 보조 수단으로만 쓴다.
 */
export function resolveMemberIdForLink(input: {
  memberIdByAppUser?: string | null;
  profileMemberId?: string | null;
}): string | null {
  return input.memberIdByAppUser || input.profileMemberId || null;
}

/**
 * 목록에서 한 칸 위/아래로 이동한 새 배열을 돌려준다.
 * 행 자체(teacher id)는 그대로 두고 순서만 바꾼다 — 출석 기록에는 영향이 없다.
 */
export function moveInOrder<T extends { id: string }>(list: T[], id: string, dir: -1 | 1): T[] {
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return list;
  const target = idx + dir;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

/**
 * edu_save_teacher 에 넘길 인자. 수정은 반드시 기존 행 id 를 그대로 전달해
 * UPDATE 로 처리되게 한다 (삭제 후 재등록 금지 — 출석 이력이 갈라진다).
 */
export function buildSaveTeacherPayload(args: {
  editing: (TeacherIdentity & { order_no?: number }) | null;
  deptId: string;
  name: string;
  role: string;
}) {
  const { editing, deptId, name, role } = args;
  return {
    p_id: editing ? editing.id : null,
    p_dept_id: deptId,
    p_name: name.trim(),
    p_role: role.trim() || null,
    p_order_no: editing ? (editing.order_no ?? null) : null,
  };
}
