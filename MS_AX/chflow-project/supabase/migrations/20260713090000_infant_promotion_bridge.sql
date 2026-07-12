-- 영아부→유아부 특수 승계
-- - 영아부 공식 소개는 3~4세, 운영상 유니게학교(1~2세) 미운영으로 1~4세 통합 수용
-- - 진급마법사 실행 시 영아부 3세 이상을 유아부 승계 후보로 본다.
-- - 3세 학생을 "영아부에도 유지"로 체크하면 원본은 영아부 4세로 남기고 유아부 row를 추가한다.

update public.departments
set description = '3세~4세 (유니게학교 1~2세 미운영으로 통합 운영)',
    grade_year_min = 1,
    grade_year_max = 3,
    next_dept_id = (select id from public.departments where name = '유아부' and category = '교육사역국')
where name = '영아부' and category = '교육사역국';

update public.departments
set description = '4세~5세'
where name = '유아부' and category = '교육사역국';

alter table public.edu_student_history
  drop constraint if exists edu_student_history_status_check;

alter table public.edu_student_history
  add constraint edu_student_history_status_check
  check (status in ('재학','졸업','전출','병행등록'));

create or replace function public.promote_preview(p_dept_id uuid)
returns table(student_id uuid, member_id uuid, name text, current_grade smallint, current_class text, next_grade smallint, will_graduate boolean, next_dept_id uuid, next_dept_name text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_dept_name text;
  v_max_year  smallint;
  v_next_id   uuid;
  v_next_min  smallint;
  v_next_name text;
begin
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/promote') then
    raise exception '진급 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  end if;

  select d.name, d.grade_year_max, d.next_dept_id into v_dept_name, v_max_year, v_next_id
  from public.departments d where d.id = p_dept_id;

  if v_next_id is not null then
    select d2.grade_year_min, d2.name into v_next_min, v_next_name
    from public.departments d2 where d2.id = v_next_id;
  end if;

  return query
  select
    s.id as student_id,
    s.member_id,
    s.name,
    s.grade_year as current_grade,
    s.class_no   as current_class,
    case
      when v_dept_name = '영아부' then (s.grade_year + 1)::smallint
      when v_max_year is not null and s.grade_year >= v_max_year then coalesce(v_next_min, (s.grade_year + 1)::smallint)
      else (s.grade_year + 1)::smallint
    end as next_grade,
    case
      when v_dept_name = '영아부' then s.grade_year >= 3
      else (v_max_year is not null and s.grade_year >= v_max_year)
    end as will_graduate,
    v_next_id as next_dept_id,
    v_next_name as next_dept_name
  from public.edu_students s
  where s.department_id = p_dept_id
    and s.is_active = true
  order by s.grade_year, s.class_no, s.name;
end;
$$;

grant execute on function public.promote_preview(uuid) to authenticated;

create or replace function public.promote_finalize(p_dept_id uuid, p_year smallint, p_assignments jsonb)
returns table(promoted_cnt integer, graduated_cnt integer, history_cnt integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_dept_name      text;
  v_max_year       smallint;
  v_next_dept_id   uuid;
  v_next_dept_name text;
  v_next_min       smallint;
  v_unit           text;
  v_next_unit      text;
  v_new_grade      smallint;
  v_promoted       int := 0;
  v_graduated      int := 0;
  v_history        int := 0;
  v_admin_id       uuid;
  rec              record;
  v_assignment     jsonb;
  v_keep_source    boolean;
  v_new_class      text;
  v_new_teacher    uuid;
  v_is_transfer    boolean;
  v_new_no         int;
  v_new_order      int;
  v_target_exists  boolean;
begin
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/promote') then
    raise exception '진급 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'p_year 가 유효하지 않습니다';
  end if;

  select d.name, d.grade_year_max, d.next_dept_id into v_dept_name, v_max_year, v_next_dept_id
  from public.departments d where d.id = p_dept_id;

  if v_next_dept_id is not null then
    select name, grade_year_min into v_next_dept_name, v_next_min
    from public.departments where id = v_next_dept_id;
  end if;

  v_unit := public.edu_grade_unit(v_dept_name);
  v_next_unit := public.edu_grade_unit(v_next_dept_name);

  for rec in
    select s.id, s.member_id, s.name, s.student_type, s.grade_year, s.class_no, s.teacher_id,
           s.gender, s.birth_date, s.phone, s.address, s.school_name, s.photo_url,
           t.name as teacher_name
    from public.edu_students s
    left join public.edu_teachers t on s.teacher_id = t.id
    where s.department_id = p_dept_id and s.is_active = true
  loop
    v_assignment := null;
    if p_assignments is not null then
      select a into v_assignment from jsonb_array_elements(p_assignments) a
        where a->>'student_id' = rec.id::text limit 1;
    end if;

    v_is_transfer := case
      when v_dept_name = '영아부' then rec.grade_year >= 3
      else (v_max_year is not null and rec.grade_year >= v_max_year)
    end;
    v_keep_source := coalesce((v_assignment->>'keep_source_department')::boolean, false)
      and v_dept_name = '영아부'
      and rec.grade_year = 3
      and v_next_dept_id is not null;

    insert into public.edu_student_history (
      year, student_id, member_id, member_name,
      department_id, department_name,
      grade_year, class_no, teacher_id, teacher_name,
      status
    ) values (
      p_year, rec.id, rec.member_id, rec.name,
      p_dept_id, v_dept_name,
      rec.grade_year, rec.class_no, rec.teacher_id, rec.teacher_name,
      case
        when v_keep_source then '병행등록'
        when v_is_transfer then case when v_next_dept_id is not null then '전출' else '졸업' end
        else '재학'
      end
    )
    on conflict (year, student_id) do update set
      grade_year = excluded.grade_year,
      class_no = excluded.class_no,
      teacher_id = excluded.teacher_id,
      teacher_name = excluded.teacher_name,
      status = excluded.status;
    v_history := v_history + 1;

    if v_is_transfer then
      if v_next_dept_id is not null then
        v_new_grade := case
          when v_dept_name = '영아부' then (rec.grade_year + 1)::smallint
          else coalesce(v_next_min, (rec.grade_year + 1)::smallint)
        end;

        if v_keep_source then
          select exists (
            select 1
            from public.edu_students s2
            where s2.department_id = v_next_dept_id
              and s2.is_active = true
              and (
                (rec.member_id is not null and s2.member_id = rec.member_id)
                or (rec.member_id is null and s2.name = rec.name and s2.birth_date is not distinct from rec.birth_date)
              )
          ) into v_target_exists;

          if not v_target_exists then
            select coalesce(max(student_no), 0) + 1 into v_new_no
            from public.edu_students where department_id = v_next_dept_id;

            select coalesce(max(order_no), 0) + 1 into v_new_order
            from public.edu_students where department_id = v_next_dept_id;

            insert into public.edu_students (
              department_id, student_no, name, student_type, grade, is_active, order_no,
              member_id, teacher_id, grade_year, class_no,
              gender, birth_date, phone, address, school_name, photo_url
            ) values (
              v_next_dept_id, v_new_no, rec.name, rec.student_type,
              (v_new_grade::text || v_next_unit || ' 미배정'), true, v_new_order,
              rec.member_id, null, v_new_grade, null,
              rec.gender, rec.birth_date, rec.phone, rec.address, rec.school_name, rec.photo_url
            );
            v_graduated := v_graduated + 1;
          end if;

          update public.edu_students
            set grade_year = v_new_grade,
                grade = (v_new_grade::text || v_unit || ' ' || coalesce(class_no || '반', '미배정'))
            where id = rec.id;
          v_promoted := v_promoted + 1;
        else
          update public.edu_students
            set department_id = v_next_dept_id,
                grade_year    = v_new_grade,
                class_no      = null,
                teacher_id    = null,
                grade         = (v_new_grade::text || v_next_unit || ' 미배정'),
                order_no      = 0
            where id = rec.id;
          v_graduated := v_graduated + 1;
        end if;
      else
        update public.edu_students
          set is_active = false,
              grade_year = (rec.grade_year + 1)::smallint,
              class_no   = null,
              teacher_id = null,
              grade      = ('졸업 ' || (p_year + 1)::text)
          where id = rec.id;
        v_graduated := v_graduated + 1;
      end if;
    else
      v_new_class   := coalesce(v_assignment->>'new_class_no', null);
      v_new_teacher := case when v_assignment is not null and v_assignment ? 'new_teacher_id' and v_assignment->>'new_teacher_id' <> ''
                            then (v_assignment->>'new_teacher_id')::uuid
                            else null end;

      update public.edu_students
        set grade_year = (rec.grade_year + 1)::smallint,
            class_no   = v_new_class,
            teacher_id = v_new_teacher,
            grade      = ((rec.grade_year + 1)::text || v_unit || ' ' || coalesce(v_new_class || '반', '미배정'))
        where id = rec.id;
      v_promoted := v_promoted + 1;
    end if;
  end loop;

  if v_graduated > 0 and v_next_dept_id is not null then
    for v_admin_id in
      select user_id from public.department_members
      where department_id = v_next_dept_id and status='approved' and grade <= 1
    loop
      insert into public.notifications (user_id, type, title, body, link_url, created_by)
      values (
        v_admin_id,
        'dept_promotion_in',
        '🎓 신입 학생 도착',
        v_dept_name || '에서 ' || v_graduated::text || '명이 ' || v_next_dept_name || '으로 진급했습니다',
        '/departments/d/' || v_next_dept_id::text,
        auth.uid()
      );
    end loop;
  end if;

  return query select v_promoted, v_graduated, v_history;
end;
$$;

grant execute on function public.promote_finalize(uuid, smallint, jsonb) to authenticated;
