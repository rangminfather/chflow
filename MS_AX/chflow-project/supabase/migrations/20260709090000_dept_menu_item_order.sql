-- =============================================================
-- 부서 메뉴 카테고리 내 항목 순서 커스터마이즈 (편집모드 드래그 정렬)
--   부서 × 카테고리별 1행, item_order = 메뉴 id 배열
--   수정 권한: 기존 메뉴 설정과 동일 — 임원진(0~2), 부서관리 카테고리는 부장(0~1)
-- =============================================================

create table if not exists public.dept_menu_item_order (
  department_id uuid not null references public.departments(id) on delete cascade,
  category_id   text not null,
  item_order    text[] not null,
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  primary key (department_id, category_id)
);

alter table public.dept_menu_item_order enable row level security;
-- 직접 테이블 접근 없음 — 아래 security definer RPC 로만 read/write

create or replace function public.get_dept_menu_item_order(p_department_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_grade smallint;
begin
  v_grade := public.get_user_grade(p_department_id);
  if v_grade > 4 then raise exception '접근 권한이 없습니다'; end if;
  return coalesce(
    (select jsonb_object_agg(category_id, to_jsonb(item_order))
     from public.dept_menu_item_order
     where department_id = p_department_id),
    '{}'::jsonb
  );
end;
$$;
grant execute on function public.get_dept_menu_item_order(uuid) to authenticated;

create or replace function public.set_dept_menu_item_order(p_department_id uuid, p_category text, p_order text[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_grade smallint;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  v_grade := public.get_user_grade(p_department_id);
  if p_category = 'department' then
    if v_grade > 1 then raise exception '메뉴 설정 권한이 없습니다 (부장 이상만 가능)'; end if;
  else
    if v_grade > 2 then raise exception '메뉴 설정 권한이 없습니다 (임원진만 가능)'; end if;
  end if;

  if p_category not in ('notices', 'students', 'admin', 'department') then
    raise exception '알 수 없는 메뉴 카테고리입니다';
  end if;
  if p_order is null or array_length(p_order, 1) is null or array_length(p_order, 1) > 40
     or exists (select 1 from unnest(p_order) x where x is null or length(x) > 60)
     or (select count(*) from unnest(p_order)) <> (select count(distinct x) from unnest(p_order) x)
  then
    raise exception '메뉴 순서 값이 올바르지 않습니다';
  end if;

  insert into public.dept_menu_item_order (department_id, category_id, item_order, updated_by, updated_at)
  values (p_department_id, p_category, p_order, auth.uid(), now())
  on conflict (department_id, category_id) do update
    set item_order = excluded.item_order,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;
grant execute on function public.set_dept_menu_item_order(uuid, text, text[]) to authenticated;
