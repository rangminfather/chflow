-- Kept separate from the dashboard functions because RETURNS TABLE output
-- names can collide with PL/pgSQL variables on older remote PostgreSQL builds.
create or replace function public.education_search_member_candidates(
  p_query text,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.exact_rank, q.member_name, q.member_id), '[]'::jsonb)
  from (
    select
      m.id as member_id,
      m.name::text as member_name,
      (to_jsonb(m)->>'sub_role')::text as current_role,
      case
        when coalesce(to_jsonb(m)->>'birth_date', '') ~ '^[0-9]{4}'
        then left(to_jsonb(m)->>'birth_date', 4)::integer
        else null::integer
      end as birth_year,
      right(regexp_replace(coalesce(to_jsonb(m)->>'phone', ''), '[^0-9]', '', 'g'), 4)::text as phone_last4,
      (
        select count(*)::bigint
        from public.member_education_history eh
        where eh.member_id = m.id and eh.deleted_at is null
      ) as existing_history_count,
      case when regexp_replace(m.name, '[[:space:]]+', '', 'g') =
        regexp_replace(btrim(p_query), '[[:space:]]+', '', 'g') then 0 else 1 end as exact_rank
    from public.members m
    where public.has_app_capability('education_history.manage')
      and m.status = 'active'
      and nullif(btrim(p_query), '') is not null
      and m.name ilike '%' || btrim(p_query) || '%'
    order by exact_rank, m.name, m.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) q;
$$;

revoke all on function public.education_search_member_candidates(text, integer) from public, anon;
grant execute on function public.education_search_member_candidates(text, integer) to authenticated;
