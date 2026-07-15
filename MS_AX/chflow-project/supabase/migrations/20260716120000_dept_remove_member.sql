-- =============================================================
-- 부서원 제외 (부서원관리 화면에서 구성원을 해당 부서에서 제외)
--
-- 범위 : 지정한 부서 한정. 앱 계정·다른 부서 소속에는 영향 없음.
-- 처리 :
--   1) edu_teachers 로스터  → 소프트 삭제(is_active=false, 출석 이력 보존)
--   2) dept_parent_children → 해당 부서 자녀 링크 삭제
--        (학부모 dm 은 trg_parent_auto_remove 트리거가 자동 삭제)
--   3) department_members   → 해당 부서 행 삭제 (남아 있으면)
-- 알림 : 보내지 않음 (조용히 처리)
-- 권한 : dept_mgmt_grade_ok(dept, 'dept/members-grade')
--        = 화면(list_dept_grade_members/upsert_member_grade)과 동일 게이트
-- 안전 : 본인은 제외 불가
--
-- 대상 지정: 화면 행은 teacher_id / user_id 를 노출하므로 둘 다 넘겨받아
--   있는 것만 처리한다. (앱 미가입 교사 = teacher_id 만, 학부모 = user_id 만)
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

  -- 1) 교사 로스터: 소프트 삭제 (출석/담임 이력 보존, edu_delete_teacher 와 동일 패턴)
  if p_teacher_id is not null then
    update public.edu_teachers
    set is_active = false
    where id = p_teacher_id
      and department_id = p_dept_id;
  end if;

  if p_user_id is not null then
    -- 2) 학부모-자녀 링크 정리 (해당 부서 한정)
    --    → 마지막 자녀 링크가 사라지면 trg_parent_auto_remove 가 학부모 dm 자동 삭제
    delete from public.dept_parent_children
    where department_id = p_dept_id
      and parent_user_id = p_user_id;

    -- 3) 남아 있는 부서 회원 행 삭제 (교사·임원 등 학부모 외 역할)
    delete from public.department_members
    where department_id = p_dept_id
      and user_id = p_user_id;
  end if;
end;
$$;
grant execute on function public.dept_remove_member(uuid, uuid, uuid) to authenticated;
