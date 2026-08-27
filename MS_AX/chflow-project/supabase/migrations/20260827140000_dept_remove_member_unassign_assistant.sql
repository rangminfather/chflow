-- =============================================================
-- 부서원 제외·탈퇴 시 부담임 지정도 해제
--
-- [문제] dept_remove_member 는 정담임(edu_classes.teacher_id, edu_students.teacher_id)만
--   NULL 로 비우고 부담임(edu_classes.assistant_teacher_id)은 그대로 뒀다.
--   부담임이던 사람을 제외하면 교사 명단에서는 사라지는데 반의 부담임 칸에는
--   남아, '부서 구성원 > 반별 담임' 에 이미 나간 사람이 계속 표시된다.
--
-- [원인] dept_remove_member 는 2026-07-16, 부담임 슬롯(assistant_teacher_id)은
--   2026-08-16(20260816100000_edu_class_dual_homeroom) 에 추가돼 뒷정리 목록에서 빠졌다.
--
-- [조치] 정담임과 같은 자리에서 부담임도 해제한다. 나머지 동작은 20260827100000
--   (본인 탈퇴 허용) 정의를 그대로 유지한다.
--
-- 참고: assistant_teacher_id 를 NULL 로 만드는 UPDATE 는 20260827130000 의
--   학부모(등급 4) 차단 트리거를 건드리지 않는다 — 그 트리거는 NEW 값이
--   NOT NULL 일 때만 검사한다.
--
-- 기존에 이미 남아 있는 유령 부담임 데이터는 이 migration 에서 건드리지 않는다
-- (현재 부담임이 지정된 반 자체가 없다).
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

  -- 본인 지정 = 스스로 탈퇴 (20260827100000 에서 허용)

  -- 1) 교사 로스터: 소프트 삭제 (출석·담임 이력 보존)
  if p_teacher_id is not null then
    update public.edu_teachers
    set is_active = false
    where id = p_teacher_id
      and department_id = p_dept_id;

    -- 1-1) 담임 지정 자동 해제 (해당 부서 한정) — 정담임·부담임 모두 미배정 처리
    update public.edu_classes
    set teacher_id = null
    where department_id = p_dept_id
      and teacher_id = p_teacher_id;

    update public.edu_classes
    set assistant_teacher_id = null
    where department_id = p_dept_id
      and assistant_teacher_id = p_teacher_id;

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

-- 사후 확인: 오버로드 1개 + 부담임 해제 구문이 실제로 들어갔는지
do $$
declare v_cnt int; v_src text;
begin
  select count(*) into v_cnt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'dept_remove_member';
  if v_cnt <> 1 then
    raise exception '중단: dept_remove_member 오버로드가 %개다(1개여야 함)', v_cnt;
  end if;

  select p.prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'dept_remove_member';
  if position('assistant_teacher_id = null' in v_src) = 0 then
    raise exception '중단: dept_remove_member 에 부담임 해제 구문이 없다';
  end if;
  raise notice 'dept_remove_member 부담임 해제 확인 완료';
end
$$;
