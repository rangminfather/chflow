-- =============================================================
-- 행정관리 섹션(주보·교육자료/출결/달란트/명부·부서운영) 순서 커스터마이즈
--   부서별로 1행 저장, section_order = 4개 섹션 id 의 순열
--   수정 권한: 기존 메뉴 설정과 동일 — 임원진(grade 0~2)
-- =============================================================

create table if not exists public.dept_admin_section_order (
  department_id uuid primary key references public.departments(id) on delete cascade,
  section_order text[] not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.dept_admin_section_order enable row level security;
-- 직접 테이블 접근 없음 — 아래 security definer RPC 로만 read/write

create or replace function public.get_dept_admin_section_order(p_department_id uuid)
returns text[]
language plpgsql stable security definer set search_path = public
as $$
declare
  v_grade smallint;
  v_order text[];
begin
  v_grade := public.get_user_grade(p_department_id);
  if v_grade > 4 then raise exception '접근 권한이 없습니다'; end if;
  select section_order into v_order
  from public.dept_admin_section_order
  where department_id = p_department_id;
  return coalesce(v_order, array['docs','attendance','talent','ops']);
end;
$$;
grant execute on function public.get_dept_admin_section_order(uuid) to authenticated;

create or replace function public.set_dept_admin_section_order(p_department_id uuid, p_order text[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_grade smallint;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  v_grade := public.get_user_grade(p_department_id);
  if v_grade > 2 then raise exception '메뉴 설정 권한이 없습니다 (임원진만 가능)'; end if;

  if p_order is null or array_length(p_order, 1) <> 4
     or (select array_agg(x order by x) from unnest(p_order) x) <> array['attendance','docs','ops','talent']
  then
    raise exception '섹션 순서 값이 올바르지 않습니다';
  end if;

  insert into public.dept_admin_section_order (department_id, section_order, updated_by, updated_at)
  values (p_department_id, p_order, auth.uid(), now())
  on conflict (department_id) do update
    set section_order = excluded.section_order,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;
grant execute on function public.set_dept_admin_section_order(uuid, text[]) to authenticated;
