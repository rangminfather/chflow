-- Persisted throttle/lease for user-triggered weekend bulletin collection.
-- One row per source and issue date prevents duplicate UMS calls across Vercel instances.

create table if not exists public.bulletin_demand_retry_state (
  source text not null,
  issue_date date not null,
  last_attempt_at timestamptz not null default now(),
  next_retry_at timestamptz not null default now(),
  lease_until timestamptz not null default now(),
  last_status text not null default 'idle'
    check (last_status in ('idle', 'running', 'success', 'not_available', 'error')),
  updated_at timestamptz not null default now(),
  primary key (source, issue_date)
);

alter table public.bulletin_demand_retry_state enable row level security;

revoke all on table public.bulletin_demand_retry_state from public, anon, authenticated;
grant all on table public.bulletin_demand_retry_state to service_role;

create or replace function public.claim_bulletin_demand_retry(
  p_source text,
  p_issue_date date,
  p_cooldown_minutes integer default 30
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  if p_source is null or length(p_source) < 1 or length(p_source) > 100 then
    raise exception 'invalid bulletin retry source';
  end if;
  if p_issue_date is null then
    raise exception 'bulletin retry issue date is required';
  end if;
  if p_cooldown_minutes < 5 or p_cooldown_minutes > 120 then
    raise exception 'invalid bulletin retry cooldown';
  end if;

  insert into public.bulletin_demand_retry_state (
    source, issue_date, last_attempt_at, next_retry_at, lease_until, last_status, updated_at
  ) values (
    p_source,
    p_issue_date,
    now(),
    now() + make_interval(mins => p_cooldown_minutes),
    now() + interval '2 minutes',
    'running',
    now()
  )
  on conflict (source, issue_date) do update
  set last_attempt_at = now(),
      next_retry_at = now() + make_interval(mins => p_cooldown_minutes),
      lease_until = now() + interval '2 minutes',
      last_status = 'running',
      updated_at = now()
  where bulletin_demand_retry_state.next_retry_at <= now()
    and bulletin_demand_retry_state.lease_until <= now()
    and bulletin_demand_retry_state.last_status <> 'success'
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.finish_bulletin_demand_retry(
  p_source text,
  p_issue_date date,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('success', 'not_available', 'error') then
    raise exception 'invalid bulletin retry status';
  end if;

  update public.bulletin_demand_retry_state
  set last_status = p_status,
      lease_until = now(),
      updated_at = now()
  where source = p_source
    and issue_date = p_issue_date;
end;
$$;

revoke all on function public.claim_bulletin_demand_retry(text, date, integer) from public;
revoke all on function public.finish_bulletin_demand_retry(text, date, text) from public;
grant execute on function public.claim_bulletin_demand_retry(text, date, integer) to service_role;
grant execute on function public.finish_bulletin_demand_retry(text, date, text) to service_role;
