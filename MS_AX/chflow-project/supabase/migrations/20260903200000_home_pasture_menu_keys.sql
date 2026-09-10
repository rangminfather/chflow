-- =============================================================
-- [주의] 이 마이그레이션은 20260903210000_home_ministry_pasture_submenus.sql 이
--   같은 함수를 더 넓은 화이트리스트(ministry/ + pasture/)로 다시 정의하면서
--   사실상 대체됐다. 파일을 남겨 두는 이유는 두 가지다.
--     1) 이미 운영 DB 의 마이그레이션 이력에 20260903200000 이 기록돼 있어서,
--        파일이 없으면 supabase db push 가 "로컬에 없는 원격 마이그레이션" 으로
--        막힌다.
--     2) DB 를 처음부터 다시 만들 때도 200000 → 210000 순서로 적용되므로
--        결과는 210000 의 정의와 같다.
--   따라서 내용은 그대로 두고, 새 접두사를 추가할 일이 있으면 210000 이후의
--   새 마이그레이션에서 한다.
-- =============================================================
-- =============================================================
-- 홈 "나의 목장" 섹션의 하위 카드도 관리자가 고칠 수 있게
--
-- [배경] 20260903170000 / 20260903183000 으로 공통·관리자 메뉴와 섹션 제목은
--   고칠 수 있게 됐지만, 사역·부서와 목장 섹션의 톱니는 제목만 바꿀 수 있었다.
--   목장 섹션의 두 카드(목장 모임 · 목장일지)는 코드에 고정된 메뉴이므로
--   공통 메뉴와 똑같이 이름·숨김을 덮어쓸 수 있어야 한다.
--
--   키 접두사만 'pasture/' 를 추가로 허용한다.
--     pasture/pasture-meeting : "목장 모임"
--     pasture/pasture-journal : "목장일지"
--
--   사역·부서 섹션은 여기 넣지 않는다. 그 카드는 성도마다 자기가 가입한
--   부서 목록에서 만들어지므로 전 성도 공통 설정으로 덮어쓸 대상이 아니다
--   (부서 이름은 부서 설정에서 바꾼다).
--
-- [권한] 기존과 같다 — 읽기는 로그인 사용자 전체, 쓰기는 profiles.role='admin'.
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

  -- 키 형식: common/<메뉴id>, admin/<메뉴id>, pasture/<메뉴id>, section/<섹션id>
  if p_menu_key is null
     or length(p_menu_key) > 60
     or (p_menu_key not like 'common/%'
         and p_menu_key not like 'admin/%'
         and p_menu_key not like 'pasture/%'
         and p_menu_key not like 'section/%')
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
