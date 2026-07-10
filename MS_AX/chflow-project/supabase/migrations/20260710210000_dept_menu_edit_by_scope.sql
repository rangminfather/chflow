-- =============================================================
-- 부서관리 메뉴 수정 권한 정비
--   이름/설명 수정 : 해당 메뉴의 접근 범위 안 등급 전부
--                    (부장까지(1) 설정 → 부장도 수정, 임원진까지(2) → 임원진도 수정)
--   접근 범위(권한) 변경 : 전도사·교육사(grade 0)만.
--                    다른 등급이 저장해도 기존 max_grade 를 보존한다
--                    (프론트는 p_max_grade null 로 보냄 — null 로 덮어써 위임이
--                     풀리는 사고를 서버에서 차단).
-- =============================================================

create or replace function public.set_dept_menu_setting(
  p_department_id uuid,
  p_menu_key text,
  p_label text default null,
  p_description text default null,
  p_max_grade smallint default null,
  p_section text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_grade smallint;
  v_max smallint := p_max_grade;
  v_section text := nullif(trim(coalesce(p_section, '')), '');
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
    -- 담임메뉴·행정관리: 제목/설명(+행정관리는 섹션)만 수정 가능
    v_max := null;
  elsif p_menu_key like 'dept/%' then
    -- 부서관리: 접근 범위 안이면 이름/설명 수정 가능
    if not public.dept_mgmt_grade_ok(p_department_id, p_menu_key) then
      raise exception '부서관리 메뉴 수정 권한이 없습니다';
    end if;
    if v_grade > 0 then
      -- 권한 설정은 전도사·교육사만 — 기존 저장값 유지 (없으면 null = 기본값 1)
      select s.max_grade into v_max
      from public.dept_menu_settings s
      where s.department_id = p_department_id and s.menu_key = p_menu_key;
    elsif v_max is not null and v_max not in (0, 1, 2) then
      raise exception '접근 등급 값이 올바르지 않습니다 (0=전도사·교육사만, 1=부장까지, 2=임원진까지)';
    end if;
  else
    raise exception '알 수 없는 메뉴입니다';
  end if;

  -- 섹션은 행정관리(admin/*) 항목만, 정의된 섹션 id만 허용
  if v_section is not null then
    if p_menu_key not like 'admin/%' then
      raise exception '섹션 설정은 행정관리 메뉴만 가능합니다';
    end if;
    if v_section not in ('docs','attendance','talent','ops') then
      raise exception '알 수 없는 섹션입니다';
    end if;
  end if;

  insert into public.dept_menu_settings
    (department_id, menu_key, label, description, max_grade, section, updated_by, updated_at)
  values (
    p_department_id, p_menu_key,
    nullif(trim(coalesce(p_label, '')), ''),
    nullif(trim(coalesce(p_description, '')), ''),
    v_max, v_section, auth.uid(), now()
  )
  on conflict (department_id, menu_key) do update
    set label = excluded.label,
        description = excluded.description,
        max_grade = excluded.max_grade,
        section = excluded.section,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;
grant execute on function public.set_dept_menu_setting(uuid, text, text, text, smallint, text) to authenticated;
