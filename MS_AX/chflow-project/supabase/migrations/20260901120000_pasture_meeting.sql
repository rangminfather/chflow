-- 목장 모임 조율 기능 — 테이블 · RLS · RPC
--
-- 흐름: 목원이 이번 달 가능일 표시 → 목자가 집계 보고 추천일 확정 → 최종 참석(RSVP)
--
-- ※ 기존 public.schedules / public.schedule_responses 는 쓰지 않는다.
--   그 테이블의 pasture_id 는 public.pastures(id) 를 참조하는데 pastures 는 0행이고
--   실제 목장 89개는 public.directory_pastures 에 있다. 즉 유효한 목장을 가리킬 수 없다.
--   (혼동을 막기 위해 이 주석을 남긴다. 두 테이블은 0행이라 그대로 방치한다.)
--
-- 소속 경로: members.household_id → households.pasture_id → directory_pastures.id
-- 목장 역할: members.family_church in ('목자','목녀','목원')  ※ sub_role 은 교회 직분이라 다름
-- 계정 연결: members.app_user_id = profiles.id = auth.uid()
--
-- 키 정책: 모든 응답은 members.id 기준이다. auth uid 기준으로 두면 앱 계정이 없는 목원
--   (2,120명 중 연결 59명)을 목자가 대리 입력할 길이 막히고, 나중에 계정을 연결해도
--   기존 응답이 이어지지 않는다. 대리입력 UI 자체는 MVP 밖이지만 entered_by 로 대비한다.
--
-- 접근 제어: 네 테이블 모두 RLS 를 켜고 정책을 두지 않는다(기본 거부).
--   접근은 아래 security definer RPC 로만 한다. 직접 select/insert 는 불가.

-- =============================================================
-- 1. 테이블
-- =============================================================

