-- =============================================================
-- 시설 사용신청 — 신청/결재 플로우
--
-- [배경] facility_bookings 테이블은 초기 스키마(20260410000000)에 만들어졌지만
--   화면이 없어 한 건도 쓰이지 않았다(운영 DB 0행 확인). 이번에 시설 사용신청
--   화면을 붙이면서 필요한 최소 컬럼만 추가하고, 신청·결재를 RPC 로 감싼다.
--
-- [설계]
--   * 어느 공간인지 = facility_id (text). 값은 앱의
--     chflow-app/lib/facility/facility-map-config.ts 가 정의한 공간 id 다.
--     (예: "education-2f-201"). 시설 목록을 나중에 DB(facilities 테이블)로
--     옮기더라도 이 컬럼은 그대로 두고 FK 만 걸면 된다.
--   * facility_name / building_code / floor 는 "신청 당시의 표기"를 남기는
--     스냅샷이다. 설정 파일에서 공간 이름이 바뀌어도 과거 신청 내역의
--     표기가 흔들리지 않게 한다.
--   * 상태: pending → approved / rejected (결재자), pending → cancelled (신청자)
--   * 중복 방지: 같은 공간·같은 날짜에 pending/approved 신청과 시간이 겹치면 거부.
--     approved 만이 아니라 pending 도 막는 이유는, 결재 대기 중인 건과
--     겹치는 신청이 쌓이면 결재자가 매번 수작업으로 골라내야 하기 때문이다.
--
-- [권한] 결재자 = admin / office / pastor.
--   초기 RLS 는 office/admin 만 UPDATE 를 허용하지만, 결재 RPC 는
--   SECURITY DEFINER 이므로 여기 정의한 범위가 실제 게이트다.
-- =============================================================

alter table public.facility_bookings
  add column if not exists facility_id   text,
  add column if not exists building_code text,
  add column if not exists floor         int,
  add column if not exists headcount     int,
  add column if not exists contact       text,
  add column if not exists decided_at    timestamptz,
  add column if not exists decision_note text;

-- 신청자 취소 상태 추가
alter table public.facility_bookings drop constraint if exists facility_bookings_status_check;
alter table public.facility_bookings add constraint facility_bookings_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));

create index if not exists idx_facility_bookings_facility_date
  on public.facility_bookings (facility_id, date);

-- -------------------------------------------------------------
-- 결재 권한 헬퍼
-- -------------------------------------------------------------
create or replace function public.facility_approver_ok()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.get_user_role() in ('admin', 'office', 'pastor'), false);
$$;

grant execute on function public.facility_approver_ok() to authenticated;

