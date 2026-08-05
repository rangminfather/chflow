-- 반 관리/섹션명 RPC의 예외 메시지 한글 깨짐(mojibake) 보정.
--
-- 배경: 20260716090000_class_admin_grade2_and_section_labels.sql 이 저장소에 들어올 때
-- 인코딩이 깨져(예: '로그인이 필요합니다' → '濡쒓렇?몄씠 ?꾩슂?⑸땲??') 적용됐다.
-- 이 메시지들은 teacher-assign / 부서 메인 화면에서 showToast(error.message) 로
-- 사용자에게 그대로 노출되므로 보정이 필요하다.
--
-- 이미 적용된 마이그레이션 파일은 수정하지 않고, 함수 본문을 그대로 유지한 채
-- create or replace 로 메시지 문자열만 정상 한글로 되돌린다.
-- DDL·시그니처·권한은 기존과 동일하며 데이터 변경은 없다.

create or replace function public.assert_dept_class_admin(p_dept_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_grade smallint;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select grade into v_grade from public.department_members
  where department_id = p_dept_id and user_id = auth.uid();
  if v_grade is null or v_grade > 2 then
    raise exception '반 관리 권한이 없습니다 (임원진만 가능)';
  end if;
end;
$$;

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
  select grade into v_caller_grade
  from public.department_members
  where department_id = p_dept_id and user_id = v_caller;

  if v_caller_grade is null or v_caller_grade > 2 then
    raise exception '권한 없음 (임원진만 가능)';
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

create or replace function public.merge_placeholder_teacher(
  p_placeholder_id uuid,
  p_target_user_id uuid,
  p_reason text default null
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_name text;
  v_caller_grade smallint;
  v_dept_id uuid;
  v_placeholder_name text;
  v_target_member_id uuid;
  v_target_name text;
begin
  select department_id, name into v_dept_id, v_placeholder_name
  from public.edu_teachers
  where id = p_placeholder_id;

  if v_dept_id is null then
    raise exception 'placeholder 없음';
  end if;

  select grade into v_caller_grade
  from public.department_members
  where department_id = v_dept_id and user_id = v_caller;

  if v_caller_grade is null or v_caller_grade > 2 then
    raise exception '권한 없음 (임원진만 가능)';
  end if;

  select name into v_caller_name from public.profiles where id = v_caller;
  select member_id, name into v_target_member_id, v_target_name
  from public.profiles
  where id = p_target_user_id;

  if v_target_name is null then
    raise exception '대상 사용자 없음';
  end if;

  update public.edu_teachers
  set user_id = p_target_user_id,
      member_id = v_target_member_id,
      name = v_target_name
  where id = p_placeholder_id;

  insert into public.teacher_assignment_log (
    department_id, action_type, placeholder_id, real_member_id,
    new_teacher_id, new_teacher_name, reason, changed_by, changed_by_name
  ) values (
    v_dept_id, 'merge_placeholder', p_placeholder_id, v_target_member_id,
    p_placeholder_id, v_target_name, p_reason, v_caller, v_caller_name
  );

  return true;
end;
$$;
grant execute on function public.merge_placeholder_teacher(uuid, uuid, text) to authenticated;

create or replace function public.get_dept_admin_section_labels(p_department_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_grade smallint;
  v_labels jsonb;
begin
  v_grade := public.get_user_grade(p_department_id);
  if v_grade > 4 then raise exception '접근 권한이 없습니다'; end if;

  select section_labels into v_labels
  from public.dept_admin_section_order
  where department_id = p_department_id;

  return coalesce(v_labels, '{}'::jsonb);
end;
$$;
grant execute on function public.get_dept_admin_section_labels(uuid) to authenticated;

create or replace function public.set_dept_admin_section_label(
  p_department_id uuid,
  p_section_id text,
  p_label text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_grade smallint;
  v_label text := nullif(trim(coalesce(p_label, '')), '');
  v_labels jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  v_grade := public.get_user_grade(p_department_id);
  if v_grade > 2 then raise exception '메뉴 설정 권한이 없습니다 (임원진만 가능)'; end if;

  if p_section_id not in ('docs','attendance','talent','ops') then
    raise exception '없는 섹션입니다';
  end if;
  if v_label is null then
    raise exception '섹션명을 입력하세요';
  end if;

  insert into public.dept_admin_section_order (
    department_id, section_order, section_labels, updated_by, updated_at
  ) values (
    p_department_id,
    array['docs','attendance','talent','ops'],
    jsonb_build_object(p_section_id, v_label),
    auth.uid(),
    now()
  )
  on conflict (department_id) do update
    set section_labels = coalesce(public.dept_admin_section_order.section_labels, '{}'::jsonb)
        || jsonb_build_object(p_section_id, v_label),
        updated_by = excluded.updated_by,
        updated_at = now();

  select section_labels into v_labels
  from public.dept_admin_section_order
  where department_id = p_department_id;

  return coalesce(v_labels, '{}'::jsonb);
end;
$$;
grant execute on function public.set_dept_admin_section_label(uuid, text, text) to authenticated;
