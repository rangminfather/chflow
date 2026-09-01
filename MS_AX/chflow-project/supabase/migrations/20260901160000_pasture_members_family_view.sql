-- 목장 구성원 화면을 "가정 공동체" 로 보여주기 위한 컬럼 추가.
--
-- 확정된 표시 기준:
--   구성원 화면      = 자녀 포함, 가정 단위로 묶어 부부 + 자녀
--   자녀             = "자녀 2명" 요약, 펼치면 이름·나이
--   운영 통계 분모   = 성인만 (pasture_home / availability_summary / schedule_detail 은 그대로)
--   테스트·중복 데이터 = 임의 삭제하지 않고 화면에 정리 대상으로만 표시
--
-- RETURNS TABLE 컬럼이 늘어나므로 CREATE OR REPLACE 로는 못 바꾼다(42P13). 먼저 제거한다.
drop function if exists public.pasture_list_members(uuid);

create or replace function public.pasture_list_members(p_pasture_id uuid default null)
returns table (
  member_id     uuid,
  name          text,
  family_church text,
  sub_role      text,
  is_child      boolean,
  gender        text,
  birth_date    date,
  household_id  uuid,
  household_no  int,
  relationship  text,
  has_app       boolean,
  is_me         boolean,
  -- 같은 가정 안에 같은 이름이 둘 이상이면 중복 의심으로 표시한다.
  -- 실제 동명이인일 수도 있어 삭제·병합은 하지 않고 화면에서만 알린다.
  dup_in_household boolean
)
language sql stable security definer set search_path = public as $$
  with target as (select coalesce(p_pasture_id, public.pasture_my_id()) as pid),
  roster as (
    select
      m.id, m.name, m.family_church, m.sub_role,
      coalesce(m.is_child, false) as is_child,
      m.gender, m.birth_date,
      m.household_id, h.order_no as household_no,
      m.relationship_in_household,
      m.app_user_id, m.child_order,
      count(*) over (partition by m.household_id, m.name) > 1 as dup_in_household
    from target t
    join public.households h on h.pasture_id = t.pid
    join public.members m on m.household_id = h.id
    where public.pasture_can_view(t.pid)
      and coalesce(m.account_state, 'active') <> 'withdrawn'
  )
  select
    r.id, r.name, r.family_church, r.sub_role, r.is_child,
    r.gender, r.birth_date,
    r.household_id, r.household_no, r.relationship_in_household,
    r.app_user_id is not null,
    r.app_user_id = auth.uid(),
    r.dup_in_household
  from roster r
  order by
    -- 목자·목녀 가정을 먼저, 그 다음 가정 번호
    case when exists (
      select 1 from roster x
       where x.household_id = r.household_id
         and x.family_church in ('목자','목녀')
    ) then 0 else 1 end,
    r.household_no nulls last,
    r.household_id,
    r.is_child,            -- 가정 안에서는 성인 먼저
    r.child_order nulls first,
    r.name;
$$;

revoke all on function public.pasture_list_members(uuid) from public, anon;
grant execute on function public.pasture_list_members(uuid) to authenticated;
