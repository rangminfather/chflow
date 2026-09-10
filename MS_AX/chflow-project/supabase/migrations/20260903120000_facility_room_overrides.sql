-- =============================================================
-- 시설 사용신청 — 공간 이름·대여 여부를 관리자가 화면에서 고칠 수 있게
--
-- [배경] 건물·층·공간 목록은 앱의
--   chflow-app/lib/facility/facility-map-config.ts 에 들어 있다.
--   비전센터는 건축도면대로 채웠지만 나머지 건물은 세부 공간이 확인 전이고,
--   확인될 때마다 코드를 고쳐 배포해야 하는 구조였다.
--   관리자가 화면에서 바로 고칠 수 있도록 "덮어쓰기" 테이블을 둔다.
--
-- [설계]
--   * 이 테이블은 **덮어쓰기만** 담는다. 공간의 존재 여부·평면도 배치·건물
--     외곽선은 계속 설정 파일이 정한다. 화면은 설정 파일을 읽고 그 위에
--     여기 있는 값(이름 / 대여 여부)만 덮어쓴다.
--     - 공간을 새로 만들거나 지우는 기능은 아직 없다. 평면도 격자 배치를
--       같이 정해야 해서 별도 작업이다.
--   * 기본값과 같아진 행은 앱이 지운다(save 의 p_resets). 그래서 이 테이블에
--     남아 있는 행 = "설정 파일과 다르게 운영 중인 공간" 목록이 된다.
--   * 과거 신청 내역의 표기는 흔들리지 않는다 — facility_bookings.facility_name
--     은 신청 당시 스냅샷이므로 이름을 바꿔도 지난 내역은 그대로다.
--
-- [권한] 읽기 = 로그인 사용자 전체(신청 화면이 써야 한다).
--        쓰기 = admin / office / pastor (facility_approver_ok, 결재 권한과 동일).
--        테이블 직접 접근은 RLS 로 막고 RPC(SECURITY DEFINER)만 통과시킨다.
-- =============================================================

create table if not exists public.facility_room_overrides (
  facility_id text primary key,
  name        text,
  reservable  boolean,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

comment on table public.facility_room_overrides is
  '시설 공간의 이름/대여여부 덮어쓰기. 공간 목록 자체는 앱 설정 파일(facility-map-config.ts)이 정한다.';

alter table public.facility_room_overrides enable row level security;

-- 직접 접근은 막는다. 아래 RPC 만이 통로다.
drop policy if exists facility_room_overrides_no_direct on public.facility_room_overrides;

revoke all on table public.facility_room_overrides from anon, authenticated;

-- -------------------------------------------------------------
-- 읽기 — 신청 화면이 설정 파일 위에 덮어쓸 값
-- -------------------------------------------------------------
create or replace function public.get_facility_room_overrides()
returns table (
  facility_id text,
  name        text,
  reservable  boolean
)
language sql stable security definer set search_path = public
as $$
  select o.facility_id, o.name, o.reservable
  from public.facility_room_overrides o
  where auth.uid() is not null
  order by o.facility_id;
$$;

grant execute on function public.get_facility_room_overrides() to authenticated;

-- -------------------------------------------------------------
-- 저장 — 한 건물치를 한 번에 (부분 실패로 화면과 어긋나지 않게)
--
--   p_rows   : [{"facility_id": "...", "name": "...", "reservable": true}, ...]
--              설정 파일 기본값과 달라진 공간만 앱이 보낸다.
--   p_resets : 기본값으로 되돌릴 facility_id 목록.
-- -------------------------------------------------------------
create or replace function public.save_facility_room_overrides(
  p_rows   jsonb default '[]'::jsonb,
  p_resets text[] default '{}'::text[]
)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_row     jsonb;
  v_id      text;
  v_name    text;
  v_count   int := 0;
begin
  if not public.facility_approver_ok() then
    raise exception '시설 공간을 수정할 권한이 없습니다';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception '저장할 내용이 올바르지 않습니다';
  end if;

  if jsonb_array_length(p_rows) > 300 then
    raise exception '한 번에 저장할 수 있는 공간 수를 넘었습니다';
  end if;

  -- 되돌리기 먼저 — 같은 id 가 양쪽에 있으면 저장이 이긴다
  if p_resets is not null and array_length(p_resets, 1) is not null then
    delete from public.facility_room_overrides o
    where o.facility_id = any(p_resets);
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_id := nullif(btrim(coalesce(v_row ->> 'facility_id', '')), '');
    if v_id is null then
      raise exception '공간 id 가 비어 있습니다';
    end if;

    v_name := nullif(btrim(coalesce(v_row ->> 'name', '')), '');
    if v_name is not null and char_length(v_name) > 40 then
      raise exception '공간 이름은 40자까지 입력할 수 있습니다: %', v_name;
    end if;

    if (v_row ->> 'reservable') is not null
       and jsonb_typeof(v_row -> 'reservable') <> 'boolean' then
      raise exception '대여 여부 값이 올바르지 않습니다';
    end if;

    insert into public.facility_room_overrides as o
      (facility_id, name, reservable, updated_at, updated_by)
    values
      (v_id, v_name, (v_row ->> 'reservable')::boolean, now(), auth.uid())
    on conflict (facility_id) do update
      set name       = excluded.name,
          reservable = excluded.reservable,
          updated_at = now(),
          updated_by = auth.uid();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.save_facility_room_overrides(jsonb, text[]) to authenticated;
