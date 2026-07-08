-- =============================================================
-- 리소스 스냅샷 오탐 제거 — 관리도구(대시보드/CLI)의 시스템 카탈로그 쿼리 제외
--  - pg_timezone_names 등은 앱 트래픽이 아닌데 postgres 역할로 실행돼 필터를 통과했음
--  - 역할 필터는 유지(우리 RPC 가 security definer=postgres)하고 쿼리 패턴으로 제외
-- =============================================================
create or replace function public.admin_usage_take_snapshot()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_date date := (now() at time zone 'Asia/Seoul')::date - 1;
begin
  insert into public.admin_usage_snapshots (snap_date, db_size_bytes, table_sizes, stmt_totals, top_queries, visitors)
  select
    v_date,
    pg_database_size(current_database()),
    (
      select coalesce(jsonb_agg(jsonb_build_object('name', t.relname, 'bytes', t.total_bytes)), '[]'::jsonb)
      from (
        select c.relname, pg_total_relation_size(c.oid) as total_bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc
        limit 10
      ) t
    ),
    (
      select coalesce(jsonb_build_object(
        'calls', sum(s.calls), 'exec_ms', round(sum(s.total_exec_time)::numeric, 0), 'rows', sum(s.rows)
      ), '{}'::jsonb)
      from extensions.pg_stat_statements s
      join pg_database d on d.oid = s.dbid and d.datname = current_database()
      join pg_roles r on r.oid = s.userid
      where r.rolname in ('postgres', 'authenticator', 'authenticated', 'anon')
        and s.query !~* '^\s*(begin|commit|set |show |deallocate|select set_config)'
        and s.query !~* 'pg_stat_statements|pg_database_size|admin_usage_'
        and s.query !~* 'pg_auth_members|^\s*select\s+(set_config|current_setting)|pg_timezone_names|pg_catalog\.|information_schema\.|pg_namespace|pg_available_extensions|cron\.job'
    ),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'qid', q.queryid::text, 'q', left(q.query, 140),
        'calls', q.calls, 'ms', round(q.total_exec_time::numeric, 0), 'rows', q.rows
      )), '[]'::jsonb)
      from (
        select s.queryid, s.query, s.calls, s.total_exec_time, s.rows
        from extensions.pg_stat_statements s
        join pg_database d on d.oid = s.dbid and d.datname = current_database()
        join pg_roles r on r.oid = s.userid
        where r.rolname in ('postgres', 'authenticator', 'authenticated', 'anon')
          and s.query !~* '^\s*(begin|commit|set |show |deallocate|select set_config)'
          and s.query !~* 'pg_stat_statements|pg_database_size|admin_usage_'
          and s.query !~* 'pg_auth_members|^\s*select\s+(set_config|current_setting)|pg_timezone_names|pg_catalog\.|information_schema\.|pg_namespace|pg_available_extensions|cron\.job'
        order by s.calls desc
        limit 12
      ) q
    ),
    (select count(distinct v.user_id)::int from public.app_daily_visits v where v.visit_date = v_date)
  on conflict (snap_date) do update set
    db_size_bytes = excluded.db_size_bytes,
    table_sizes   = excluded.table_sizes,
    stmt_totals   = excluded.stmt_totals,
    top_queries   = excluded.top_queries,
    visitors      = excluded.visitors,
    created_at    = now();
end;
$$;

-- 새 필터로 오늘 스냅샷 즉시 재적재 (오탐 제거 반영)
select public.admin_usage_take_snapshot();
