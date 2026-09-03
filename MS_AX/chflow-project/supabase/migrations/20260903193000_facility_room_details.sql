-- =============================================================
-- 시설 공간 덮어쓰기 확장 — 수용인원·단위·비품·안내문구까지
--
-- [배경] 20260903120000_facility_room_overrides.sql 은 이름·대여여부만
--   관리자가 화면에서 고칠 수 있게 했다. 수용인원·비품은 여전히 코드
--   (lib/facility/facility-map-config.ts)에만 있어서 실측될 때마다 배포가
--   필요했다. 설정 파일에는 임의 기본값을 채워 두고, 확인되는 대로
--   관리자가 화면에서 고치면 되게 컬럼을 넓힌다.
--
-- [설계]
--   * 공간의 존재 여부·평면도 배치는 계속 설정 파일이 정한다.
--     여기서 다루는 것은 "덮어쓰기 값"뿐이고, 공간 추가·삭제는 없다.
--   * 덮어쓰기 행 하나는 그 공간의 **완전한 스냅샷**이다. 앱은 바뀐 공간의
--     모든 필드를 함께 보내고, 기본값과 같아지면 행을 지운다.
--   * capacity 만 nullable — "미지정(모름)" 을 표현해야 하기 때문이다.
--     나머지는 not null + 기본값('' / '{}')이라 null 이 새로 생기지 않는다.
--     (이 마이그레이션 시점에 테이블은 비어 있어 기존 행 보정은 불필요)
-- =============================================================

alter table public.facility_room_overrides
  add column if not exists capacity      int,
  add column if not exists capacity_unit text        not null default '',
  add column if not exists facilities    text[]      not null default '{}'::text[],
  add column if not exists note          text        not null default '';

-- -------------------------------------------------------------
-- 읽기 — 반환 컬럼이 늘어나므로 drop 후 재생성
-- -------------------------------------------------------------
drop function if exists public.get_facility_room_overrides();
create function public.get_facility_room_overrides()
returns table (
  facility_id   text,
  name          text,
  reservable    boolean,
  capacity      int,
  capacity_unit text,
  facilities    text[],
  note          text
)
language sql stable security definer set search_path = public
as $$
  select o.facility_id, o.name, o.reservable, o.capacity, o.capacity_unit, o.facilities, o.note
  from public.facility_room_overrides o
  where auth.uid() is not null
  order by o.facility_id;
$$;
grant execute on function public.get_facility_room_overrides() to authenticated;

-- -------------------------------------------------------------
-- 저장 — 한 건물치를 한 번에 (부분 실패로 화면과 어긋나지 않게)
--
--   p_rows : [{"facility_id":"...","name":"...","reservable":true,
--              "capacity":30,"capacity_unit":"명",
--              "facilities":["빔프로젝터"],"note":"..."}, ...]
--            설정 파일 기본값과 달라진 공간만 앱이 보낸다.
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
  v_row        jsonb;
  v_id         text;
  v_name       text;
  v_capacity   int;
  v_unit       text;
  v_facilities text[];
  v_note       text;
  v_count      int := 0;
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

    -- 수용인원 — 없으면 "미지정"(null). 있으면 0~9999 정수만.
    if v_row -> 'capacity' is null or jsonb_typeof(v_row -> 'capacity') = 'null' then
      v_capacity := null;
    elsif jsonb_typeof(v_row -> 'capacity') <> 'number' then
      raise exception '수용인원은 숫자로 입력해 주세요';
    else
      v_capacity := (v_row ->> 'capacity')::numeric::int;
      if v_capacity < 0 or v_capacity > 9999 then
        raise exception '수용인원은 0~9999 사이로 입력해 주세요';
      end if;
    end if;

    v_unit := btrim(coalesce(v_row ->> 'capacity_unit', ''));
    if char_length(v_unit) > 8 then
      raise exception '수용 단위는 8자까지 입력할 수 있습니다';
    end if;

    -- 비품 — 문자열 배열. 빈 배열이면 "없음".
    if v_row -> 'facilities' is null or jsonb_typeof(v_row -> 'facilities') = 'null' then
      v_facilities := '{}'::text[];
    elsif jsonb_typeof(v_row -> 'facilities') <> 'array' then
      raise exception '비품 목록이 올바르지 않습니다';
    else
      select coalesce(array_agg(x order by ord), '{}'::text[])
        into v_facilities
      from (
        select btrim(value #>> '{}') as x, ordinality as ord
        from jsonb_array_elements(v_row -> 'facilities') with ordinality as t(value, ordinality)
      ) s
      where s.x <> '';
      if array_length(v_facilities, 1) > 12 then
        raise exception '비품은 12개까지 입력할 수 있습니다';
      end if;
      if exists (select 1 from unnest(v_facilities) f where char_length(f) > 20) then
        raise exception '비품 이름은 20자까지 입력할 수 있습니다';
      end if;
    end if;

    v_note := btrim(coalesce(v_row ->> 'note', ''));
    if char_length(v_note) > 80 then
      raise exception '안내 문구는 80자까지 입력할 수 있습니다';
    end if;

    insert into public.facility_room_overrides as o
      (facility_id, name, reservable, capacity, capacity_unit, facilities, note, updated_at, updated_by)
    values
      (v_id, v_name, (v_row ->> 'reservable')::boolean, v_capacity, v_unit, v_facilities, v_note, now(), auth.uid())
    on conflict (facility_id) do update
      set name          = excluded.name,
          reservable    = excluded.reservable,
          capacity      = excluded.capacity,
          capacity_unit = excluded.capacity_unit,
          facilities    = excluded.facilities,
          note          = excluded.note,
          updated_at    = now(),
          updated_by    = auth.uid();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.save_facility_room_overrides(jsonb, text[]) to authenticated;
