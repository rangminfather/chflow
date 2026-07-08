-- =============================================================
-- 무료플랜 리소스 감시: 일별 스냅샷 + 이상 감지 + 관리자 알림
--  - pg_cron 이 매일 KST 03:45 스냅샷 (DB 안에서만 — 네트워크 egress 0)
--  - 이상 기준: 일 증분 > 최근 30일 중앙값 × 3 (+ 최소 바닥값)
--  - 알림: 기존 notifications 재사용 (admin/office/pastor)
--  - legacy supabase storage avatar_url → /api/storage(R2 프록시) 재작성
-- =============================================================

-- 1) 스냅샷 테이블 (RPC 전용 — RLS 무정책으로 직접 API 접근 차단)
create table if not exists public.admin_usage_snapshots (
  snap_date    date primary key,          -- 대상일 (KST 기준 어제)
  db_size_bytes bigint not null,
  table_sizes  jsonb not null default '[]',  -- top 10 [{name, bytes}]
  stmt_totals  jsonb not null default '{}',  -- 앱 쿼리 누적 {calls, exec_ms, rows}
  top_queries  jsonb not null default '[]',  -- 호출수 top 12 [{qid, q, calls, ms, rows}]
  visitors     int not null default 0,       -- 해당일 방문자 수
  created_at   timestamptz default now()
);
alter table public.admin_usage_snapshots enable row level security;
grant all on public.admin_usage_snapshots to service_role;

-- 2) 스냅샷 적재 (upsert — 재실행 안전)
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

-- 3) 이상 감지 + 관리자 알림
--    증분 > 최근 30일 중앙값 × 3 이고 바닥값 이상일 때만 (표본 7일 미만이면 스킵)
create or replace function public.admin_usage_check_anomalies()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_date date := (now() at time zone 'Asia/Seoul')::date - 1;
  v_msgs text[] := '{}';
  v_db_limit bigint := 500 * 1024 * 1024;
  v_cur record;
  v_admin uuid;
  rec record;
begin
  with snaps as (
    select snap_date, db_size_bytes, visitors,
           coalesce((stmt_totals->>'calls')::bigint, 0) as calls,
           db_size_bytes - lag(db_size_bytes) over (order by snap_date) as db_delta,
           coalesce((stmt_totals->>'calls')::bigint, 0)
             - lag(coalesce((stmt_totals->>'calls')::bigint, 0)) over (order by snap_date) as calls_delta
    from public.admin_usage_snapshots
    where snap_date >= v_date - 31
  ),
  base as (
    select
      percentile_cont(0.5) within group (order by visitors) as med_visitors,
      percentile_cont(0.5) within group (order by calls_delta) as med_calls,
      percentile_cont(0.5) within group (order by db_delta) as med_db,
      count(*) as n
    from snaps
    where snap_date < v_date and calls_delta is not null and calls_delta >= 0
  )
  select s.visitors, s.calls_delta, s.db_delta, s.db_size_bytes,
         b.med_visitors, b.med_calls, b.med_db, b.n
  into v_cur
  from snaps s cross join base b
  where s.snap_date = v_date;

  if not found then return; end if;

  if v_cur.n >= 7 then
    if v_cur.visitors >= 10 and v_cur.visitors > 3 * greatest(v_cur.med_visitors, 1) then
      v_msgs := v_msgs || format('방문자 %s명 (30일 중앙값 %s명의 3배 초과)', v_cur.visitors, round(v_cur.med_visitors));
    end if;
    if v_cur.calls_delta is not null and v_cur.calls_delta >= 2000
       and v_cur.calls_delta > 3 * greatest(v_cur.med_calls, 100) then
      v_msgs := v_msgs || format('DB 쿼리 호출 %s건 (30일 중앙값 %s건의 3배 초과)', v_cur.calls_delta, round(v_cur.med_calls));
    end if;
    if v_cur.db_delta is not null and v_cur.db_delta >= 5 * 1024 * 1024
       and v_cur.db_delta > 3 * greatest(v_cur.med_db, 1024 * 1024) then
      v_msgs := v_msgs || format('DB 하루 증가 %sMB (30일 중앙값의 3배 초과)', round(v_cur.db_delta / 1048576.0, 1));
    end if;
  end if;

  if v_cur.db_size_bytes > v_db_limit * 0.8 then
    v_msgs := v_msgs || format('DB 용량 %s%% — 무료플랜 500MB의 80%% 초과', round(v_cur.db_size_bytes * 100.0 / v_db_limit));
  end if;

  -- 최근 3일 내 같은 유형 알림이 있으면 재발송 안 함
  if array_length(v_msgs, 1) is null or exists (
    select 1 from public.notifications
    where type = 'usage_anomaly' and created_at > now() - interval '3 days'
  ) then
    return;
  end if;

  for v_admin in
    select id from public.profiles where role in ('admin', 'office', 'pastor') and status = 'active'
  loop
    insert into public.notifications (user_id, type, title, body, link_url)
    values (
      v_admin, 'usage_anomaly', '리소스 사용 이상 감지',
      format('%s 기준: ', to_char(v_date, 'MM/DD')) || array_to_string(v_msgs, ' · '),
      '/admin/usage-status'
    );
  end loop;
