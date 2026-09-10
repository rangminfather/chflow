-- 메인 화면의 사역·목장 하위메뉴도 이름·숨김·순서를 편집할 수 있게 허용한다.

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

  if p_menu_key is null
     or length(p_menu_key) > 100
     or (
       p_menu_key not like 'common/%'
       and p_menu_key not like 'admin/%'
       and p_menu_key not like 'section/%'
       and p_menu_key not like 'ministry/%'
       and p_menu_key not like 'pasture/%'
     )
  then
    raise exception '알 수 없는 메뉴입니다';
  end if;

  insert into public.home_menu_settings (menu_key, label, hidden, updated_by, updated_at)
  values (
    p_menu_key,
    nullif(trim(coalesce(p_label, '')), ''),
    case when p_menu_key like 'section/%' then false else coalesce(p_hidden, false) end,
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

  if p_group not in ('ministry', 'pasture', 'common', 'implemented', 'unimplemented', 'system') then
    raise exception '알 수 없는 메뉴 그룹입니다';
  end if;

  if p_order is null or array_length(p_order, 1) is null or array_length(p_order, 1) > 80
     or exists (select 1 from unnest(p_order) x where x is null or length(x) > 100)
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
