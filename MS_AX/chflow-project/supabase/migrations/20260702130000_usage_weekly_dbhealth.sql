create or replace function public.admin_usage_weekly(p_weeks int default 8)
returns table (
  week_start date,
  visitors int,
  returning_visitors int,
  prev_visitors int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_weeks int := least(greatest(coalesce(p_weeks, 8), 1), 52);
begin
  if public.get_user_role() <> 'admin' then
    raise exception '관리자만 조회할 수 있습니다';
  end if;
  return query
  with wv as (
    select date_trunc('week', d.visit_date::timestamp)::date as ws, d.user_id
    from public.app_daily_visits d
    group by 1, 2
  ),
  weeks as (
    select (date_trunc('week', v_today::timestamp)::date - (i.n * 7)) as ws
    from generate_series(0, v_weeks - 1) as i(n)
  )
  select
    w.ws as week_start,
    (select count(*)::int from wv a where a.ws = w.ws) as visitors,
    (select count(*)::int from wv a
      where a.ws = w.ws
        and exists (select 1 from wv b where b.ws = w.ws - 7 and b.user_id = a.user_id)
    ) as returning_visitors,
    (select count(*)::int from wv p where p.ws = w.ws - 7) as prev_visitors
  from weeks w
  order by w.ws;
end;
$$;
grant execute on function public.admin_usage_weekly(int) to authenticated;

-- ─────────────────────────────────────────
-- 무료 플랜 리소스 상태: DB 총 용량 + 상위 테이블 5개
-- (egress 는 SQL 로 조회 불가 — Supabase Dashboard 링크로 안내)
-- ─────────────────────────────────────────
create or replace function public.admin_db_health()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_user_role() <> 'admin' then
    raise exception '관리자만 조회할 수 있습니다';
  end if;
  return jsonb_build_object(
    'db_size_bytes', pg_database_size(current_database()),
    'top_tables', (
      select coalesce(jsonb_agg(jsonb_build_object('name', t.relname, 'bytes', t.total_bytes)), '[]'::jsonb)
      from (
        select c.relname, pg_total_relation_size(c.oid) as total_bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc
        limit 5
      ) t
    )
  );
end;
$$;
grant execute on function public.admin_db_health() to authenticated;