end;
$$;

-- 4) 일일 잡 (스냅샷 → 이상감지)
create or replace function public.admin_usage_daily_job()
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_usage_take_snapshot();
  perform public.admin_usage_check_anomalies();
end;
$$;

select cron.schedule('usage-daily-snapshot', '45 18 * * *', 'select public.admin_usage_daily_job()');

-- 5) 조회 RPC: 30일 추이 (일별 증분)
create or replace function public.admin_usage_resource_trend(p_days int default 30)
returns table (
  snap_date date,
  db_size_bytes bigint,
  db_delta bigint,
  calls_delta bigint,
  exec_ms_delta numeric,
  visitors int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception '관리자만 조회할 수 있습니다';
  end if;
  return query
  select s.snap_date, s.db_size_bytes,
         s.db_size_bytes - lag(s.db_size_bytes) over (order by s.snap_date) as db_delta,
         coalesce((s.stmt_totals->>'calls')::bigint, 0)
           - lag(coalesce((s.stmt_totals->>'calls')::bigint, 0)) over (order by s.snap_date) as calls_delta,
         coalesce((s.stmt_totals->>'exec_ms')::numeric, 0)
           - lag(coalesce((s.stmt_totals->>'exec_ms')::numeric, 0)) over (order by s.snap_date) as exec_ms_delta,
         s.visitors
  from public.admin_usage_snapshots s
  where s.snap_date >= (now() at time zone 'Asia/Seoul')::date - least(greatest(coalesce(p_days, 30), 7), 90)
  order by s.snap_date;
end;
$$;
grant execute on function public.admin_usage_resource_trend(int) to authenticated;

-- 6) 조회 RPC: 원인 분석 (쿼리 증가 top + 테이블 증가 top)
create or replace function public.admin_usage_growth_report()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_latest public.admin_usage_snapshots;
  v_prev public.admin_usage_snapshots;
  v_week public.admin_usage_snapshots;
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception '관리자만 조회할 수 있습니다';
  end if;

  select * into v_latest from public.admin_usage_snapshots order by snap_date desc limit 1;
  if not found then return jsonb_build_object('query_growth', '[]'::jsonb, 'table_growth', '[]'::jsonb); end if;
  select * into v_prev from public.admin_usage_snapshots where snap_date < v_latest.snap_date order by snap_date desc limit 1;
  select * into v_week from public.admin_usage_snapshots where snap_date <= v_latest.snap_date - 7 order by snap_date desc limit 1;

  return jsonb_build_object(
    'latest_date', v_latest.snap_date,
    'query_growth', (
      select coalesce(jsonb_agg(g order by (g->>'calls_delta')::bigint desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'q', l->>'q',
          'calls_delta', (l->>'calls')::bigint - coalesce((p->>'calls')::bigint, 0),
          'ms_delta', (l->>'ms')::numeric - coalesce((p->>'ms')::numeric, 0),
          'rows_delta', (l->>'rows')::bigint - coalesce((p->>'rows')::bigint, 0)
        ) as g
        from jsonb_array_elements(v_latest.top_queries) l
        left join jsonb_array_elements(coalesce(v_prev.top_queries, '[]'::jsonb)) p
          on p->>'qid' = l->>'qid'
      ) x
      where (g->>'calls_delta')::bigint > 0
      limit 8
    ),
    'table_growth', (
      select coalesce(jsonb_agg(g order by (g->>'bytes_delta')::bigint desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'name', l->>'name',
          'bytes', (l->>'bytes')::bigint,
          'bytes_delta', (l->>'bytes')::bigint - coalesce((p->>'bytes')::bigint, 0)
        ) as g
        from jsonb_array_elements(v_latest.table_sizes) l
        left join jsonb_array_elements(coalesce(v_week.table_sizes, v_prev.table_sizes, '[]'::jsonb)) p
          on p->>'name' = l->>'name'
      ) x
      where (g->>'bytes_delta')::bigint > 0
      limit 6
    )
  );
end;
$$;
grant execute on function public.admin_usage_growth_report() to authenticated;

-- 7) 첫 스냅샷 즉시 적재 (페이지가 빈 화면이 되지 않도록)
select public.admin_usage_take_snapshot();

-- 8) legacy Supabase Storage avatar_url → R2 프록시 경로 재작성
--    (Supabase Storage 는 R2 이전 후 400 — R2 에 동일 파일 존재 확인됨)
update public.profiles
set avatar_url = '/api/storage/' || regexp_replace(split_part(avatar_url, '/storage/v1/object/public/', 2), '\?.*$', '')
where avatar_url like '%supabase.co/storage/v1/object/public/%';
