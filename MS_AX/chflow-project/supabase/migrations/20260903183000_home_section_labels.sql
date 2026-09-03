-- =============================================================
-- 홈 섹션 제목도 관리자가 바꿀 수 있게 확장
--   기존 home_menu_settings 를 그대로 쓰고, 키 접두사만 'section/' 을 추가로 허용한다.
--     section/ministry : "내 사역 · 부서"
--     section/pasture  : "나의 목장"
--     section/common   : "공통 메뉴"
--   섹션은 숨기거나 순서를 바꾸지 않는다 — 이름(label)만 의미가 있다.
-- =============================================================

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

  -- 키 형식: common/<메뉴id>, admin/<메뉴id>, section/<섹션id>
  if p_menu_key is null
     or length(p_menu_key) > 60
     or (p_menu_key not like 'common/%' and p_menu_key not like 'admin/%' and p_menu_key not like 'section/%')
  then
    raise exception '알 수 없는 메뉴입니다';
  end if;

  insert into public.home_menu_settings (menu_key, label, hidden, updated_by, updated_at)
  values (
    p_menu_key,
    nullif(trim(coalesce(p_label, '')), ''),
    -- 섹션은 숨김 개념이 없다 (제목만 바꾼다)
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
