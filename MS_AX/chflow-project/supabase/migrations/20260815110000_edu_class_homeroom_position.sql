-- 반별 담임 지정 시 선택적으로 정/부 구분을 저장한다.
-- 기존 한 반-한 담임 및 학생 teacher_id 연결 구조는 유지한다.

alter table public.edu_classes
  add column if not exists homeroom_position text;
alter table public.edu_classes
  drop constraint if exists edu_classes_homeroom_position_check;
alter table public.edu_classes
  add constraint edu_classes_homeroom_position_check
  check (homeroom_position is null or homeroom_position in ('정', '부'));
drop function if exists public.list_dept_classes_full(uuid);
create function public.list_dept_classes_full(p_dept_id uuid)
returns table (
  class_no text,
  grade_year smallint,
  label text,
  teacher_id uuid,
  teacher_name text,
  homeroom_position text,
  teacher_member_id uuid,
  is_placeholder boolean,
  student_count bigint,
  sort_order int,
  in_registry boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_edu_member_or_admin(p_dept_id) then
    raise exception '접근 권한이 없습니다';
  end if;

  return query
  select
    c.class_no,
    c.grade_year,
    c.label,
    c.teacher_id,
    et.name as teacher_name,
    c.homeroom_position,
    et.member_id as teacher_member_id,
    (c.teacher_id is not null and et.member_id is null) as is_placeholder,
    coalesce(sc.cnt, 0) as student_count,
    c.sort_order,
    true as in_registry
  from public.edu_classes c
  left join public.edu_teachers et on et.id = c.teacher_id
  left join (
    select st.class_no as cls, count(*) as cnt
    from public.edu_students st
    where st.department_id = p_dept_id and st.is_active = true
      and coalesce(trim(st.class_no), '') <> ''
    group by st.class_no
  ) sc on sc.cls = c.class_no
  where c.department_id = p_dept_id

  union all

  select
    s.class_no,
    max(s.grade_year) as grade_year,
    null::text as label,
    (array_agg(s.teacher_id) filter (where s.teacher_id is not null))[1] as teacher_id,
    (array_agg(et2.name) filter (where et2.name is not null))[1] as teacher_name,
    null::text as homeroom_position,
    (array_agg(et2.member_id) filter (where et2.member_id is not null))[1] as teacher_member_id,
    false as is_placeholder,
    count(*) as student_count,
    9999 as sort_order,
    false as in_registry
  from public.edu_students s
  left join public.edu_teachers et2 on et2.id = s.teacher_id
  where s.department_id = p_dept_id and s.is_active = true
    and coalesce(trim(s.class_no), '') <> ''
    and not exists (
      select 1 from public.edu_classes c2
      where c2.department_id = p_dept_id and c2.class_no = s.class_no
    )
  group by s.class_no

  order by 2 nulls last, 10, 1;
end;
$$;
grant execute on function public.list_dept_classes_full(uuid) to authenticated;
drop function if exists public.bulk_assign_class_teacher(uuid, text, uuid, text);
drop function if exists public.bulk_assign_class_teacher(uuid, text, uuid, text, text);
create function public.bulk_assign_class_teacher(
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
  select grade into v_caller_grade
  from public.department_members
  where department_id = p_dept_id and user_id = v_caller;

  if v_caller_grade is null or v_caller_grade > 2 then
    raise exception '권한 없음 (임원진만 가능)';
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
