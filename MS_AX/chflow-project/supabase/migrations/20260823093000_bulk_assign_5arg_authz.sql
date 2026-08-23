-- =============================================================
-- bulk_assign_class_teacher(5인자) 권한 판정도 get_user_grade 로 통일
--
-- 20260823090000 은 4인자 시그니처만 고쳤다. 20260815110000 에서 create function
-- (replace 아님) 으로 만든 5인자 오버로드가 따로 살아 있어 그쪽은 여전히
-- department_members.grade 를 직접 읽었다.
--
-- ⚠ 남은 문제(이 마이그레이션에서 건드리지 않음): 같은 이름의 4인자·5인자 함수가
--    동시에 존재해 PostgREST 로는 어느 쪽인지 특정하지 못한다
--    ("Could not choose the best candidate function"). 앱은 이 RPC 를 호출하지
--    않고(반 담임 지정은 set_class_homeroom_teacher 로 대체됨) 실사용 영향은 없다.
--    한쪽을 drop 하는 정리는 별도 판단이 필요해 보고만 한다.
-- =============================================================

create or replace function public.bulk_assign_class_teacher(
  p_dept_id uuid,
  p_class_no text,
  p_new_teacher_id uuid,
  p_reason text default null,
  p_homeroom_position text default null
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_name text;
  v_caller_grade smallint;
  v_old_teacher_id uuid;
  v_old_teacher_name text;
  v_new_teacher_name text;
  v_position text := nullif(trim(coalesce(p_homeroom_position, '')), '');
  v_count integer;
begin
  v_caller_grade := public.get_user_grade(p_dept_id);

  if v_caller_grade is null or v_caller_grade > 2 then
    raise exception '권한 없음 (임원진 또는 관리자만 가능)';
  end if;
  if v_position is not null and v_position not in ('정', '부') then
    raise exception '담임 구분은 정 또는 부만 선택할 수 있습니다';
  end if;

  select name into v_caller_name from public.profiles where id = v_caller;
  select name into v_new_teacher_name
  from public.edu_teachers
  where id = p_new_teacher_id and department_id = p_dept_id;
  if v_new_teacher_name is null then
    raise exception '담임 정보 없음 또는 부서 불일치';
  end if;

  select teacher_id into v_old_teacher_id
  from public.edu_classes
  where department_id = p_dept_id and class_no = p_class_no;
  if v_old_teacher_id is null then
    select teacher_id into v_old_teacher_id
    from public.edu_students
    where department_id = p_dept_id and class_no = p_class_no and teacher_id is not null
    limit 1;
  end if;
  if v_old_teacher_id is not null then
    select name into v_old_teacher_name from public.edu_teachers where id = v_old_teacher_id;
  end if;

  update public.edu_classes
  set teacher_id = p_new_teacher_id,
      homeroom_position = v_position
  where department_id = p_dept_id and class_no = p_class_no;

  if not found then
    insert into public.edu_classes (
      department_id, grade_year, class_no, teacher_id, homeroom_position, sort_order, created_by
    )
    select
      p_dept_id, max(s.grade_year), p_class_no, p_new_teacher_id, v_position, 0, v_caller
    from public.edu_students s
    where s.department_id = p_dept_id and s.class_no = p_class_no
    on conflict (department_id, class_no) do update
      set teacher_id = excluded.teacher_id,
          homeroom_position = excluded.homeroom_position;
  end if;

  update public.edu_students
  set teacher_id = p_new_teacher_id
  where department_id = p_dept_id and class_no = p_class_no;
  get diagnostics v_count = row_count;

  insert into public.teacher_assignment_log (
    department_id, action_type, class_no, old_teacher_id, old_teacher_name,
    new_teacher_id, new_teacher_name, reason, changed_by, changed_by_name
  ) values (
    p_dept_id, 'bulk_assign', p_class_no, v_old_teacher_id, v_old_teacher_name,
    p_new_teacher_id, v_new_teacher_name, p_reason, v_caller, v_caller_name
  );

  return v_count;
end;
$$;
grant execute on function public.bulk_assign_class_teacher(uuid, text, uuid, text, text) to authenticated;
