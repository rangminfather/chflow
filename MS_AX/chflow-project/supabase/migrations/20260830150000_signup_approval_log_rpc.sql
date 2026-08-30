begin;

create or replace function public.admin_list_signup_approval_logs(
  p_limit integer default 100
)
returns table (
  id uuid,
  event_type text,
  target_user_id uuid,
  target_name text,
  target_username text,
  actor_id uuid,
  actor_name text,
  actor_username text,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_staff();

  return query
  select
    log.id,
    log.event_type,
    log.target_user_id,
    log.target_name,
    log.target_username,
    log.actor_id,
    log.actor_name,
    log.actor_username,
    log.occurred_at
  from public.approval_audit_logs log
  where log.event_type in ('signup_approved', 'signup_rejected')
  order by log.occurred_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

revoke all on function public.admin_list_signup_approval_logs(integer) from public, anon;
grant execute on function public.admin_list_signup_approval_logs(integer) to authenticated;

comment on function public.admin_list_signup_approval_logs(integer) is
  '가입 대기자 관리에서 최근 가입 승인/거절 대상과 처리자를 조회한다.';

commit;
