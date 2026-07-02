create or replace function public.dept_mgmt_grade_ok(p_dept_id uuid, p_menu_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  -- 부서관리 메뉴 접근 판정.
  -- 기본값 = 1 (전도사·교육사·부장). dept_menu_settings 의 dept/* 키로
  -- 0(전도사·교육사만) / 1(부장까지) / 2(임원진까지) 조정 가능.
  select public.get_user_grade(p_dept_id) <= coalesce(
    (select s.max_grade from public.dept_menu_settings s
      where s.department_id = p_dept_id
        and s.menu_key = p_menu_key
        and s.max_grade in (0, 1, 2)),
    1
  );
$$;
grant execute on function public.dept_mgmt_grade_ok(uuid, text) to authenticated;

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
    -- 부서관리: 전도사·교육사·부장(0~1)만 설정 가능
    if v_grade > 1 then
      raise exception '부서관리 메뉴 설정은 전도사·교육사·부장만 가능합니다';
    end if;
    if v_max is not null and v_max not in (0, 1, 2) then
      raise exception '접근 등급 값이 올바르지 않습니다 (0=전도사·교육사만, 1=부장까지, 2=임원진까지)';
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
