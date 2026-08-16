-- 한 반에 정담임과 선택적인 부담임을 독립적으로 지정한다.
-- 기존 teacher_id는 정담임으로 유지해 학생 연결과 기존 기능을 보존한다.

alter table public.edu_classes
  add column if not exists assistant_teacher_id uuid references public.edu_teachers(id) on delete set null;

create index if not exists idx_edu_classes_assistant_teacher
  on public.edu_classes(department_id, assistant_teacher_id)
  where assistant_teacher_id is not null;

-- 이전 단일 선택 UI에서 '부'로 저장된 배정은 부담임 슬롯으로 옮긴다.
update public.edu_classes
set assistant_teacher_id = teacher_id,
    teacher_id = null,
    homeroom_position = null
where homeroom_position = '부'
  and assistant_teacher_id is null;

update public.edu_students s
set teacher_id = null
where exists (
  select 1 from public.edu_classes c
  where c.department_id = s.department_id
    and c.class_no = s.class_no
    and c.teacher_id is null
    and c.assistant_teacher_id is not null
);

update public.edu_classes set homeroom_position = null where homeroom_position is not null;

drop function if exists public.list_dept_classes_full(uuid);
create function public.list_dept_classes_full(p_dept_id uuid)
returns table (
  class_no text, grade_year smallint, label text,
  teacher_id uuid, teacher_name text, teacher_member_id uuid, is_placeholder boolean,
  assistant_teacher_id uuid, assistant_teacher_name text,
  assistant_teacher_member_id uuid, assistant_is_placeholder boolean,
  student_count bigint, sort_order int, in_registry boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_edu_member_or_admin(p_dept_id) then raise exception '접근 권한이 없습니다'; end if;
  return query
  select c.class_no, c.grade_year, c.label,
    c.teacher_id, pt.name, pt.member_id,
    (c.teacher_id is not null and pt.member_id is null),
    c.assistant_teacher_id, at.name, at.member_id,
    (c.assistant_teacher_id is not null and at.member_id is null),
    coalesce(sc.cnt, 0), c.sort_order, true
  from public.edu_classes c
  left join public.edu_teachers pt on pt.id = c.teacher_id
  left join public.edu_teachers at on at.id = c.assistant_teacher_id
  left join (
    select st.class_no cls, count(*) cnt from public.edu_students st
    where st.department_id = p_dept_id and st.is_active = true and coalesce(trim(st.class_no), '') <> ''
    group by st.class_no
  ) sc on sc.cls = c.class_no
  where c.department_id = p_dept_id
  union all
  select s.class_no, max(s.grade_year), null::text,
    (array_agg(s.teacher_id) filter (where s.teacher_id is not null))[1],
    (array_agg(et.name) filter (where et.name is not null))[1],
    (array_agg(et.member_id) filter (where et.member_id is not null))[1], false,
    null::uuid, null::text, null::uuid, false,
    count(*), 9999, false
  from public.edu_students s
  left join public.edu_teachers et on et.id = s.teacher_id
  where s.department_id = p_dept_id and s.is_active = true and coalesce(trim(s.class_no), '') <> ''
    and not exists (select 1 from public.edu_classes c2 where c2.department_id = p_dept_id and c2.class_no = s.class_no)
  group by s.class_no
  order by 2 nulls last, 13, 1;
end;
$$;
grant execute on function public.list_dept_classes_full(uuid) to authenticated;

create or replace function public.set_class_homeroom_teacher(
  p_dept_id uuid, p_class_no text, p_role text, p_teacher_id uuid default null, p_reason text default null
)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid(); v_grade smallint; v_caller_name text;
  v_old_id uuid; v_old_name text; v_new_name text; v_count integer := 0;
begin
  select grade into v_grade from public.department_members where department_id=p_dept_id and user_id=v_caller;
  if v_grade is null or v_grade > 2 then raise exception '권한 없음 (임원진만 가능)'; end if;
  if p_role not in ('정','부') then raise exception '담임 구분은 정 또는 부만 가능합니다'; end if;
  if p_teacher_id is not null then
    select name into v_new_name from public.edu_teachers
    where id=p_teacher_id and department_id=p_dept_id and is_active=true;
    if v_new_name is null then raise exception '담임 정보 없음 또는 부서 불일치'; end if;
  end if;
  select name into v_caller_name from public.profiles where id=v_caller;

  insert into public.edu_classes(department_id, grade_year, class_no, sort_order, created_by)
  select p_dept_id, max(s.grade_year), p_class_no, 0, v_caller
  from public.edu_students s where s.department_id=p_dept_id and s.class_no=p_class_no
  on conflict (department_id,class_no) do nothing;

  if p_role='정' then
    select teacher_id into v_old_id from public.edu_classes where department_id=p_dept_id and class_no=p_class_no;
    update public.edu_classes set teacher_id=p_teacher_id, homeroom_position=null
      where department_id=p_dept_id and class_no=p_class_no;
    update public.edu_students set teacher_id=p_teacher_id
      where department_id=p_dept_id and class_no=p_class_no;
    get diagnostics v_count = row_count;
  else
    select assistant_teacher_id into v_old_id from public.edu_classes where department_id=p_dept_id and class_no=p_class_no;
    update public.edu_classes set assistant_teacher_id=p_teacher_id, homeroom_position=null
      where department_id=p_dept_id and class_no=p_class_no;
  end if;
  if v_old_id is not null then select name into v_old_name from public.edu_teachers where id=v_old_id; end if;
  insert into public.teacher_assignment_log(
    department_id, action_type, class_no, old_teacher_id, old_teacher_name,
    new_teacher_id, new_teacher_name, reason, changed_by, changed_by_name
  ) values (
    p_dept_id, 'bulk_assign', p_class_no, v_old_id, v_old_name,
    p_teacher_id, v_new_name, '['||p_role||'담임] '||coalesce(p_reason,''), v_caller, v_caller_name
  );
  return v_count;
end;
$$;
grant execute on function public.set_class_homeroom_teacher(uuid,text,text,uuid,text) to authenticated;

create or replace function public.edu_list_my_homeroom_classes(p_dept_id uuid)
returns table(class_no text)
language sql stable security definer set search_path=public
as $$
  with me as (
    select id from public.edu_teachers
    where department_id=p_dept_id and user_id=auth.uid() and is_active=true
  )
  select distinct c.class_no
  from public.edu_classes c, me
  where c.department_id=p_dept_id and (c.teacher_id=me.id or c.assistant_teacher_id=me.id)
  union
  select distinct s.class_no
  from public.edu_students s, me
  where s.department_id=p_dept_id and s.teacher_id=me.id and s.is_active=true
    and coalesce(trim(s.class_no),'')<>'';
$$;
grant execute on function public.edu_list_my_homeroom_classes(uuid) to authenticated;

-- 정·부 담임 모두 같은 반 학생을 편집할 수 있다.
create or replace function public.edu_can_edit_student(p_dept_id uuid, p_student_id uuid)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare v_grade smallint;
begin
  v_grade := public.get_user_grade(p_dept_id);
  if v_grade <= 2 then return true; end if;
  if v_grade = 3 then
    return exists (
      select 1 from public.edu_teachers t
      join public.edu_students s on s.department_id=t.department_id and s.id=p_student_id
      left join public.edu_classes c on c.department_id=s.department_id and c.class_no=s.class_no
      where t.department_id=p_dept_id and t.user_id=auth.uid() and t.is_active=true
        and s.is_active=true and (s.teacher_id=t.id or c.assistant_teacher_id=t.id)
    );
  end if;
  return false;
end;
$$;
grant execute on function public.edu_can_edit_student(uuid,uuid) to authenticated;

create or replace function public.edu_set_my_class_attendance(
  p_student_id uuid, p_dept_id uuid, p_date date, p_prayer boolean, p_church_sch boolean,
  p_worship boolean, p_lesson boolean, p_bible boolean, p_status text, p_memo text default null
)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if not public.edu_can_edit_student(p_dept_id,p_student_id) then raise exception '담당 반 학생만 출결을 처리할 수 있습니다'; end if;
  insert into public.edu_student_attendance(student_id,dept_id,attend_date,had_prayer,had_church_sch,had_worship,had_lesson,had_bible,attend_status,memo)
  values(p_student_id,p_dept_id,p_date,coalesce(p_prayer,false),coalesce(p_church_sch,false),coalesce(p_worship,false),coalesce(p_lesson,false),coalesce(p_bible,false),coalesce(p_status,'출'),p_memo)
  on conflict(student_id,attend_date) do update set had_prayer=excluded.had_prayer,had_church_sch=excluded.had_church_sch,
    had_worship=excluded.had_worship,had_lesson=excluded.had_lesson,had_bible=excluded.had_bible,
    attend_status=excluded.attend_status,memo=excluded.memo;
end;
$$;
grant execute on function public.edu_set_my_class_attendance(uuid,uuid,date,boolean,boolean,boolean,boolean,boolean,text,text) to authenticated;