-- -------------------------------------------------------------
-- 신청 생성
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
  p_headcount     int  default null,
  p_contact       text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
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
    date, time_start, time_end, purpose, headcount, contact, status
  )
  values (
    auth.uid(), p_facility_id, p_building_code, p_floor, p_facility_name,
    p_date, p_time_start, p_time_end, btrim(p_purpose), p_headcount,
    nullif(btrim(coalesce(p_contact, '')), ''), 'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_facility_booking(text, text, int, text, date, time, time, text, int, text) to authenticated;

-- -------------------------------------------------------------
-- 내 신청 내역
-- -------------------------------------------------------------
create or replace function public.get_my_facility_bookings()
returns table (
  id            uuid,
  facility_id   text,
  building_code text,
  floor         int,
  facility_name text,
  date          date,
  time_start    time,
  time_end      time,
  purpose       text,
  headcount     int,
  contact       text,
  status        text,
  decision_note text,
  decided_at    timestamptz,
  created_at    timestamptz
)
language sql stable security definer set search_path = public
as $$
  select b.id, b.facility_id, b.building_code, b.floor, b.facility_name,
         b.date, b.time_start, b.time_end, b.purpose, b.headcount, b.contact,
         b.status, b.decision_note, b.decided_at, b.created_at
  from public.facility_bookings b
  where b.requester_id = auth.uid()
  order by b.date desc, b.time_start desc, b.created_at desc;
$$;

grant execute on function public.get_my_facility_bookings() to authenticated;

-- -------------------------------------------------------------
-- 특정 공간·날짜의 신청 현황 (시간 충돌 안내용)
-- 신청자 정보는 노출하지 않는다 — 시간대와 상태만 보여준다.
-- -------------------------------------------------------------
create or replace function public.get_facility_day_bookings(
  p_facility_id text,
  p_date        date
)
returns table (
  time_start time,
  time_end   time,
  status     text
)
language sql stable security definer set search_path = public
as $$
  select b.time_start, b.time_end, b.status
  from public.facility_bookings b
  where b.facility_id = p_facility_id
    and b.date = p_date
    and b.status in ('pending', 'approved')
    and auth.uid() is not null
  order by b.time_start;
$$;

grant execute on function public.get_facility_day_bookings(text, date) to authenticated;

-- -------------------------------------------------------------
-- 신청자 본인 취소 (결재 전만)
-- -------------------------------------------------------------
create or replace function public.cancel_facility_booking(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_status text;
begin
  select b.status into v_status
  from public.facility_bookings b
  where b.id = p_id and b.requester_id = auth.uid();

  if v_status is null then
    raise exception '신청 내역을 찾을 수 없습니다';
  end if;
  if v_status <> 'pending' then
    raise exception '결재가 끝난 신청은 취소할 수 없습니다';
  end if;

  update public.facility_bookings
  set status = 'cancelled'
  where id = p_id;
end;
$$;

grant execute on function public.cancel_facility_booking(uuid) to authenticated;

-- -------------------------------------------------------------
-- 결재 목록
-- -------------------------------------------------------------
create or replace function public.get_facility_bookings_admin(p_status text default null)
returns table (
  id             uuid,
  requester_id   uuid,
  requester_name text,
  facility_id    text,
  building_code  text,
  floor          int,
  facility_name  text,
  date           date,
  time_start     time,
  time_end       time,
  purpose        text,
  headcount      int,
  contact        text,
  status         text,
  decision_note  text,
  decided_at     timestamptz,
  created_at     timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.facility_approver_ok() then
    raise exception '시설 신청을 결재할 권한이 없습니다';
  end if;

  return query
  select b.id, b.requester_id, p.name, b.facility_id, b.building_code, b.floor,
         b.facility_name, b.date, b.time_start, b.time_end, b.purpose,
         b.headcount, b.contact, b.status, b.decision_note, b.decided_at, b.created_at
  from public.facility_bookings b
  left join public.profiles p on p.id = b.requester_id
  where p_status is null or b.status = p_status
  order by
    case when b.status = 'pending' then 0 else 1 end,
    b.date asc,
    b.time_start asc;
end;
$$;

grant execute on function public.get_facility_bookings_admin(text) to authenticated;

-- -------------------------------------------------------------
-- 결재 (승인 / 반려)
-- -------------------------------------------------------------
create or replace function public.decide_facility_booking(
  p_id       uuid,
  p_decision text,
  p_note     text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_status      text;
  v_facility_id text;
  v_date        date;
  v_start       time;
  v_end         time;
begin
  if not public.facility_approver_ok() then
    raise exception '시설 신청을 결재할 권한이 없습니다';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception '결재 값이 올바르지 않습니다';
  end if;

  select b.status, b.facility_id, b.date, b.time_start, b.time_end
  into v_status, v_facility_id, v_date, v_start, v_end
  from public.facility_bookings b
  where b.id = p_id;

  if v_status is null then
    raise exception '신청 내역을 찾을 수 없습니다';
  end if;
  if v_status <> 'pending' then
    raise exception '이미 처리된 신청입니다';
  end if;

  -- 승인 시점에 다시 한 번 충돌 확인 (대기 건이 여러 개 쌓였을 수 있다)
  if p_decision = 'approved' and exists (
    select 1
    from public.facility_bookings b
    where b.id <> p_id
      and b.facility_id = v_facility_id
      and b.date = v_date
      and b.status = 'approved'
      and b.time_start < v_end
      and v_start < b.time_end
  ) then
    raise exception '이미 승인된 신청과 시간이 겹칩니다';
  end if;

  update public.facility_bookings
  set status        = p_decision,
      approved_by   = auth.uid(),
      decided_at    = now(),
      decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_id;
end;
$$;

grant execute on function public.decide_facility_booking(uuid, text, text) to authenticated;
