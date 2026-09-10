-- =============================================================
-- 시설 사용신청 이용 자격
--
-- [교회 결정] 목사 ~ 서리집사 직분과 청년·청소년만 신청·조회할 수 있다.
--   일반 성도와 청소년 미만(어린이·유아·영아)은 대상이 아니다.
--   청년부·청소년부 아이들이 직접 신청하는 경우가 있어 그 둘은 열어 둔다.
--
-- [왜 조회까지 막나] 예약 현황에는 신청자 이름·목적·연락처가 함께 나온다.
--   같은 시간을 원하는 사람끼리 협의하라고 공개하는 것이므로, 신청할 수 있는
--   사람들 사이에서만 보이면 된다. 신청 자격과 조회 자격을 같은 문으로 둔다.
--
-- [직분 문자열] 요람에서 온 값이라 "부목사", "은퇴시무권사" 처럼 앞뒤가 붙는다.
--   정확히 일치가 아니라 낱말 포함으로 본다. 앱 lib/facility/facility-access.ts 와 같은 규칙.
--   모르는 값은 막는다 — 오탈자에 권한이 새지 않게.
-- =============================================================

create or replace function public.facility_requester_ok()
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when auth.uid() is null then false
    -- 결재자는 직분과 무관하게 열어 둔다
    when coalesce(public.get_user_role(), '') in ('admin', 'office', 'pastor') then true
    else exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and coalesce(btrim(p.sub_role), '') <> ''
        and (
          p.sub_role like '%목사%'
          or p.sub_role like '%선교사%'
          or p.sub_role like '%전도사%'
          or p.sub_role like '%사모%'
          or p.sub_role like '%장로%'
          or p.sub_role like '%교육사%'
          or p.sub_role like '%간사%'
          or p.sub_role like '%집사%'   -- 시무집사 · 서리집사(남/여)
          or p.sub_role like '%권사%'
          or p.sub_role like '%청년%'
          or p.sub_role like '%청소년%'
        )
    )
  end;
$$;
grant execute on function public.facility_requester_ok() to authenticated;

-- -------------------------------------------------------------
-- 신청 생성 — 자격 검사를 맨 앞에 붙인다
-- -------------------------------------------------------------
create or replace function public.create_facility_booking(
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
  if not public.facility_requester_ok() then
    raise exception '시설 사용신청은 서리집사 이상 직분과 청년·청소년만 이용할 수 있습니다';
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
-- 예약 현황 조회 — 신청 자격이 있는 사람만
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
  if not public.facility_requester_ok() then
    raise exception '시설 예약 현황은 서리집사 이상 직분과 청년·청소년만 볼 수 있습니다';
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
