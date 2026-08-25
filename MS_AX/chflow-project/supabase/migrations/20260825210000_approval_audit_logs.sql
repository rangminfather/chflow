-- 회원가입 및 부서 가입 승인/거절 이력을 최종 상태와 별도로 누적 보관한다.
-- 기존 profiles/department_members 의 approved_* 컬럼은 현재 상태 표시용으로 유지한다.

begin;

create table if not exists public.approval_audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'signup_approved',
    'signup_rejected',
    'department_approved',
    'department_rejected'
  )),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  actor_username text,
  target_user_id uuid references auth.users(id) on delete set null,
  target_name text,
  target_username text,
  department_id uuid references public.departments(id) on delete set null,
  department_name text,
  department_member_id uuid references public.department_members(id) on delete set null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_approval_audit_logs_occurred_at
  on public.approval_audit_logs (occurred_at desc);
create index if not exists idx_approval_audit_logs_target
  on public.approval_audit_logs (target_user_id, occurred_at desc);
create index if not exists idx_approval_audit_logs_actor
  on public.approval_audit_logs (actor_id, occurred_at desc);
create index if not exists idx_approval_audit_logs_department
  on public.approval_audit_logs (department_id, occurred_at desc);

alter table public.approval_audit_logs enable row level security;

drop policy if exists approval_audit_logs_admin_select on public.approval_audit_logs;
create policy approval_audit_logs_admin_select
  on public.approval_audit_logs
  for select
  to authenticated
  using (public.get_user_role() = 'admin');

revoke all on table public.approval_audit_logs from anon, authenticated;
grant select on table public.approval_audit_logs to authenticated;
grant all on table public.approval_audit_logs to service_role;

create or replace function public.log_profile_approval_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_actor_username text;
begin
  if new.status not in ('active', 'rejected') or new.approved_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.approved_at is not distinct from new.approved_at
     and old.approved_by is not distinct from new.approved_by then
    return new;
  end if;

  v_actor_id := coalesce(new.approved_by, auth.uid());
  select p.name, p.username
    into v_actor_name, v_actor_username
  from public.profiles p
  where p.id = v_actor_id;

  insert into public.approval_audit_logs (
    event_type,
    actor_id,
    actor_name,
    actor_username,
    target_user_id,
    target_name,
    target_username,
    occurred_at,
    metadata
  ) values (
    case when new.status = 'active' then 'signup_approved' else 'signup_rejected' end,
    v_actor_id,
    v_actor_name,
    v_actor_username,
    new.id,
    new.name,
    new.username,
    new.approved_at,
    jsonb_build_object(
      'status', new.status,
      'approval_source', case when v_actor_id is null then 'automatic' else 'user' end
    )
  );

  return new;
end;
$$;

revoke all on function public.log_profile_approval_event() from public, anon, authenticated;
grant execute on function public.log_profile_approval_event() to service_role;

drop trigger if exists trg_log_profile_approval_event on public.profiles;
create trigger trg_log_profile_approval_event
after insert or update of status, approved_at, approved_by
on public.profiles
for each row
execute function public.log_profile_approval_event();

create or replace function public.log_department_approval_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_actor_username text;
  v_target_name text;
  v_target_username text;
  v_department_name text;
begin
  if new.status not in ('approved', 'rejected') or new.approved_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.approved_at is not distinct from new.approved_at
     and old.approved_by is not distinct from new.approved_by then
    return new;
  end if;

  v_actor_id := coalesce(new.approved_by, auth.uid());

  select p.name, p.username
    into v_actor_name, v_actor_username
  from public.profiles p
  where p.id = v_actor_id;

  select p.name, p.username
    into v_target_name, v_target_username
  from public.profiles p
  where p.id = new.user_id;

  select d.name
    into v_department_name
  from public.departments d
  where d.id = new.department_id;

  insert into public.approval_audit_logs (
    event_type,
    actor_id,
    actor_name,
    actor_username,
    target_user_id,
    target_name,
    target_username,
    department_id,
    department_name,
    department_member_id,
    occurred_at,
    metadata
  ) values (
    case when new.status = 'approved' then 'department_approved' else 'department_rejected' end,
    v_actor_id,
    v_actor_name,
    v_actor_username,
    new.user_id,
    v_target_name,
    v_target_username,
    new.department_id,
    v_department_name,
    new.id,
    new.approved_at,
    jsonb_build_object(
      'status', new.status,
      'member_role', new.member_role,
      'grade', new.grade
    )
  );

  return new;
end;
$$;

revoke all on function public.log_department_approval_event() from public, anon, authenticated;
grant execute on function public.log_department_approval_event() to service_role;

drop trigger if exists trg_log_department_approval_event on public.department_members;
create trigger trg_log_department_approval_event
after insert or update of status, approved_at, approved_by
on public.department_members
for each row
execute function public.log_department_approval_event();

-- 마이그레이션 이전의 최종 승인/거절 상태를 최초 감사 이력으로 보존한다.
insert into public.approval_audit_logs (
  event_type,
  actor_id,
  actor_name,
  actor_username,
  target_user_id,
  target_name,
  target_username,
  occurred_at,
  metadata
)
select
  case when target.status = 'active' then 'signup_approved' else 'signup_rejected' end,
  target.approved_by,
  actor.name,
  actor.username,
  target.id,
  target.name,
  target.username,
  target.approved_at,
  jsonb_build_object('status', target.status, 'backfilled', true)
from public.profiles target
left join public.profiles actor on actor.id = target.approved_by
where target.status in ('active', 'rejected')
  and target.approved_at is not null
  and not exists (
    select 1
    from public.approval_audit_logs existing
    where existing.event_type = case
            when target.status = 'active' then 'signup_approved'
            else 'signup_rejected'
          end
      and existing.target_user_id = target.id
      and existing.occurred_at = target.approved_at
  );

insert into public.approval_audit_logs (
  event_type,
  actor_id,
  actor_name,
  actor_username,
  target_user_id,
  target_name,
  target_username,
  department_id,
  department_name,
  department_member_id,
  occurred_at,
  metadata
)
select
  case when dm.status = 'approved' then 'department_approved' else 'department_rejected' end,
  dm.approved_by,
  actor.name,
  actor.username,
  dm.user_id,
  target.name,
  target.username,
  dm.department_id,
  d.name,
  dm.id,
  dm.approved_at,
  jsonb_build_object(
    'status', dm.status,
    'member_role', dm.member_role,
    'grade', dm.grade,
    'backfilled', true
  )
from public.department_members dm
left join public.profiles actor on actor.id = dm.approved_by
left join public.profiles target on target.id = dm.user_id
left join public.departments d on d.id = dm.department_id
where dm.status in ('approved', 'rejected')
  and dm.approved_at is not null
  and not exists (
    select 1
    from public.approval_audit_logs existing
    where existing.event_type = case
            when dm.status = 'approved' then 'department_approved'
            else 'department_rejected'
          end
      and existing.department_member_id = dm.id
      and existing.occurred_at = dm.approved_at
  );

comment on table public.approval_audit_logs is
  '회원가입 및 부서 가입 승인/거절의 누적 감사 로그. 이름과 사용자명은 처리 당시 값으로 보존한다.';

commit;
