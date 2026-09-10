-- =============================================================
-- 시설 예약현황 검색 (날짜중심 / 시설물중심) + 대표·부속 공간
--
-- [배경] 지금은 "지도 → 건물 → 층 → 공간 → 신청" 한 갈래뿐이라, 내가 쓰려는
--   공간이 언제 비어 있는지 한눈에 볼 방법이 없었다. 두 가지 조회를 붙인다.
--     · 날짜중심 : 하루를 골라 전체 시설의 시간대 현황을 한 판에
--     · 시설물중심 : 시설 몇 곳을 골라 그 달의 예약 현황을
--   둘 다 "월 단위로 넘겨보기" 를 하므로 기간 조회 RPC 하나로 받는다.
--
-- [대표·부속] 체육관을 빌리면 그 층 화장실·샤워실은 따라온다. 목록에 다 띄우면
--   길기만 하므로 부속 공간은 대표 공간에 묶어 감추고, 신청할 때 "이것도 쓰겠다"를
--   선택(필수 아님)하게 한다. 어떤 곳이 부속인지는 앱이 kind 로 기본 분류하고,
--   관리자가 공간 편집에서 바꿀 수 있게 parent_id 덮어쓰기를 둔다.
--
-- [공개 범위] 예약 현황은 로그인한 성도 전체가 신청자 이름·목적·시간·연락처까지
--   본다. 같은 시간을 원하는 사람끼리 직접 협의할 수 있게 하기 위한 것으로,
--   교회 요청에 따른 설계다.
-- =============================================================

-- -------------------------------------------------------------
-- 1) 대표·부속 — 공간 덮어쓰기에 parent_id 추가
--    ''  = 대표 공간(기본), 그 외 = 부속이며 값이 대표 공간의 facility_id
-- -------------------------------------------------------------
alter table public.facility_room_overrides
  add column if not exists parent_id text not null default '';

drop function if exists public.get_facility_room_overrides();
create function public.get_facility_room_overrides()
returns table (
  facility_id   text,
  name          text,
  reservable    boolean,
  capacity      int,
  capacity_unit text,
  facilities    text[],
  note          text,
  parent_id     text
)
language sql stable security definer set search_path = public
as $$
  select o.facility_id, o.name, o.reservable, o.capacity, o.capacity_unit,
         o.facilities, o.note, o.parent_id
  from public.facility_room_overrides o
  where auth.uid() is not null
  order by o.facility_id;
$$;
grant execute on function public.get_facility_room_overrides() to authenticated;

-- 저장 RPC — parent_id 를 함께 받는다 (나머지 검증은 20260903193000 과 동일)
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
  v_parent     text;
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

    -- 부속 공간이면 대표 공간 id. 자기 자신을 대표로 둘 수는 없다.
    v_parent := btrim(coalesce(v_row ->> 'parent_id', ''));
    if char_length(v_parent) > 60 then
      raise exception '대표 공간 값이 올바르지 않습니다';
    end if;
    if v_parent = v_id then
      raise exception '공간은 자기 자신에 딸릴 수 없습니다';
    end if;

    insert into public.facility_room_overrides as o
      (facility_id, name, reservable, capacity, capacity_unit, facilities, note, parent_id, updated_at, updated_by)
    values
      (v_id, v_name, (v_row ->> 'reservable')::boolean, v_capacity, v_unit, v_facilities, v_note, v_parent, now(), auth.uid())
    on conflict (facility_id) do update
      set name          = excluded.name,
          reservable    = excluded.reservable,
          capacity      = excluded.capacity,
          capacity_unit = excluded.capacity_unit,
          facilities    = excluded.facilities,
          note          = excluded.note,
          parent_id     = excluded.parent_id,
          updated_at    = now(),
          updated_by    = auth.uid();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
grant execute on function public.save_facility_room_overrides(jsonb, text[]) to authenticated;

-- -------------------------------------------------------------
-- 2) 신청에 "함께 쓰는 부속 공간" 을 남긴다 (필수 아님)
-- -------------------------------------------------------------
alter table public.facility_bookings
  add column if not exists extras text[] not null default '{}'::text[];

