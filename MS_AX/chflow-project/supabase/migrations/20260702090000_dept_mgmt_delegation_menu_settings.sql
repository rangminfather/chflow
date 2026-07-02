create or replace function public.dept_mgmt_grade_ok(p_dept_id uuid, p_menu_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  -- 부서관리 메뉴 접근 판정.
  -- 교육사역국 기본값 = 0 (전도사·교육사만). dept_menu_settings 의 dept/* 키에
  -- max_grade 2 가 저장되어 있으면 임원진(0~2)까지 위임.
  -- 비교육 부서는 종전 정책(grade 0~1) 유지.
  select public.get_user_grade(p_dept_id) <= coalesce(
    (select s.max_grade from public.dept_menu_settings s
      where s.department_id = p_dept_id
        and s.menu_key = p_menu_key
        and s.max_grade in (0, 2)),
    case when (select d.category from public.departments d where d.id = p_dept_id) = '교육사역국'
         then 0 else 1 end
  );
$$;
grant execute on function public.dept_mgmt_grade_ok(uuid, text) to authenticated;

-- ─────────────────────────────────────────
-- set_dept_menu_setting 확장:
--   공통메뉴(기존 5키) 외에 students/* admin/* dept/* 키 허용.
--   students/*, admin/* : 임원진(0~2)이 제목/설명만 수정 (max_grade 저장 안 함)
--   dept/*              : 전도사·교육사(grade 0)만 수정, max_grade 0(본인만)/2(임원진까지)
-- ─────────────────────────────────────────
create or replace function public.set_dept_menu_setting(
  p_department_id uuid,
  p_menu_key text,
  p_label text default null,
  p_description text default null,
  p_max_grade smallint default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_grade smallint;
  v_max smallint := p_max_grade;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  v_grade := public.get_user_grade(p_department_id);
  if v_grade > 2 then raise exception '메뉴 설정 권한이 없습니다 (임원진만 가능)'; end if;

  if p_menu_key in ('notices/board','bulletin','verse-memory','monthly-plan','review-problems') then
    -- 공통메뉴: 접근등급 변경은 월간교육계획서·복습문제만 (3=선생님 / 4=학부모)
    if p_menu_key not in ('monthly-plan','review-problems') then
      v_max := null;
    elsif v_max is not null and v_max not in (3, 4) then
      raise exception '접근 등급 값이 올바르지 않습니다 (3=선생님, 4=학부모)';
    end if;
  elsif p_menu_key like 'students/%' or p_menu_key like 'admin/%' then
    -- 담임메뉴·행정관리: 제목/설명만 수정 가능
    v_max := null;
  elsif p_menu_key like 'dept/%' then
    -- 부서관리: 전도사·교육사만 설정 가능, 접근범위 0(본인만) / 2(임원진까지)
    if v_grade > 0 then
      raise exception '부서관리 메뉴 설정은 전도사·교육사만 가능합니다';
    end if;
    if v_max is not null and v_max not in (0, 2) then
      raise exception '접근 등급 값이 올바르지 않습니다 (0=전도사·교육사만, 2=임원진까지)';
    end if;
  else
    raise exception '알 수 없는 메뉴입니다';
  end if;

  insert into public.dept_menu_settings
    (department_id, menu_key, label, description, max_grade, updated_by, updated_at)
  values (
    p_department_id, p_menu_key,
    nullif(trim(coalesce(p_label, '')), ''),
    nullif(trim(coalesce(p_description, '')), ''),
    v_max, auth.uid(), now()
  )
  on conflict (department_id, menu_key) do update
    set label = excluded.label,
        description = excluded.description,
        max_grade = excluded.max_grade,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;
grant execute on function public.set_dept_menu_setting(uuid, text, text, text, smallint) to authenticated;

-- ─────────────────────────────────────────
-- 부서원 등급 관리 RPC 2종: grade 0~1 고정 → dept/members-grade 위임 설정 기반
-- ─────────────────────────────────────────
create or replace function public.list_dept_grade_members(p_dept_id uuid)
returns table(teacher_id uuid, user_id uuid, name text, role_label text, grade smallint, has_dm boolean, has_app boolean)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') then
    raise exception '부서원 등급 관리 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  end if;

  return query
  select * from (
    select
      t.id                                              as teacher_id,
      t.user_id,
      t.name,
      coalesce(dm.member_role, t.teacher_role)::text   as role_label,
      coalesce(
        dm.grade,
        case t.teacher_role
          when '전도사' then 0
          when '교육사' then 0
          when '부장'   then 1
          when '부부장' then 2
          when '총무'   then 2
          when '서기'   then 2
          when '학부모' then 4
          else 3
        end
      )::smallint                                       as grade,
      (dm.id is not null)                               as has_dm,
      (t.user_id is not null)                           as has_app
    from public.edu_teachers t
    left join public.department_members dm
      on  dm.department_id = p_dept_id
      and dm.user_id       = t.user_id
      and dm.status        = 'approved'
    where t.department_id = p_dept_id
      and t.is_active     = true

    union all

    select
      null::uuid                                        as teacher_id,
      dm.user_id,
      coalesce(mem.name, u.email)::text                as name,
      dm.member_role::text                             as role_label,
      dm.grade::smallint,
      true                                             as has_dm,
      true                                             as has_app
    from public.department_members dm
    left join auth.users       u   on u.id            = dm.user_id
    left join public.members   mem on mem.app_user_id = dm.user_id
    where dm.department_id = p_dept_id
      and dm.status        = 'approved'
      and not exists (
        select 1 from public.edu_teachers t2
        where  t2.department_id = p_dept_id
          and  t2.user_id       = dm.user_id
          and  t2.is_active     = true
      )
  ) merged
  order by
    merged.has_app desc,
    case merged.role_label
      when '전도사' then 0
      when '교육사' then 0
      when '부장'   then 1
      when '부부장' then 2
      when '총무'   then 3
      when '서기'   then 4
      when '교사'   then 7
      when '학부모' then 8
      else 9
    end,
    merged.name;
end;
$$;

create or replace function public.upsert_member_grade(p_dept_id uuid, p_user_id uuid, p_grade smallint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_role_label text;
begin
  if p_grade < 0 or p_grade > 4 then
    raise exception 'grade must be 0~4';
  end if;
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') then
    raise exception '부서원 등급 관리 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  end if;

  v_role_label := case p_grade
    when 0 then '전도사'
    when 1 then '부장'
    when 2 then '부부장'
    when 3 then '교사'
    when 4 then '학부모'
    else '교사'
  end;

  insert into public.department_members (
    department_id, user_id, member_role, status, grade,
    requested_at, approved_at, approved_by
  ) values (
    p_dept_id, p_user_id, v_role_label, 'approved', p_grade,
    now(), now(), auth.uid()
  )
  on conflict (department_id, user_id) do update
    set grade       = excluded.grade,
        member_role = excluded.member_role,
        approved_at = now(),
        approved_by = auth.uid();
end;
$$;

-- ─────────────────────────────────────────
-- 임명 RPC 2종: can_appoint_in_dept → dept/members-grade 위임 설정 기반
-- (can_appoint_in_dept 자체는 행정관리 쪽 RPC 들이 계속 사용하므로 변경하지 않음)
-- ─────────────────────────────────────────
create or replace function public.dept_search_members_for_appoint(p_dept_id uuid, p_query text)
returns table(member_id uuid, app_user_id uuid, name text, phone text, gender text, birth_date date, photo_url text, sub_role text, pasture_name text, grassland_name text, plain_name text, already_member boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') then
    raise exception '임명 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  end if;
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;

  return query
  select
    m.id          as member_id,
    m.app_user_id,
    m.name,
    m.phone,
    m.gender,
    m.birth_date,
    m.photo_url,
    m.sub_role,
    p.name        as pasture_name,
    g.name        as grassland_name,
    pl.name       as plain_name,
    exists (
      select 1 from public.department_members dm
      where dm.department_id = p_dept_id
        and dm.user_id = m.app_user_id
        and dm.status = 'approved'
    ) as already_member
  from public.members m
  left join public.households h         on m.household_id = h.id
  left join public.directory_pastures p on h.pasture_id = p.id
  left join public.grasslands g         on p.grassland_id = g.id
  left join public.plains pl            on g.plain_id = pl.id
  where m.app_user_id is not null
    and (m.name ilike '%' || p_query || '%' or m.phone ilike '%' || p_query || '%')
  order by m.name
  limit 20;
end;
$$;

create or replace function public.admin_appoint_dept_member(p_dept_id uuid, p_member_id uuid, p_grade smallint, p_teacher_role text default null::text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_app_user_id   uuid;
  v_member_name   text;
  v_dept_name     text;
  v_dept_category text;
  v_dm_id         uuid;
  v_role_label    text;
begin
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') then
    raise exception '임명 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  end if;
  if p_grade is null or p_grade < 0 or p_grade > 4 then
    raise exception 'grade는 0~4 이어야 합니다';
  end if;

  select m.app_user_id, m.name into v_app_user_id, v_member_name
  from public.members m
  where m.id = p_member_id;

  if v_member_name is null then
    raise exception '회원을 찾을 수 없습니다';
  end if;
  if v_app_user_id is null then
    raise exception '회원이 앱 가입을 하지 않은 상태입니다 (먼저 앱 가입 필요)';
  end if;

  select name, category into v_dept_name, v_dept_category
  from public.departments where id = p_dept_id;

  v_role_label := coalesce(
    nullif(trim(p_teacher_role), ''),
    case p_grade
      when 0 then '전도사'
      when 1 then '부장'
      when 2 then '부부장'
      when 3 then '교사'
      when 4 then '학부모'
    end
  );

  insert into public.department_members (
    department_id, user_id, member_role, status, grade,
    requested_at, approved_at, approved_by
  ) values (
    p_dept_id, v_app_user_id, v_role_label, 'approved', p_grade,
    now(), now(), auth.uid()
  )
  on conflict (department_id, user_id) do update
    set status      = 'approved',
        grade       = excluded.grade,
        member_role = excluded.member_role,
        approved_at = now(),
        approved_by = auth.uid()
  returning id into v_dm_id;

  if v_dept_category = '교육사역국' then
    if exists (
      select 1 from public.edu_teachers
      where department_id = p_dept_id and member_id = p_member_id
    ) then
      update public.edu_teachers
        set name         = v_member_name,
            user_id      = v_app_user_id,
            teacher_role = v_role_label,
            is_active    = true
        where department_id = p_dept_id and member_id = p_member_id;
    else
      insert into public.edu_teachers (
        department_id, member_id, user_id, name, teacher_role, is_active
      ) values (
        p_dept_id, p_member_id, v_app_user_id, v_member_name, v_role_label, true
      );
    end if;
  end if;

  insert into public.notifications (user_id, type, title, body, link_url, created_by)
  values (
    v_app_user_id,
    'dept_appointed',
    '🎖️ 부서 임명',
    v_dept_category || ' ' || v_dept_name || ' ' || v_role_label || '(으)로 임명되셨습니다',
    '/departments/d/' || p_dept_id::text,
    auth.uid()
  );

  return v_dm_id;
end;
$$;

-- ─────────────────────────────────────────
-- 진급 마법사 RPC 2종: can_appoint_in_dept → dept/promote 위임 설정 기반
-- ─────────────────────────────────────────
create or replace function public.promote_preview(p_dept_id uuid)
returns table(student_id uuid, member_id uuid, name text, current_grade smallint, current_class text, next_grade smallint, will_graduate boolean, next_dept_id uuid, next_dept_name text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_max_year smallint;
  v_next_id  uuid;
begin
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/promote') then
    raise exception '진급 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  end if;

  select d.grade_year_max, d.next_dept_id into v_max_year, v_next_id
  from public.departments d where d.id = p_dept_id;

  return query
  select
    s.id as student_id,
    s.member_id,
    s.name,
    s.grade_year as current_grade,
    s.class_no   as current_class,
    (s.grade_year + 1)::smallint as next_grade,
    (v_max_year is not null and s.grade_year >= v_max_year) as will_graduate,
    v_next_id as next_dept_id,
    (select d2.name from public.departments d2 where d2.id = v_next_id) as next_dept_name
  from public.edu_students s
  where s.department_id = p_dept_id
    and s.is_active = true
  order by s.grade_year, s.class_no, s.name;
end;
$$;

create or replace function public.promote_finalize(p_dept_id uuid, p_year smallint, p_assignments jsonb)
returns table(promoted_cnt integer, graduated_cnt integer, history_cnt integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_dept_name     text;
  v_max_year      smallint;
  v_next_dept_id  uuid;
  v_next_dept_name text;
  v_promoted      int := 0;
  v_graduated     int := 0;
  v_history       int := 0;
  v_admin_id      uuid;
  rec             record;
  v_assignment    jsonb;
  v_new_class     text;
  v_new_teacher   uuid;
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
    select name into v_next_dept_name from public.departments where id = v_next_dept_id;
  end if;

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
        update public.edu_students
          set department_id = v_next_dept_id,
              grade_year    = (rec.grade_year + 1)::smallint,
              class_no      = null,
              teacher_id    = null,
              grade         = ((rec.grade_year + 1)::text || '학년 미배정'),
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
            grade      = ((rec.grade_year + 1)::text || '학년 ' || coalesce(v_new_class || '반', '미배정'))
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
