-- =============================================================
-- 교육사역국 진급 체인 — 영아부→유아부→유치부→초등1부→초등2부→청소년부 연속 진급
--
-- 1) departments 진급 설정 (부서 설명의 나이/학년 범위 기준):
--    영아부(1~3세) → 유아부(4~5세) → 유치부(6~7세) → 초등1부(1~3학년)
--    → 초등2부(4~6학년) → 청소년부(14~19세, 졸업)
--    나이 기반 부서는 grade_year = 세는나이 (프론트 lib/eduAge.ts 와 동일 규칙)
--
-- 2) promote_preview / promote_finalize:
--    - 전출 시 다음 부서의 grade_year_min 으로 편입 (기존: 무조건 +1 → 나이/학년
--      개념이 다른 부서로 넘어갈 때 값이 어긋나던 문제. 예: 유치부 7세 → 초등1부 1학년)
--    - grade 표기 문자열을 부서 개념에 맞게 'N세'/'N학년' 으로 생성
-- =============================================================

-- ── 1. 진급 체인 설정 ──
update public.departments set grade_year_min = 1, grade_year_max = 3,
  next_dept_id = (select id from public.departments where name = '유아부' and category = '교육사역국')
  where name = '영아부' and category = '교육사역국';

update public.departments set grade_year_min = 4, grade_year_max = 5,
  next_dept_id = (select id from public.departments where name = '유치부' and category = '교육사역국')
  where name = '유아부' and category = '교육사역국';

update public.departments set grade_year_min = 6, grade_year_max = 7,
  next_dept_id = (select id from public.departments where name = '초등1부' and category = '교육사역국')
  where name = '유치부' and category = '교육사역국';

update public.departments set grade_year_min = 1, grade_year_max = 3,
  next_dept_id = (select id from public.departments where name = '초등2부' and category = '교육사역국')
  where name = '초등1부' and category = '교육사역국';

update public.departments set grade_year_min = 4, grade_year_max = 6,
  next_dept_id = (select id from public.departments where name = '청소년부' and category = '교육사역국')
  where name = '초등2부' and category = '교육사역국';

update public.departments set grade_year_min = 14, grade_year_max = 19, next_dept_id = null
  where name = '청소년부' and category = '교육사역국';

-- ── 2. 부서별 표기 단위 ('세'/'학년') — lib/eduAge.ts 의 AGE_DEPTS 와 일치 유지 ──
create or replace function public.edu_grade_unit(p_dept_name text)
returns text language sql immutable as $$
  select case when p_dept_name in ('영아부', '유아부', '유치부', '청소년부') then '세' else '학년' end;
$$;

-- ── 3. promote_preview: 전출 시 다음 부서 grade_year_min 반영 ──
create or replace function public.promote_preview(p_dept_id uuid)
returns table(student_id uuid, member_id uuid, name text, current_grade smallint, current_class text, next_grade smallint, will_graduate boolean, next_dept_id uuid, next_dept_name text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_max_year  smallint;
  v_next_id   uuid;
  v_next_min  smallint;
  v_next_name text;
begin
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/promote') then
    raise exception '진급 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  end if;

  select d.grade_year_max, d.next_dept_id into v_max_year, v_next_id
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
    (case when v_max_year is not null and s.grade_year >= v_max_year
          then coalesce(v_next_min, (s.grade_year + 1)::smallint)
          else (s.grade_year + 1)::smallint end) as next_grade,
    (v_max_year is not null and s.grade_year >= v_max_year) as will_graduate,
    v_next_id as next_dept_id,
    v_next_name as next_dept_name
  from public.edu_students s
  where s.department_id = p_dept_id
    and s.is_active = true
  order by s.grade_year, s.class_no, s.name;
end;
$$;

-- ── 4. promote_finalize: 전출 편입값·표기 단위를 다음 부서 기준으로 ──
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
  v_new_class      text;
  v_new_teacher    uuid;
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
    select s.id, s.member_id, s.name, s.grade_year, s.class_no, s.teacher_id,
           t.name as teacher_name
    from public.edu_students s
    left join public.edu_teachers t on s.teacher_id = t.id
    where s.department_id = p_dept_id and s.is_active = true
  loop
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
        when v_max_year is not null and rec.grade_year >= v_max_year then
          case when v_next_dept_id is not null then '전출' else '졸업' end
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

    if v_max_year is not null and rec.grade_year >= v_max_year then
      if v_next_dept_id is not null then
        -- 전출: 다음 부서의 시작 학년/나이로 편입 (개념이 달라도 연속 진급)
        v_new_grade := coalesce(v_next_min, (rec.grade_year + 1)::smallint);
        update public.edu_students
          set department_id = v_next_dept_id,
              grade_year    = v_new_grade,
              class_no      = null,
              teacher_id    = null,
              grade         = (v_new_grade::text || v_next_unit || ' 미배정'),
              order_no      = 0
          where id = rec.id;
        v_graduated := v_graduated + 1;
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
      v_assignment := null;
      if p_assignments is not null then
        select a into v_assignment from jsonb_array_elements(p_assignments) a
          where a->>'student_id' = rec.id::text limit 1;
      end if;

      v_new_class   := coalesce(v_assignment->>'new_class_no', null);
      v_new_teacher := case when v_assignment ? 'new_teacher_id' and v_assignment->>'new_teacher_id' <> ''
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
