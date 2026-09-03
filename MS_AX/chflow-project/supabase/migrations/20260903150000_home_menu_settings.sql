-- =============================================================
-- 홈(메인메뉴) 커스터마이즈
--   home_menu_settings   : 메뉴별 이름 변경 / 숨김 여부
--   home_menu_item_order : 그룹별 카드 순서 (common / implemented / unimplemented / system)
--   메뉴 정의(아이콘·링크·기본 이름)는 프론트 코드(COMMON_MENUS·ADMIN_EXTRA_MENUS)가 소유하고,
--   여기에는 "덮어쓴 값"만 저장한다. 부서 메뉴(dept_menu_settings) 와 같은 구조.
--
--   읽기: 로그인한 사용자 전체 — 관리자가 바꾼 이름·순서·숨김이 전 성도 화면에 반영된다
--   쓰기: profiles.role = 'admin' 만
-- =============================================================

create table if not exists public.home_menu_settings (
  menu_key   text primary key,
  label      text,
  hidden     boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.home_menu_item_order (
  group_id   text primary key,
  item_order text[] not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.home_menu_settings enable row level security;
alter table public.home_menu_item_order enable row level security;
-- 직접 테이블 접근 없음 — 아래 security definer RPC 로만 read/write

-- ───────────────────────── 읽기 ─────────────────────────
create or replace function public.get_home_menu_config()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_settings jsonb;
  v_order jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;

  select coalesce(jsonb_object_agg(menu_key, jsonb_build_object('label', label, 'hidden', hidden)), '{}'::jsonb)
    into v_settings
  from public.home_menu_settings;

  select coalesce(jsonb_object_agg(group_id, to_jsonb(item_order)), '{}'::jsonb)
    into v_order
  from public.home_menu_item_order;

  return jsonb_build_object('settings', v_settings, 'order', v_order);
end;
$$;
grant execute on function public.get_home_menu_config() to authenticated;

-- ───────────────────────── 쓰기: 이름·숨김 ─────────────────────────
create or replace function public.set_home_menu_setting(
  p_menu_key text,
  p_label text default null,
  p_hidden boolean default false
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'admin' then
    raise exception '메인메뉴 설정 권한이 없습니다 (관리자만 가능)';
  end if;

  -- 키 형식: common/<메뉴id> (공통 메뉴) 또는 admin/<메뉴id> (관리자 메뉴)
  if p_menu_key is null
     or length(p_menu_key) > 60
     or (p_menu_key not like 'common/%' and p_menu_key not like 'admin/%')
  then
    raise exception '알 수 없는 메뉴입니다';
  end if;

  insert into public.home_menu_settings (menu_key, label, hidden, updated_by, updated_at)
  values (
    p_menu_key,
    nullif(trim(coalesce(p_label, '')), ''),
    coalesce(p_hidden, false),
    auth.uid(), now()
  )
  on conflict (menu_key) do update
    set label = excluded.label,
        hidden = excluded.hidden,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;
grant execute on function public.set_home_menu_setting(text, text, boolean) to authenticated;

-- ───────────────────────── 쓰기: 순서 ─────────────────────────
create or replace function public.set_home_menu_item_order(p_group text, p_order text[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'admin' then
    raise exception '메인메뉴 설정 권한이 없습니다 (관리자만 가능)';
  end if;

  if p_group not in ('common', 'implemented', 'unimplemented', 'system') then
    raise exception '알 수 없는 메뉴 그룹입니다';
  end if;

  if p_order is null or array_length(p_order, 1) is null or array_length(p_order, 1) > 40
     or exists (select 1 from unnest(p_order) x where x is null or length(x) > 60)
     or (select count(*) from unnest(p_order)) <> (select count(distinct x) from unnest(p_order) x)
  then
    raise exception '메뉴 순서 값이 올바르지 않습니다';
  end if;

  insert into public.home_menu_item_order (group_id, item_order, updated_by, updated_at)
  values (p_group, p_order, auth.uid(), now())
  on conflict (group_id) do update
    set item_order = excluded.item_order,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;
grant execute on function public.set_home_menu_item_order(text, text[]) to authenticated;
