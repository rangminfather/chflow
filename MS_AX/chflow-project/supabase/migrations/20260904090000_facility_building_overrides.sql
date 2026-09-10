-- =============================================================
-- 건물 이름·설명도 관리자가 화면에서 고칠 수 있게
--
-- [배경] 공간(방) 이름·대여여부·수용인원은 facility_room_overrides 로 고칠 수
--   있었지만, 건물 이름("명성교회 비전센터", "바울관주차장" 등)은 코드에만
--   있어서 바꾸려면 배포가 필요했다.
--
-- [설계] 공간 덮어쓰기와 같은 모양 — 건물 목록·외곽선·층 구성은 계속 설정 파일
--   (facility-map-config.ts)이 정하고, 여기에는 덮어쓴 이름/설명만 담는다.
--   건물 추가·삭제는 없다.
--
-- [권한] 읽기는 로그인 사용자 전체, 쓰기는 facility_approver_ok() — 공간 편집과 동일.
-- =============================================================

create table if not exists public.facility_building_overrides (
  building_code text primary key,
  name          text not null default '',
  description   text not null default '',
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

comment on table public.facility_building_overrides is
  '시설 건물의 이름/설명 덮어쓰기. 건물 목록·배치는 앱 설정 파일이 정한다.';

alter table public.facility_building_overrides enable row level security;

-- 직접 접근은 막는다. 아래 RPC 만이 통로다.
revoke all on table public.facility_building_overrides from anon, authenticated;

-- -------------------------------------------------------------
-- 읽기
-- -------------------------------------------------------------
create or replace function public.get_facility_building_overrides()
returns table (
  building_code text,
  name          text,
  description   text
)
language sql stable security definer set search_path = public
as $$
  select o.building_code, o.name, o.description
  from public.facility_building_overrides o
  where auth.uid() is not null
  order by o.building_code;
$$;
grant execute on function public.get_facility_building_overrides() to authenticated;

-- -------------------------------------------------------------
-- 저장 — 건물 하나치. 이름·설명이 모두 비면 덮어쓰기 행을 지운다.
-- -------------------------------------------------------------
create or replace function public.save_facility_building_override(
  p_building_code text,
  p_name          text default '',
  p_description   text default ''
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
  v_name text;
  v_desc text;
begin
  if not public.facility_approver_ok() then
    raise exception '시설 건물을 수정할 권한이 없습니다';
  end if;

  v_code := nullif(btrim(coalesce(p_building_code, '')), '');
  if v_code is null or char_length(v_code) > 40 then
    raise exception '건물 코드가 올바르지 않습니다';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if char_length(v_name) > 40 then
    raise exception '건물 이름은 40자까지 입력할 수 있습니다';
  end if;

  v_desc := btrim(coalesce(p_description, ''));
  if char_length(v_desc) > 60 then
    raise exception '건물 설명은 60자까지 입력할 수 있습니다';
  end if;

  -- 둘 다 비었으면 기본값으로 되돌린다
  if v_name = '' and v_desc = '' then
    delete from public.facility_building_overrides o where o.building_code = v_code;
    return;
  end if;

  insert into public.facility_building_overrides as o
    (building_code, name, description, updated_at, updated_by)
  values (v_code, v_name, v_desc, now(), auth.uid())
  on conflict (building_code) do update
    set name        = excluded.name,
        description = excluded.description,
        updated_at  = now(),
        updated_by  = auth.uid();
end;
$$;
grant execute on function public.save_facility_building_override(text, text, text) to authenticated;
