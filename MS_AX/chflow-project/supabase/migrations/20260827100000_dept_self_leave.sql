-- =============================================================
-- 부서 스스로 탈퇴 허용 (본인 제외 방지 해제)
--
-- [문제] dept_remove_member 는 `p_user_id = auth.uid()` 이면 무조건 거부했다.
--   다른 사람은 전도사·부장이 제외하면 되지만, 정작 전도사·교육사·부장 본인은
--   부서를 떠날 방법이 없어 교회 관리자(admin/office/pastor)에게 부탁해야 했다.
--   부서 운영자가 자기 소속을 정리하는 데 시스템 관리자를 거쳐야 하는 구조.
--
-- [변경] 본인 탈퇴를 허용한다. 권한 게이트(dept_mgmt_grade_ok)는 그대로라
--   원래 이 화면을 쓸 수 있는 사람만 호출할 수 있고, 그 사람이 자기 자신을
--   대상으로 지정하는 것만 추가로 허용된다. 남을 제외하는 규칙은 변함없다.
--
-- [일부러 막지 않는 것] 마지막 임원(grade 0~2)이 탈퇴해 부서에 임원이 0명이
--   되는 경우도 서버에서 막지 않는다. 막으면 결국 "관리자에게 부탁" 구조로
--   되돌아가기 때문이다. 대신 화면(members-grade)에서 그 상황을 경고하고,
--   임원이 0명이 되어도 교회 관리자는 get_user_grade 가 항상 0 이라 언제든
--   새 임원을 임명해 복구할 수 있다.
--
-- 나머지 동작(교사 로스터 소프트 삭제, 담임 지정 해제, 학부모-자녀 링크 정리,
-- 부서 회원 행 삭제)은 20260716130000 정의를 그대로 유지한다.
-- =============================================================

drop function if exists public.dept_remove_member(uuid, uuid, uuid);
create or replace function public.dept_remove_member(
  p_dept_id    uuid,
  p_user_id    uuid default null,
  p_teacher_id uuid default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') then
    raise exception '부서원 제외 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  end if;

  if p_user_id is null and p_teacher_id is null then
    raise exception '제외할 대상이 지정되지 않았습니다';
  end if;

  -- 본인 지정 = 스스로 탈퇴. 예전에는 여기서 거부했다.
  -- (전도사·부장이 부서를 떠나려고 관리자에게 부탁해야 했던 원인)

  -- 1) 교사 로스터: 소프트 삭제 (출석·담임 이력 보존)
  if p_teacher_id is not null then
    update public.edu_teachers
    set is_active = false
    where id = p_teacher_id
      and department_id = p_dept_id;

    -- 1-1) 담임 지정 자동 해제 (해당 부서 한정) — 반·학생 모두 미배정 처리
    update public.edu_classes
    set teacher_id = null
    where department_id = p_dept_id
      and teacher_id = p_teacher_id;

    update public.edu_students
    set teacher_id = null
    where department_id = p_dept_id
      and teacher_id = p_teacher_id;
  end if;

  if p_user_id is not null then
    -- 2) 학부모-자녀 링크 정리 (해당 부서 한정)
    --    → 마지막 자녀 링크가 사라지면 trg_parent_auto_remove 가 학부모 dm 자동 삭제
    delete from public.dept_parent_children
    where department_id = p_dept_id
      and parent_user_id = p_user_id;

    -- 3) 남아 있는 부서 회원 행 삭제
    delete from public.department_members
    where department_id = p_dept_id
      and user_id = p_user_id;
  end if;
end;
$$;
grant execute on function public.dept_remove_member(uuid, uuid, uuid) to authenticated;

-- 사후 확인: 오버로드가 1개만 남았는지
do $$
declare v_cnt int;
begin
  select count(*) into v_cnt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'dept_remove_member';
  if v_cnt <> 1 then
    raise exception '중단: dept_remove_member 오버로드가 %개다(1개여야 함)', v_cnt;
  end if;
end
$$;
