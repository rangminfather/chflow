-- =============================================================
-- dept_remove_member 보강: 담임이던 교사를 제외하면 담임 지정 자동 해제
--
-- edu_students.teacher_id / edu_classes.teacher_id 는 FK ON DELETE SET NULL 이라
-- 교사를 '하드 삭제'할 때만 자동 해제된다. 그러나 부서원 제외는 '소프트 삭제'
-- (is_active=false, 출석·담임 이력 보존)라 담임 지정이 그대로 남아 유령 담임이 된다.
-- → 소프트 삭제와 함께 해당 부서의 반·학생 담임 지정을 명시적으로 NULL 처리한다.
--   (출석 기록은 별도 테이블이라 보존됨. 반/학생은 담임 미배정 상태가 되어 재지정 가능)
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

  -- 본인 제외 방지
  if p_user_id is not null and p_user_id = auth.uid() then
    raise exception '본인은 제외할 수 없습니다';
  end if;

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