create table if not exists public.pasture_schedules (
  id                   uuid primary key default gen_random_uuid(),
  pasture_id           uuid not null references public.directory_pastures(id) on delete cascade,
  kind                 text not null default 'regular'
                         check (kind in ('regular','meal','outdoor','service','family_event','etc')),
  title                text not null,
  meets_on             date not null,
  start_time           time,
  end_time             time,
  location             text,
  description          text,
  prep_notes           text,
  family_allowed       boolean not null default true,
  meal_provided        boolean not null default false,
  status               text not null default 'confirmed'
                         check (status in ('draft','confirmed','cancelled')),
  -- 반복 일정: MVP 는 항상 null. 확장 시 'MONTHLY;BYDAY=2FR,4FR' 형태로 저장한다.
  recurrence_rule      text,
  recurrence_parent_id uuid references public.pasture_schedules(id) on delete cascade,
  -- 어느 달 가능일 조사에서 확정됐는지 (해당 월 1일)
  decided_from_month   date,
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_pasture_schedules_pasture_date
  on public.pasture_schedules (pasture_id, meets_on);
create index if not exists idx_pasture_schedules_status
  on public.pasture_schedules (pasture_id, status, meets_on);

comment on table public.pasture_schedules is
  '목장 일정. public.schedules 는 pastures(0행) 참조로 쓸 수 없어 이 테이블을 쓴다.';

create table if not exists public.pasture_availability (
  id         uuid primary key default gen_random_uuid(),
  pasture_id uuid not null references public.directory_pastures(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  on_date    date not null,
  status     text not null check (status in ('ok','hard','maybe')),
  entered_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (member_id, on_date)
);

create index if not exists idx_pasture_availability_lookup
  on public.pasture_availability (pasture_id, on_date, status);

comment on table public.pasture_availability is
  '월간 모임 가능일 사전 조사. 확정 일정의 최종 참석은 pasture_schedule_rsvps 로 따로 받는다.';

create table if not exists public.pasture_schedule_rsvps (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid not null references public.pasture_schedules(id) on delete cascade,
  member_id    uuid not null references public.members(id) on delete cascade,
  response     text not null check (response in ('attend','undecided','absent')),
  -- 가족 단위 인원. MVP 는 화면에 노출하지 않고 기본값만 쓴다.
  adults       int not null default 1 check (adults >= 0),
  children     int not null default 0 check (children >= 0),
  note         text,
  entered_by   uuid references auth.users(id),
  responded_at timestamptz not null default now(),
  unique (schedule_id, member_id)
);

create index if not exists idx_pasture_rsvps_schedule
  on public.pasture_schedule_rsvps (schedule_id, response);

comment on table public.pasture_schedule_rsvps is
  '확정 일정의 최종 참석. 미응답은 별도 status 가 아니라 행이 없는 상태로 표현한다.';

-- 반복 일정 예외 — 구조만 미리 둔다 (MVP 미사용)
create table if not exists public.pasture_schedule_overrides (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid not null references public.pasture_schedules(id) on delete cascade,
  original_date date not null,
  action        text not null check (action in ('skip','move','edit')),
  payload       jsonb not null default '{}'::jsonb,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (parent_id, original_date)
);

alter table public.pasture_schedules          enable row level security;
alter table public.pasture_availability       enable row level security;
alter table public.pasture_schedule_rsvps     enable row level security;
alter table public.pasture_schedule_overrides enable row level security;

-- =============================================================
-- 2. 헬퍼 — 내 목장 / 내 성도행 / 목자 여부
-- =============================================================

create or replace function public.pasture_my_member_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select m.id from public.members m where m.app_user_id = auth.uid() limit 1;
$$;

create or replace function public.pasture_my_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select h.pasture_id
    from public.members m
    join public.households h on h.id = m.household_id
   where m.app_user_id = auth.uid()
   limit 1;
$$;

-- 목자·목녀는 한 목장에 여럿일 수 있다(부부가 목자·목녀인 경우가 정상). 다중 허용.
create or replace function public.pasture_is_leader(p_pasture_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.get_user_role(), '') in ('admin','office','pastor')
      or exists (
           select 1
             from public.members m
             join public.households h on h.id = m.household_id
            where m.app_user_id = auth.uid()
              and h.pasture_id = p_pasture_id
              and m.family_church in ('목자','목녀')
         );
$$;

create or replace function public.pasture_can_view(p_pasture_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.get_user_role(), '') in ('admin','office','pastor')
      or public.pasture_my_id() = p_pasture_id;
$$;

revoke all on function public.pasture_my_member_id()      from public, anon;
revoke all on function public.pasture_my_id()             from public, anon;
revoke all on function public.pasture_is_leader(uuid)     from public, anon;
revoke all on function public.pasture_can_view(uuid)      from public, anon;
grant execute on function public.pasture_my_member_id()   to authenticated;
grant execute on function public.pasture_my_id()          to authenticated;
grant execute on function public.pasture_is_leader(uuid)  to authenticated;
grant execute on function public.pasture_can_view(uuid)   to authenticated;

-- =============================================================
-- 3. 조회 RPC
-- =============================================================

-- 우리 목장 구성원. 가정 단위로 묶어 보여주기 위해 household 정보를 함께 반환한다.
create or replace function public.pasture_list_members(p_pasture_id uuid default null)
returns table (
  member_id     uuid,
  name          text,
  family_church text,
  sub_role      text,
  is_child      boolean,
  household_id  uuid,
  household_no  int,
  relationship  text,
  has_app       boolean,
  is_me         boolean
)
language sql stable security definer set search_path = public as $$
  with target as (select coalesce(p_pasture_id, public.pasture_my_id()) as pid)
  select
    m.id,
    m.name,
    m.family_church,
    m.sub_role,
    coalesce(m.is_child, false),
    m.household_id,
    h.order_no,
    m.relationship_in_household,
    m.app_user_id is not null,
    m.app_user_id = auth.uid()
  from target t
  join public.households h on h.pasture_id = t.pid
  join public.members m on m.household_id = h.id
  where public.pasture_can_view(t.pid)
    and coalesce(m.account_state, 'active') <> 'withdrawn'
  order by h.order_no nulls last, coalesce(m.is_child, false), m.child_order nulls first, m.name;
$$;

-- 월간 달력 — 목장 일정 + 교회 공식 일정 + 내 가능일을 한 번에 받는다.
-- source 로 구분한다: 'pasture' | 'church' | 'availability'
create or replace function public.pasture_calendar(
  p_from date,
  p_to date,
  p_pasture_id uuid default null
)
returns table (
  source      text,
  ref_id      uuid,
  on_date     date,
  title       text,
  kind        text,
  start_time  time,
  end_time    time,
  location    text,
  status      text,
  family_allowed boolean,
  meal_provided  boolean
)
language sql stable security definer set search_path = public as $$
  with target as (select coalesce(p_pasture_id, public.pasture_my_id()) as pid)
  -- 목장 일정
  select 'pasture'::text, s.id, s.meets_on, s.title, s.kind,
         s.start_time, s.end_time, s.location, s.status,
         s.family_allowed, s.meal_provided
    from target t
    join public.pasture_schedules s on s.pasture_id = t.pid
   where public.pasture_can_view(t.pid)
     and s.meets_on between p_from and p_to
     and s.status <> 'cancelled'
  union all
  -- 교회 공식 일정 (읽기 전용). 교회달력 기능이 데이터를 채우면 자동으로 함께 나온다.
  select 'church'::text, e.id, e.event_date, e.title, coalesce(e.category, 'etc')::text,
         e.event_time, null::time, e.location, 'confirmed'::text,
         null::boolean, null::boolean
    from public.church_events e
   where e.event_date between p_from and p_to
  union all
  -- 내 가능일 (source='availability' 일 때 title·status 에 ok/hard/maybe 가 담긴다)
  select 'availability'::text, a.id, a.on_date, a.status, 'availability'::text,
         null::time, null::time, null::text, a.status,
         null::boolean, null::boolean
    from target t
    join public.pasture_availability a
      on a.pasture_id = t.pid
     and a.member_id = public.pasture_my_member_id()
   where a.on_date between p_from and p_to;
$$;

-- 목장 홈 요약 — 다음 확정 모임 + 참석 집계 + 내 응답 + 이번 달 가능일 등록 여부
create or replace function public.pasture_home(p_pasture_id uuid default null)
returns table (
  pasture_id        uuid,
  pasture_name      text,
  is_leader         boolean,
  member_total      int,
  next_schedule_id  uuid,
  next_title        text,
  next_meets_on     date,
  next_start_time   time,
  next_location     text,
  next_meal         boolean,
  next_family       boolean,
  my_response       text,
  cnt_attend        int,
  cnt_undecided     int,
  cnt_absent        int,
  cnt_pending       int,
  my_availability_count int
)
language sql stable security definer set search_path = public as $$
  with target as (select coalesce(p_pasture_id, public.pasture_my_id()) as pid),
  roster as (
    select m.id
      from target t
      join public.households h on h.pasture_id = t.pid
      join public.members m on m.household_id = h.id
     where coalesce(m.account_state, 'active') <> 'withdrawn'
       and coalesce(m.is_child, false) = false
  ),
  nxt as (
    select s.*
      from target t
      join public.pasture_schedules s on s.pasture_id = t.pid
     where s.status = 'confirmed'
       and s.meets_on >= (now() at time zone 'Asia/Seoul')::date
     order by s.meets_on, s.start_time nulls last
     limit 1
  ),
  tally as (
    select
      count(*) filter (where r.response = 'attend')    as a,
      count(*) filter (where r.response = 'undecided') as u,
      count(*) filter (where r.response = 'absent')    as x
      from public.pasture_schedule_rsvps r
     where r.schedule_id = (select id from nxt)
       and r.member_id in (select id from roster)
  )
  select
    t.pid,
    dp.name,
    public.pasture_is_leader(t.pid),
    (select count(*)::int from roster),
    n.id, n.title, n.meets_on, n.start_time, n.location, n.meal_provided, n.family_allowed,
    (select r.response from public.pasture_schedule_rsvps r
      where r.schedule_id = n.id and r.member_id = public.pasture_my_member_id()),
    coalesce((select a from tally), 0)::int,
    coalesce((select u from tally), 0)::int,
    coalesce((select x from tally), 0)::int,
    greatest(
      (select count(*)::int from roster)
      - coalesce((select a + u + x from tally), 0)::int, 0),
    (select count(*)::int
       from public.pasture_availability av
      where av.member_id = public.pasture_my_member_id()
        and av.on_date >= date_trunc('month', (now() at time zone 'Asia/Seoul')::date)::date
        and av.on_date <  (date_trunc('month', (now() at time zone 'Asia/Seoul')::date) + interval '1 month')::date)
  from target t
  left join public.directory_pastures dp on dp.id = t.pid
  left join nxt n on true
  where public.pasture_can_view(t.pid);
$$;

-- 가능일 집계 + 추천 (목자·목녀 전용). 가능 인원 최다 → 동수면 이른 날짜.
create or replace function public.pasture_availability_summary(
  p_from date,
  p_to date,
  p_pasture_id uuid default null
)
returns table (
  on_date      date,
  ok_count     int,
  hard_count   int,
  maybe_count  int,
  responded    int,
  roster_total int,
  is_recommended boolean
)
language sql stable security definer set search_path = public as $$
  with target as (select coalesce(p_pasture_id, public.pasture_my_id()) as pid),
  guard as (select 1 where public.pasture_is_leader((select pid from target))),
  roster as (
    select m.id
      from target t
      join public.households h on h.pasture_id = t.pid
      join public.members m on m.household_id = h.id
     where coalesce(m.account_state, 'active') <> 'withdrawn'
       and coalesce(m.is_child, false) = false
  ),
  agg as (
    select
      a.on_date,
      count(*) filter (where a.status = 'ok')    as ok_count,
      count(*) filter (where a.status = 'hard')  as hard_count,
      count(*) filter (where a.status = 'maybe') as maybe_count,
      count(*)                                   as responded
      from target t
      join public.pasture_availability a on a.pasture_id = t.pid
     where a.on_date between p_from and p_to
       and a.member_id in (select id from roster)
       and exists (select 1 from guard)
     group by a.on_date
  ),
  best as (
    select on_date from agg where ok_count > 0
     order by ok_count desc, on_date asc limit 1
  )
  select
    agg.on_date,
    agg.ok_count::int,
    agg.hard_count::int,
    agg.maybe_count::int,
    agg.responded::int,
    (select count(*)::int from roster),
    agg.on_date = (select on_date from best)
  from agg
  order by agg.on_date;
$$;

-- 일정 상세 + 참석현황. 목자에게는 이름까지, 목원에게는 집계만 노출하도록
-- respondent_name 을 조건부로 비운다.
create or replace function public.pasture_schedule_detail(p_schedule_id uuid)
returns table (
  schedule_id   uuid,
  pasture_id    uuid,
  title         text,
  kind          text,
  meets_on      date,
  start_time    time,
  end_time      time,
  location      text,
  description   text,
  prep_notes    text,
  family_allowed boolean,
  meal_provided  boolean,
  status        text,
  is_leader     boolean,
  my_response   text,
  member_id     uuid,
  member_name   text,
  response      text
)
language sql stable security definer set search_path = public as $$
  with s as (
    select * from public.pasture_schedules where id = p_schedule_id
  ),
  roster as (
    select m.id, m.name
      from s
      join public.households h on h.pasture_id = s.pasture_id
      join public.members m on m.household_id = h.id
     where coalesce(m.account_state, 'active') <> 'withdrawn'
       and coalesce(m.is_child, false) = false
  )
  select
    s.id, s.pasture_id, s.title, s.kind, s.meets_on, s.start_time, s.end_time,
    s.location, s.description, s.prep_notes, s.family_allowed, s.meal_provided, s.status,
    public.pasture_is_leader(s.pasture_id),
    (select r.response from public.pasture_schedule_rsvps r
      where r.schedule_id = s.id and r.member_id = public.pasture_my_member_id()),
    ro.id,
    case when public.pasture_is_leader(s.pasture_id) then ro.name else null end,
    coalesce(rs.response, 'pending')
  from s
  join roster ro on true
  left join public.pasture_schedule_rsvps rs
    on rs.schedule_id = s.id and rs.member_id = ro.id
  where public.pasture_can_view(s.pasture_id)
  order by
    case coalesce(rs.response, 'pending')
      when 'attend' then 1 when 'undecided' then 2 when 'absent' then 3 else 4 end,
    ro.name;
$$;

revoke all on function public.pasture_list_members(uuid) from public, anon;
revoke all on function public.pasture_calendar(date, date, uuid) from public, anon;
revoke all on function public.pasture_home(uuid) from public, anon;
revoke all on function public.pasture_availability_summary(date, date, uuid) from public, anon;
revoke all on function public.pasture_schedule_detail(uuid) from public, anon;
grant execute on function public.pasture_list_members(uuid) to authenticated;
grant execute on function public.pasture_calendar(date, date, uuid) to authenticated;
grant execute on function public.pasture_home(uuid) to authenticated;
grant execute on function public.pasture_availability_summary(date, date, uuid) to authenticated;
grant execute on function public.pasture_schedule_detail(uuid) to authenticated;

-- =============================================================
-- 4. 쓰기 RPC
-- =============================================================

-- 내 가능일 저장. p_status 가 null 이면 해당 날짜 응답을 지운다(달력 탭 순환의 마지막 단계).
create or replace function public.pasture_set_availability(p_on_date date, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := public.pasture_my_member_id();
  v_pid    uuid := public.pasture_my_id();
begin
  if v_member is null or v_pid is null then
    raise exception '목장에 소속된 성도 정보가 없습니다';
  end if;
  if p_status is null then
    delete from public.pasture_availability
     where member_id = v_member and on_date = p_on_date;
    return;
  end if;
  if p_status not in ('ok','hard','maybe') then
    raise exception '알 수 없는 상태입니다: %', p_status;
  end if;

  insert into public.pasture_availability (pasture_id, member_id, on_date, status, entered_by)
  values (v_pid, v_member, p_on_date, p_status, auth.uid())
  on conflict (member_id, on_date)
  do update set status = excluded.status,
                pasture_id = excluded.pasture_id,
                entered_by = excluded.entered_by,
                updated_at = now();
end;
$$;

-- 내 최종 참석 응답
create or replace function public.pasture_set_rsvp(p_schedule_id uuid, p_response text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := public.pasture_my_member_id();
  v_pid    uuid;
begin
  select pasture_id into v_pid from public.pasture_schedules where id = p_schedule_id;
  if v_pid is null then raise exception '일정을 찾을 수 없습니다'; end if;
  if not public.pasture_can_view(v_pid) then raise exception '이 목장 일정에 응답할 권한이 없습니다'; end if;
  if v_member is null then raise exception '연결된 성도 정보가 없습니다'; end if;
  if p_response not in ('attend','undecided','absent') then
    raise exception '알 수 없는 응답입니다: %', p_response;
  end if;

  insert into public.pasture_schedule_rsvps (schedule_id, member_id, response, entered_by)
  values (p_schedule_id, v_member, p_response, auth.uid())
  on conflict (schedule_id, member_id)
  do update set response = excluded.response,
                entered_by = excluded.entered_by,
                responded_at = now();
end;
$$;

-- 일정 생성·수정 (목자·목녀). p_id 가 null 이면 신규.
-- 확정(status='confirmed') 으로 새로 만들면 목장 전원에게 알림을 넣는다.
create or replace function public.pasture_upsert_schedule(
  p_id uuid,
  p_title text,
  p_meets_on date,
  p_kind text default 'regular',
  p_start_time time default null,
  p_end_time time default null,
  p_location text default null,
  p_description text default null,
  p_prep_notes text default null,
  p_family_allowed boolean default true,
  p_meal_provided boolean default false,
  p_status text default 'confirmed',
  p_decided_from_month date default null,
  p_pasture_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid := coalesce(p_pasture_id, public.pasture_my_id());
  v_id  uuid;
  v_new boolean := p_id is null;
  v_name text;
begin
  if v_pid is null then raise exception '목장 정보를 찾을 수 없습니다'; end if;
  if not public.pasture_is_leader(v_pid) then
    raise exception '목자·목녀만 목장 일정을 등록·수정할 수 있습니다';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception '일정명을 입력하세요'; end if;

  if v_new then
    insert into public.pasture_schedules (
      pasture_id, kind, title, meets_on, start_time, end_time, location,
      description, prep_notes, family_allowed, meal_provided, status,
      decided_from_month, created_by
    ) values (
      v_pid, p_kind, trim(p_title), p_meets_on, p_start_time, p_end_time, p_location,
      p_description, p_prep_notes, p_family_allowed, p_meal_provided, p_status,
      p_decided_from_month, auth.uid()
    ) returning id into v_id;
  else
    update public.pasture_schedules set
      kind = p_kind, title = trim(p_title), meets_on = p_meets_on,
      start_time = p_start_time, end_time = p_end_time, location = p_location,
      description = p_description, prep_notes = p_prep_notes,
      family_allowed = p_family_allowed, meal_provided = p_meal_provided,
      status = p_status, updated_at = now()
     where id = p_id and pasture_id = v_pid
     returning id into v_id;
    if v_id is null then raise exception '수정할 일정을 찾을 수 없습니다'; end if;
  end if;

  -- 확정 알림 — 앱 계정이 연결된 목원에게만 들어간다(계정 없는 목원은 자연히 제외).
  if p_status = 'confirmed' then
    select name into v_name from public.directory_pastures where id = v_pid;
    insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata, audience)
    select
      m.app_user_id,
      case when v_new then 'pasture_schedule_confirmed' else 'pasture_schedule_changed' end,
      case when v_new then '목장모임이 확정되었습니다' else '목장 일정이 변경되었습니다' end,
      coalesce(v_name, '목장') || ' · ' || to_char(p_meets_on, 'MM월 DD일')
        || coalesce(' ' || to_char(p_start_time, 'HH24:MI'), '') || ' — ' || trim(p_title),
      '/pasture/s/' || v_id::text,
      auth.uid(),
      jsonb_build_object('schedule_id', v_id, 'pasture_id', v_pid),
      'user'
    from public.households h
    join public.members m on m.household_id = h.id
    where h.pasture_id = v_pid
      and m.app_user_id is not null
      and m.app_user_id <> auth.uid()
      and coalesce(m.account_state, 'active') <> 'withdrawn';
  end if;

  return v_id;
end;
$$;

-- 일정 취소 (목자·목녀)
create or replace function public.pasture_cancel_schedule(p_schedule_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid;
  v_title text;
  v_on date;
begin
  select pasture_id, title, meets_on into v_pid, v_title, v_on
    from public.pasture_schedules where id = p_schedule_id;
  if v_pid is null then raise exception '일정을 찾을 수 없습니다'; end if;
  if not public.pasture_is_leader(v_pid) then
    raise exception '목자·목녀만 일정을 취소할 수 있습니다';
  end if;

  update public.pasture_schedules
     set status = 'cancelled', updated_at = now()
   where id = p_schedule_id;

  insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata, audience)
  select m.app_user_id, 'pasture_schedule_cancelled', '목장 일정이 취소되었습니다',
         to_char(v_on, 'MM월 DD일') || ' ' || v_title,
         '/pasture', auth.uid(),
         jsonb_build_object('schedule_id', p_schedule_id, 'pasture_id', v_pid), 'user'
    from public.households h
    join public.members m on m.household_id = h.id
   where h.pasture_id = v_pid
     and m.app_user_id is not null
     and m.app_user_id <> auth.uid()
     and coalesce(m.account_state, 'active') <> 'withdrawn';
end;
$$;

-- 미응답자 알림 (목자·목녀)
--   p_kind = 'availability' → 이번 달 가능일 미입력자에게
--   p_kind = 'rsvp'         → 해당 일정 RSVP 미응답자에게
create or replace function public.pasture_notify_pending(
  p_kind text,
  p_schedule_id uuid default null,
  p_month date default null,
  p_pasture_id uuid default null
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_pid   uuid := coalesce(p_pasture_id, public.pasture_my_id());
  v_month date := coalesce(p_month, date_trunc('month', (now() at time zone 'Asia/Seoul')::date)::date);
  v_sent  int := 0;
  v_title text;
  v_on    date;
begin
  if v_pid is null then raise exception '목장 정보를 찾을 수 없습니다'; end if;
  if not public.pasture_is_leader(v_pid) then
    raise exception '목자·목녀만 알림을 보낼 수 있습니다';
  end if;

  if p_kind = 'availability' then
    insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata, audience)
    select m.app_user_id, 'pasture_availability_request', '이번 달 가능한 날을 입력해주세요',
           to_char(v_month, 'MM월') || ' 목장모임 날짜를 정하려고 합니다. 달력에서 가능한 날을 표시해주세요.',
           '/pasture/calendar', auth.uid(),
           jsonb_build_object('pasture_id', v_pid, 'month', v_month), 'user'
      from public.households h
      join public.members m on m.household_id = h.id
     where h.pasture_id = v_pid
       and m.app_user_id is not null
       and m.app_user_id <> auth.uid()
       and coalesce(m.account_state, 'active') <> 'withdrawn'
       and coalesce(m.is_child, false) = false
       and not exists (
         select 1 from public.pasture_availability a
          where a.member_id = m.id
            and a.on_date >= v_month
            and a.on_date < (v_month + interval '1 month')::date
       );
    get diagnostics v_sent = row_count;

  elsif p_kind = 'rsvp' then
    if p_schedule_id is null then raise exception '일정을 지정하세요'; end if;
    select title, meets_on into v_title, v_on
      from public.pasture_schedules where id = p_schedule_id and pasture_id = v_pid;
    if v_title is null then raise exception '일정을 찾을 수 없습니다'; end if;

    insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata, audience)
    select m.app_user_id, 'pasture_rsvp_request', '참석 여부를 알려주세요',
           to_char(v_on, 'MM월 DD일') || ' ' || v_title,
           '/pasture/s/' || p_schedule_id::text, auth.uid(),
           jsonb_build_object('schedule_id', p_schedule_id, 'pasture_id', v_pid), 'user'
      from public.households h
      join public.members m on m.household_id = h.id
     where h.pasture_id = v_pid
       and m.app_user_id is not null
       and m.app_user_id <> auth.uid()
       and coalesce(m.account_state, 'active') <> 'withdrawn'
       and coalesce(m.is_child, false) = false
       and not exists (
         select 1 from public.pasture_schedule_rsvps r
          where r.schedule_id = p_schedule_id and r.member_id = m.id
       );
    get diagnostics v_sent = row_count;
  else
    raise exception '알 수 없는 알림 종류입니다: %', p_kind;
  end if;

  return v_sent;
end;
$$;

revoke all on function public.pasture_set_availability(date, text) from public, anon;
revoke all on function public.pasture_set_rsvp(uuid, text) from public, anon;
revoke all on function public.pasture_upsert_schedule(uuid, text, date, text, time, time, text, text, text, boolean, boolean, text, date, uuid) from public, anon;
revoke all on function public.pasture_cancel_schedule(uuid) from public, anon;
revoke all on function public.pasture_notify_pending(text, uuid, date, uuid) from public, anon;
grant execute on function public.pasture_set_availability(date, text) to authenticated;
grant execute on function public.pasture_set_rsvp(uuid, text) to authenticated;
grant execute on function public.pasture_upsert_schedule(uuid, text, date, text, time, time, text, text, text, boolean, boolean, text, date, uuid) to authenticated;
grant execute on function public.pasture_cancel_schedule(uuid) to authenticated;
grant execute on function public.pasture_notify_pending(text, uuid, date, uuid) to authenticated;

-- =============================================================
-- 5. 알림 설정 — pasture 카테고리 추가
--    20260823110000_worship_live_notification_split.sql 에서 worship_end 를 붙일 때 쓴
--    패턴을 그대로 따른다: 컬럼 추가 → 판정 CASE 추가 → get/set 함수 재정의.
-- =============================================================
alter table public.notification_preferences
  add column if not exists pasture_enabled boolean not null default true;

-- 5-1. 채널 허용 판정에 pasture 분기 추가
create or replace function public.notification_channel_allowed(p_user_id uuid, p_type text, p_channel text)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when public.notification_category(p_type) in ('ops_report', 'ops_system') then true
    when public.notification_category(p_type) = 'ops_signup' then coalesce(
      (select np.ops_signup_enabled from public.notification_preferences np where np.user_id = p_user_id), true)
    when public.notification_category(p_type) = 'ops_feedback' then coalesce(
      (select np.ops_feedback_enabled from public.notification_preferences np where np.user_id = p_user_id), true)
    -- 분류가 없으면 차단하지 않는다. 분류 누락으로 알림이 유실되는 쪽이 더 나쁘다.
    when public.notification_category(p_type) = 'unclassified' then true
    else coalesce((
      select np.enabled
        and case p_channel when 'push' then np.push_enabled when 'in_app' then np.in_app_enabled else false end
        and case public.notification_category(p_type)
          when 'message' then np.message_enabled
          when 'worship' then np.worship_enabled
          when 'worship_end' then np.worship_end_enabled
          when 'notice' then np.notice_enabled
          when 'department' then np.department_enabled
          when 'education' then np.education_enabled
          when 'pasture' then np.pasture_enabled
          when 'feedback' then np.feedback_enabled
          when 'account' then np.account_enabled
          else np.system_enabled
        end
      from public.notification_preferences np where np.user_id = p_user_id
    ), true)
  end
$$;
revoke all on function public.notification_channel_allowed(uuid, text, text) from public, anon, authenticated;
grant execute on function public.notification_channel_allowed(uuid, text, text) to service_role;

-- 5-2. notification_category 에 pasture 타입 5종 등록.
--      lib/notificationPreferences.ts 의 NOTIFICATION_TYPES 와 매핑이 일치해야 한다
--      (한쪽만 고치면 in-app 과 push 판정이 갈린다).
create or replace function public.notification_category(p_type text)
returns text language sql immutable set search_path = public
as $$
  select case coalesce(p_type, '')
    when 'notice_worship_live'        then 'worship'
    when 'notice_worship_live_ended'  then 'worship_end'
    when 'message_new'                then 'message'
    when 'signup_approved'            then 'account'
    when 'signup_rejected'            then 'account'
    when 'feedback_reply'             then 'feedback'
    when 'feedback_status'            then 'feedback'
    when 'dept_join_approved'         then 'department'
    when 'dept_join_rejected'         then 'department'
    when 'dept_approved'              then 'department'
    when 'dept_rejected'              then 'department'
    when 'dept_removed'               then 'department'
    when 'dept_role_assigned'         then 'department'
    when 'dept_appointed'             then 'department'
    when 'dept_notice_new'            then 'department'
    when 'dept_notice_reply'          then 'department'
    when 'dept_verse_memory_new'      then 'department'
    when 'dept_join_request'          then 'department'
    when 'dept_promotion_in'          then 'department'
    when 'edu_promotion_done'         then 'education'
    when 'edu_promotion_upcoming'     then 'education'
    when 'edu_absence'                then 'education'
    -- 목장 모임 조율 (신규)
    when 'pasture_availability_request' then 'pasture'
    when 'pasture_schedule_confirmed'   then 'pasture'
    when 'pasture_schedule_changed'     then 'pasture'
    when 'pasture_schedule_cancelled'   then 'pasture'
    when 'pasture_rsvp_request'         then 'pasture'
    when 'ops_signup_pending'         then 'ops_signup'
    when 'ops_feedback_new'           then 'ops_feedback'
    when 'ops_message_report'         then 'ops_report'
    when 'ops_usage_anomaly'          then 'ops_system'
    when 'ops_usage_r2_capacity'      then 'ops_system'
    when 'ops_usage_db_capacity'      then 'ops_system'
    when 'ops_bulletin_sync_error'    then 'ops_system'
    else 'unclassified'
  end
$$;

-- 5-3. RETURNS TABLE 컬럼이 늘어나므로 CREATE OR REPLACE 로는 바꿀 수 없다(42P13). 먼저 제거한다.
drop function if exists public.get_my_notification_preferences();
create or replace function public.get_my_notification_preferences()
returns table(
  enabled boolean, push_enabled boolean, in_app_enabled boolean,
  message_enabled boolean, worship_enabled boolean, worship_end_enabled boolean,
  notice_enabled boolean,
  department_enabled boolean, education_enabled boolean, pasture_enabled boolean,
  feedback_enabled boolean,
  account_enabled boolean, system_enabled boolean,
  ops_signup_enabled boolean, ops_feedback_enabled boolean
)
language sql stable security definer set search_path = public
as $$
  select
    coalesce(np.enabled,true), coalesce(np.push_enabled,true), coalesce(np.in_app_enabled,true),
    coalesce(np.message_enabled,true), coalesce(np.worship_enabled,true), coalesce(np.worship_end_enabled,true),
    coalesce(np.notice_enabled,true),
    coalesce(np.department_enabled,true), coalesce(np.education_enabled,true), coalesce(np.pasture_enabled,true),
    coalesce(np.feedback_enabled,true),
    coalesce(np.account_enabled,true), coalesce(np.system_enabled,true),
    coalesce(np.ops_signup_enabled,true), coalesce(np.ops_feedback_enabled,true)
  from (select 1) seed
  left join public.notification_preferences np on np.user_id = auth.uid()
$$;
grant execute on function public.get_my_notification_preferences() to authenticated;

-- 5-4. 새 인자는 기본값을 주고 뒤에 붙인다(선례와 동일). 구버전 14인자 오버로드는 제거해
--      호출 모호성을 막는다. 클라이언트는 named argument 로 호출하므로 순서 영향은 없다.
drop function if exists public.set_my_notification_preferences(
  boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean
);
create or replace function public.set_my_notification_preferences(
  p_enabled boolean, p_push_enabled boolean, p_in_app_enabled boolean,
  p_message_enabled boolean, p_worship_enabled boolean, p_notice_enabled boolean,
  p_department_enabled boolean, p_education_enabled boolean, p_feedback_enabled boolean,
  p_account_enabled boolean, p_system_enabled boolean,
  p_ops_signup_enabled boolean default true, p_ops_feedback_enabled boolean default true,
  p_worship_end_enabled boolean default null,
  p_pasture_enabled boolean default true
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_worship_end boolean := coalesce(p_worship_end_enabled, p_worship_enabled, true);
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  insert into public.notification_preferences(
    user_id,enabled,push_enabled,in_app_enabled,message_enabled,worship_enabled,worship_end_enabled,
    notice_enabled,department_enabled,education_enabled,pasture_enabled,feedback_enabled,
    account_enabled,system_enabled,ops_signup_enabled,ops_feedback_enabled,updated_at
  ) values(
    auth.uid(),coalesce(p_enabled,true),coalesce(p_push_enabled,true),coalesce(p_in_app_enabled,true),
    coalesce(p_message_enabled,true),coalesce(p_worship_enabled,true),v_worship_end,
    coalesce(p_notice_enabled,true),
    coalesce(p_department_enabled,true),coalesce(p_education_enabled,true),coalesce(p_pasture_enabled,true),
    coalesce(p_feedback_enabled,true),
    coalesce(p_account_enabled,true),coalesce(p_system_enabled,true),
    coalesce(p_ops_signup_enabled,true),coalesce(p_ops_feedback_enabled,true),now()
  ) on conflict(user_id) do update set
    enabled=excluded.enabled,push_enabled=excluded.push_enabled,in_app_enabled=excluded.in_app_enabled,
    message_enabled=excluded.message_enabled,worship_enabled=excluded.worship_enabled,
    worship_end_enabled=excluded.worship_end_enabled,
    notice_enabled=excluded.notice_enabled,department_enabled=excluded.department_enabled,
    education_enabled=excluded.education_enabled,pasture_enabled=excluded.pasture_enabled,
    feedback_enabled=excluded.feedback_enabled,
    account_enabled=excluded.account_enabled,system_enabled=excluded.system_enabled,
    ops_signup_enabled=excluded.ops_signup_enabled,ops_feedback_enabled=excluded.ops_feedback_enabled,
    updated_at=now();
end;
$$;
grant execute on function public.set_my_notification_preferences(
  boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,
  boolean,boolean,boolean,boolean
) to authenticated;
