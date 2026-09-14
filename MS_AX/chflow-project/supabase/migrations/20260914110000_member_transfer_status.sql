-- 이명(다른 교회로 전출) 전용 회원 상태값 추가 + 상태 변경 기록.
-- 목장 목록(pasture_list_members)이 members.status를 전혀 보지 않던 문제도 함께 고친다
-- (기존에는 교적에서 '분리보관' 처리해도 목장 목록에는 그대로 남아있었음).

-- 1. status 체크 제약에 'transferred' 추가
alter table public.members drop constraint if exists members_status_check;
alter table public.members
  add constraint members_status_check check (status in ('active', 'inactive', 'transferred'));

-- 2. 이명 정보 컬럼 (현재 상태 스냅샷)
alter table public.members
  add column if not exists transferred_at timestamptz,
  add column if not exists transferred_by uuid,
  add column if not exists transfer_reason text;

-- 3. 상태 변경 이력 (기록)
create table if not exists public.member_status_history (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  member_name text,
  old_status  text,
  new_status  text not null,
  reason      text,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);

create index if not exists idx_member_status_history_member
  on public.member_status_history (member_id, changed_at desc);

alter table public.member_status_history enable row level security;
revoke all on table public.member_status_history from anon, authenticated;

-- 4. 상태 변경 RPC — 상태를 바꾸고 이력을 함께 남긴다
drop function if exists public.admin_set_member_status(uuid, text, text);
create or replace function public.admin_set_member_status(
  p_member_id uuid,
  p_status    text,
  p_reason    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
  v_name       text;
begin
  if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then
    raise exception '권한이 없습니다';
  end if;

  if p_status not in ('active', 'inactive', 'transferred') then
    raise exception '알 수 없는 상태입니다: %', p_status;
  end if;

  select status, name into v_old_status, v_name
  from public.members where id = p_member_id;

  if not found then
    raise exception '해당 회원을 찾을 수 없습니다';
  end if;

  if v_old_status is distinct from p_status then
    update public.members
    set status = p_status,
        transferred_at = case when p_status = 'transferred' then now() else null end,
        transferred_by = case when p_status = 'transferred' then auth.uid() else null end,
        transfer_reason = case when p_status = 'transferred' then nullif(trim(coalesce(p_reason, '')), '') else null end
    where id = p_member_id;

    insert into public.member_status_history (
      member_id, member_name, old_status, new_status, reason, changed_by
    ) values (
      p_member_id, v_name, v_old_status, p_status, nullif(trim(coalesce(p_reason, '')), ''), auth.uid()
    );
  end if;
end;
$$;
grant execute on function public.admin_set_member_status(uuid, text, text) to authenticated;

-- 5. 회원 상태 변경 이력 조회 (기록 확인용)
drop function if exists public.admin_list_member_status_history(uuid);
create or replace function public.admin_list_member_status_history(p_member_id uuid)
returns table (
  id uuid,
  old_status text,
  new_status text,
  reason text,
  changed_by_name text,
  changed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then
    raise exception '권한이 없습니다';
  end if;

  return query
  select h.id, h.old_status, h.new_status, h.reason,
    coalesce(p.name, '-') as changed_by_name,
    h.changed_at
  from public.member_status_history h
  left join public.profiles p on p.id = h.changed_by
  where h.member_id = p_member_id
  order by h.changed_at desc;
end;
$$;
grant execute on function public.admin_list_member_status_history(uuid) to authenticated;

-- 6. 목장 목록에서도 활성 회원만 노출 (이명·분리보관 회원 제외)
drop function if exists public.pasture_list_members(uuid);
create or replace function public.pasture_list_members(p_pasture_id uuid default null)
returns table (
  member_id       uuid,
  name            text,
  family_church   text,
  sub_role        text,
  is_child        boolean,
  gender          text,
  birth_date      date,
  household_id    uuid,
  household_no    int,
  relationship    text,
  has_app         boolean,
  is_me           boolean,
  dup_in_household boolean,
  photo_url       text
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
      coalesce(pr.avatar_url, m.photo_url) as photo_url,
      count(*) over (partition by m.household_id, m.name) > 1 as dup_in_household
    from target t
    join public.households h on h.pasture_id = t.pid
    join public.members m on m.household_id = h.id
    left join public.profiles pr on pr.id = m.app_user_id
    where public.pasture_can_view(t.pid)
      and coalesce(m.account_state, 'active') <> 'withdrawn'
      and coalesce(m.status, 'active') = 'active'
  )
  select
    r.id, r.name, r.family_church, r.sub_role, r.is_child,
    r.gender, r.birth_date,
    r.household_id, r.household_no, r.relationship_in_household,
    r.app_user_id is not null,
    r.app_user_id = auth.uid(),
    r.dup_in_household,
    r.photo_url
  from roster r
  order by
    case when exists (
      select 1 from roster x
      where x.household_id = r.household_id
        and x.family_church in ('목자', '목녀')
    ) then 0 else 1 end,
    r.household_no nulls last,
    r.household_id,
    r.is_child,
    r.child_order nulls first,
    r.name;
$$;

revoke all on function public.pasture_list_members(uuid) from public, anon;
grant execute on function public.pasture_list_members(uuid) to authenticated;

notify pgrst, 'reload schema';
