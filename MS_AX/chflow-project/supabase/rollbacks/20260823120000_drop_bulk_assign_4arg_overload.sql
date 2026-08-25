-- Manual rollback for 20260823120000_drop_bulk_assign_4arg_overload.
-- Supabase migrations are forward-only, so this lives outside migrations/.
--
-- 되돌리면 bulk_assign_class_teacher 4인자 오버로드가 다시 생기고, PostgREST 는
-- 인자 이름만으로 후보를 특정하지 못하는 상태로 돌아간다(호출 시
-- 'Could not choose the best candidate function'). 앱은 이 RPC 를 쓰지 않는다.
-- 되돌릴 실질적 이유는 외부에서 4인자 시그니처를 직접 호출하는 소비자가
-- 뒤늦게 발견된 경우뿐이다.
--
-- 본문은 20260823090000_class_admin_authz_use_get_user_grade 의 4인자 정의와
-- 동일하다(권한 판정은 get_user_grade 기준).

begin;

create or replace function public.bulk_assign_class_teacher(
  p_dept_id uuid, p_class_no text, p_new_teacher_id uuid, p_reason text default null
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
  v_count integer;
begin
  v_caller_grade := public.get_user_grade(p_dept_id);

  if v_caller_grade is null or v_caller_grade > 2 then
    raise exception '권한 없음 (임원진 또는 관리자만 가능)';
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
  set teacher_id = p_new_teacher_id
  where department_id = p_dept_id and class_no = p_class_no;

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
grant execute on function public.bulk_assign_class_teacher(uuid, text, uuid, text) to authenticated;

commit;