drop function if exists public.create_facility_booking(text, text, int, text, date, time, time, text, int, text);
create function public.create_facility_booking(
  p_facility_id   text,
  p_building_code text,
  p_floor         int,
  p_facility_name text,
  p_date          date,
  p_time_start    time,
  p_time_end      time,
  p_purpose       text,
  p_headcount     int    default null,
  p_contact       text   default null,
  p_extras        text[] default '{}'::text[]
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_extras text[];
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;
  if p_facility_id is null or btrim(p_facility_id) = '' then
    raise exception '신청할 공간을 선택해주세요';
  end if;
  if p_date is null or p_time_start is null or p_time_end is null then
    raise exception '사용 날짜와 시간을 입력해주세요';
  end if;
  if p_time_end <= p_time_start then
    raise exception '종료 시각은 시작 시각보다 늦어야 합니다';
  end if;
  if p_date < ((now() at time zone 'Asia/Seoul')::date) then
    raise exception '지난 날짜는 신청할 수 없습니다';
  end if;
  if p_purpose is null or btrim(p_purpose) = '' then
    raise exception '사용 목적을 입력해주세요';
  end if;

  select coalesce(array_agg(distinct x), '{}'::text[])
    into v_extras
  from unnest(coalesce(p_extras, '{}'::text[])) x
  where btrim(x) <> '' and x <> p_facility_id;
  if array_length(v_extras, 1) > 20 then
    raise exception '함께 쓰는 공간은 20곳까지 선택할 수 있습니다';
  end if;

  if exists (
    select 1
    from public.facility_bookings b
    where b.facility_id = p_facility_id
      and b.date = p_date
      and b.status in ('pending', 'approved')
      and b.time_start < p_time_end
      and p_time_start < b.time_end
  ) then
    raise exception '이미 신청된 시간과 겹칩니다. 신청 현황을 확인해주세요';
  end if;

  insert into public.facility_bookings (
    requester_id, facility_id, building_code, floor, facility_name,
    date, time_start, time_end, purpose, headcount, contact, extras, status
  )
  values (
    auth.uid(), p_facility_id, p_building_code, p_floor, p_facility_name,
    p_date, p_time_start, p_time_end, btrim(p_purpose), p_headcount,
    nullif(btrim(coalesce(p_contact, '')), ''), v_extras, 'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function public.create_facility_booking(text, text, int, text, date, time, time, text, int, text, text[]) to authenticated;

-- -------------------------------------------------------------
-- 3) 기간 예약 현황 — 날짜중심·시설물중심 검색이 함께 쓴다
--    p_facility_ids 가 비면 전체 시설
--    조회 범위는 최대 62일 (달을 넘겨봐도 한 번에 두 달 치를 넘지 않게)
-- -------------------------------------------------------------
create or replace function public.get_facility_range_bookings(
  p_from         date,
  p_to           date,
  p_facility_ids text[] default null
)
returns table (
  id             uuid,
  facility_id    text,
  facility_name  text,
  building_code  text,
  floor          int,
  date           date,
  time_start     time,
  time_end       time,
  status         text,
  purpose        text,
  headcount      int,
  contact        text,
  requester_name text,
  is_mine        boolean,
  extras         text[]
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception '조회 기간이 올바르지 않습니다';
  end if;
  if p_to - p_from > 62 then
    raise exception '한 번에 62일까지 조회할 수 있습니다';
  end if;

  return query
  select b.id, b.facility_id, b.facility_name, b.building_code, b.floor,
         b.date, b.time_start, b.time_end, b.status, b.purpose, b.headcount,
         b.contact,
         coalesce(p.name, '알 수 없음') as requester_name,
         (b.requester_id = auth.uid()) as is_mine,
         coalesce(b.extras, '{}'::text[]) as extras
  from public.facility_bookings b
  left join public.profiles p on p.id = b.requester_id
  where b.date between p_from and p_to
    and b.status in ('pending', 'approved')
    and (p_facility_ids is null
         or array_length(p_facility_ids, 1) is null
         or b.facility_id = any(p_facility_ids))
  order by b.date, b.time_start, b.facility_id;
end;
$$;
grant execute on function public.get_facility_range_bookings(date, date, text[]) to authenticated;
