-- Usage diagnostics v2
-- - 기존 admin_usage_snapshots와 데이터는 그대로 보존한다.
-- - pg_stat_statements 누적값을 KST 일일 baseline 간 delta로 변환한다.
-- - 최초 수집/통계 reset/수집 간격 불일치는 호출량으로 오인하지 않는다.

create table if not exists public.admin_usage_collection_state (
  singleton boolean primary key default true check (singleton),
  last_captured_at timestamptz,
  last_stats_reset timestamptz,
  last_dealloc bigint,
  ready_for_daily boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_usage_query_baselines (
  query_key text primary key,
  queryid bigint,
  normalized_query text not null,
  identifier text not null,
  display_name text not null,
  category text not null,
  cause_candidate text not null,
  classification_reason text not null,
  cumulative_calls bigint not null check (cumulative_calls >= 0),
  cumulative_rows bigint not null check (cumulative_rows >= 0),
  cumulative_exec_time_ms numeric not null check (cumulative_exec_time_ms >= 0),
  stats_reset timestamptz,
  captured_at timestamptz not null
);

create table if not exists public.admin_usage_daily (
  usage_date date primary key,
  interval_started_at timestamptz,
  interval_ended_at timestamptz not null,
  data_quality text not null check (data_quality in (
    'baseline_pending', 'complete', 'reset_detected', 'stats_evicted', 'interval_misaligned'
  )),
  stats_reset timestamptz,
  visitors integer not null default 0 check (visitors >= 0),
  statement_calls bigint check (statement_calls >= 0),
  statement_rows bigint check (statement_rows >= 0),
  exec_time_ms numeric check (exec_time_ms >= 0),
  statements_per_visitor numeric,
  db_size_bytes bigint not null check (db_size_bytes >= 0),
  db_growth_bytes bigint,
  candidate text,
  confidence text check (confidence is null or confidence in ('high', 'medium', 'low')),
  candidate_share_pct numeric,
  primary_query_key text,
  primary_identifier text,
  primary_display_name text,
  primary_share_pct numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_usage_query_daily (
  usage_date date not null references public.admin_usage_daily(usage_date) on delete cascade,
  query_key text not null,
  queryid bigint,
  normalized_query text not null,
  identifier text not null,
  display_name text not null,
  category text not null,
  calls_delta bigint not null check (calls_delta >= 0),
  rows_delta bigint not null check (rows_delta >= 0),
  exec_time_delta_ms numeric not null check (exec_time_delta_ms >= 0),
  share_pct numeric not null default 0 check (share_pct >= 0),
  cause_candidate text not null,
  confidence_basis text not null,
  data_quality text not null default 'complete' check (data_quality = 'complete'),
  interval_started_at timestamptz not null,
  interval_ended_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (usage_date, query_key)
);

create index if not exists admin_usage_query_daily_calls_idx
  on public.admin_usage_query_daily (usage_date, calls_delta desc);
create index if not exists admin_usage_daily_quality_date_idx
  on public.admin_usage_daily (data_quality, usage_date desc);

alter table public.admin_usage_collection_state enable row level security;
alter table public.admin_usage_query_baselines enable row level security;
alter table public.admin_usage_daily enable row level security;
alter table public.admin_usage_query_daily enable row level security;

revoke all on public.admin_usage_collection_state from public, anon, authenticated;
revoke all on public.admin_usage_query_baselines from public, anon, authenticated;
revoke all on public.admin_usage_daily from public, anon, authenticated;
revoke all on public.admin_usage_query_daily from public, anon, authenticated;
grant all on public.admin_usage_collection_state to service_role;
grant all on public.admin_usage_query_baselines to service_role;
grant all on public.admin_usage_daily to service_role;
grant all on public.admin_usage_query_daily to service_role;

create or replace function public.admin_usage_classify_query(p_query text)
returns jsonb
language sql immutable
set search_path = public
as $$
  with q as (select lower(coalesce(p_query, '')) as value)
  select case
    when value like '%get_unread_count%' then jsonb_build_object(
      'identifier', 'get_unread_count', 'display_name', '알림 미읽음 수',
      'category', 'notification', 'candidate', 'NOTIFICATION_POLLING',
      'reason', 'notification unread RPC matched')
    when value like '%get_my_notifications%' then jsonb_build_object(
      'identifier', 'get_my_notifications', 'display_name', '알림 목록',
      'category', 'notification', 'candidate', 'NOTIFICATION_POLLING',
      'reason', 'notification list RPC matched')
    when value like '%get_my_notification_preferences%' then jsonb_build_object(
      'identifier', 'get_my_notification_preferences', 'display_name', '알림 설정',
      'category', 'notification', 'candidate', 'NOTIFICATION_POLLING',
      'reason', 'notification preferences RPC matched')
    when value like '%current_member_id%' then jsonb_build_object(
      'identifier', 'current_member_id', 'display_name', '회원 식별',
      'category', 'attendance', 'candidate', 'ATTENDANCE_POLLING',
      'reason', 'member lookup used by attendance status matched')
    when value like '%attendance_location_candidates%' then jsonb_build_object(
      'identifier', 'attendance_location_candidates', 'display_name', '자동출석 후보 상태',
      'category', 'attendance', 'candidate', 'ATTENDANCE_POLLING',
      'reason', 'attendance candidate table matched')
    when value like '%church_attendance%' or value like '%attendance-status%' then jsonb_build_object(
      'identifier', 'church_attendance', 'display_name', '자동출석 상태',
      'category', 'attendance', 'candidate', 'ATTENDANCE_POLLING',
      'reason', 'attendance status query matched')
    when value like '%youtube_live_status%' or value like '%youtube_live_events%' then jsonb_build_object(
      'identifier', 'youtube_live_status', 'display_name', 'Live 상태',
      'category', 'live', 'candidate', 'LIVE_POLLING',
      'reason', 'live status table matched')
    when value like '%net._http_response%' or value like '%net.http_%' then jsonb_build_object(
      'identifier', 'push_webhook_response', 'display_name', 'Push/Webhook HTTP',
      'category', 'push_webhook', 'candidate', 'UNKNOWN_QUERY_SPIKE',
      'reason', 'pg_net response query matched')
    when value like '% as ok%' or value ~ '^\s*select\s+[$][0-9]+\s*$' then jsonb_build_object(
      'identifier', 'health_probe', 'display_name', 'Health / Probe',
      'category', 'health', 'candidate', 'UNKNOWN_QUERY_SPIKE',
      'reason', 'health probe pattern matched')
    else jsonb_build_object(
      'identifier', 'sql_' || substr(md5(coalesce(p_query, '')), 1, 12),
      'display_name', '기타 SQL', 'category', 'other',
      'candidate', 'UNKNOWN_QUERY_SPIKE', 'reason', 'no known query group matched')
  end
  from q;
$$;

create or replace function public.admin_usage_pgss_reset_at()
returns timestamptz
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_reset timestamptz;
begin
  begin
    execute 'select stats_reset from extensions.pg_stat_statements_info' into v_reset;
  exception when undefined_table or undefined_column then
    v_reset := null;
  end;
  return v_reset;
end;
$$;

create or replace function public.admin_usage_pgss_dealloc()
returns bigint
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_dealloc bigint;
begin
  begin
    execute 'select dealloc from extensions.pg_stat_statements_info' into v_dealloc;
  exception when undefined_table or undefined_column then
    v_dealloc := null;
  end;
  return v_dealloc;
end;
$$;

create or replace function public.admin_usage_current_query_stats()
returns table (
  query_key text,
  queryid bigint,
  normalized_query text,
  cumulative_calls bigint,
  cumulative_rows bigint,
  cumulative_exec_time_ms numeric
)
language sql stable security definer
set search_path = public, extensions
as $$
  select
    s.queryid::text || ':' || substr(md5(s.query), 1, 12) as query_key,
    s.queryid,
    s.query as normalized_query,
    sum(s.calls)::bigint as cumulative_calls,
    sum(s.rows)::bigint as cumulative_rows,
    sum(s.total_exec_time)::numeric as cumulative_exec_time_ms
  from extensions.pg_stat_statements s
  join pg_database d on d.oid = s.dbid and d.datname = current_database()
  join pg_roles r on r.oid = s.userid
  where r.rolname in ('postgres', 'authenticator', 'authenticated', 'anon', 'service_role')
    and s.queryid is not null
    and s.query !~* '^\s*(begin|commit|set |show |deallocate|select set_config)'
    and s.query !~* 'pg_stat_statements|pg_database_size|admin_usage_'
    and s.query !~* 'pg_auth_members|^\s*select\s+(set_config|current_setting)|pg_timezone_names|pg_catalog\.|information_schema\.|pg_namespace|pg_available_extensions|cron\.job'
  group by s.queryid, s.query;
$$;

create or replace function public.admin_usage_initialize_query_baseline()
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := now();
  v_reset timestamptz := public.admin_usage_pgss_reset_at();
  v_dealloc bigint := public.admin_usage_pgss_dealloc();
begin
  if exists (
    select 1 from public.admin_usage_collection_state where singleton and last_captured_at is not null
  ) then
    return;
  end if;

  insert into public.admin_usage_query_baselines (
    query_key, queryid, normalized_query, identifier, display_name, category,
    cause_candidate, classification_reason, cumulative_calls, cumulative_rows,
    cumulative_exec_time_ms, stats_reset, captured_at
  )
  select c.query_key, c.queryid, c.normalized_query,
    m.meta->>'identifier', m.meta->>'display_name', m.meta->>'category',
    m.meta->>'candidate', m.meta->>'reason', c.cumulative_calls,
    c.cumulative_rows, c.cumulative_exec_time_ms, v_reset, v_now
  from public.admin_usage_current_query_stats() c
  cross join lateral (select public.admin_usage_classify_query(c.normalized_query) as meta) m
  on conflict (query_key) do update set
    queryid = excluded.queryid,
    normalized_query = excluded.normalized_query,
    identifier = excluded.identifier,
    display_name = excluded.display_name,
    category = excluded.category,
    cause_candidate = excluded.cause_candidate,
    classification_reason = excluded.classification_reason,
    cumulative_calls = excluded.cumulative_calls,
    cumulative_rows = excluded.cumulative_rows,
    cumulative_exec_time_ms = excluded.cumulative_exec_time_ms,
    stats_reset = excluded.stats_reset,
    captured_at = excluded.captured_at;

  insert into public.admin_usage_collection_state (
    singleton, last_captured_at, last_stats_reset, last_dealloc, ready_for_daily, updated_at
  ) values (true, v_now, v_reset, v_dealloc, false, v_now)
  on conflict (singleton) do update set
    last_captured_at = excluded.last_captured_at,
    last_stats_reset = excluded.last_stats_reset,
    last_dealloc = excluded.last_dealloc,
    ready_for_daily = false,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.admin_usage_collect_daily()
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := now();
  v_date date := (now() at time zone 'Asia/Seoul')::date - 1;
  v_start timestamptz;
  v_prev_reset timestamptz;
  v_reset timestamptz := public.admin_usage_pgss_reset_at();
  v_prev_dealloc bigint;
  v_dealloc bigint := public.admin_usage_pgss_dealloc();
  v_ready boolean;
  v_quality text;
  v_regressed boolean := false;
  v_calls bigint;
  v_rows bigint;
  v_exec numeric;
  v_db_size bigint := pg_database_size(current_database());
  v_db_previous bigint;
  v_candidate record;
  v_primary record;
begin
  if exists (select 1 from public.admin_usage_daily where usage_date = v_date) then
    return;
  end if;

  select last_captured_at, last_stats_reset, last_dealloc, ready_for_daily
    into v_start, v_prev_reset, v_prev_dealloc, v_ready
  from public.admin_usage_collection_state
  where singleton
  for update;

  if not found then
    perform public.admin_usage_initialize_query_baseline();
    return;
  end if;

  select exists (
    select 1
    from public.admin_usage_current_query_stats() c
    join public.admin_usage_query_baselines b using (query_key)
    where c.cumulative_calls < b.cumulative_calls
       or c.cumulative_rows < b.cumulative_rows
       or c.cumulative_exec_time_ms < b.cumulative_exec_time_ms
  ) into v_regressed;

  if not v_ready then
    v_quality := 'baseline_pending';
  elsif v_prev_reset is distinct from v_reset and (v_prev_reset is not null or v_reset is not null) then
    v_quality := 'reset_detected';
  elsif v_regressed then
    v_quality := 'reset_detected';
  elsif v_prev_dealloc is distinct from v_dealloc and (v_prev_dealloc is not null or v_dealloc is not null) then
    v_quality := 'stats_evicted';
  elsif v_start is null
     or (v_start at time zone 'Asia/Seoul')::date <> v_date
     or (v_now at time zone 'Asia/Seoul')::date <> v_date + 1
     or extract(epoch from (v_now - v_start)) not between 82800 and 90000 then
    v_quality := 'interval_misaligned';
  else
    v_quality := 'complete';
  end if;

  select d.db_size_bytes into v_db_previous
  from public.admin_usage_daily d
  where d.usage_date < v_date
  order by d.usage_date desc
  limit 1;

  insert into public.admin_usage_daily (
    usage_date, interval_started_at, interval_ended_at, data_quality, stats_reset,
    visitors, db_size_bytes, db_growth_bytes
  ) values (
    v_date, v_start, v_now, v_quality, v_reset,
    (select count(distinct user_id)::int from public.app_daily_visits where visit_date = v_date),
    v_db_size,
    case when v_db_previous is null then null else v_db_size - v_db_previous end
  );

  if v_quality = 'complete' then
    insert into public.admin_usage_query_daily (
      usage_date, query_key, queryid, normalized_query, identifier, display_name,
      category, calls_delta, rows_delta, exec_time_delta_ms, cause_candidate,
      confidence_basis, interval_started_at, interval_ended_at
    )
    select v_date, c.query_key, c.queryid, c.normalized_query,
      m.meta->>'identifier', m.meta->>'display_name', m.meta->>'category',
      case when b.query_key is null then c.cumulative_calls else c.cumulative_calls - b.cumulative_calls end,
      case when b.query_key is null then c.cumulative_rows else c.cumulative_rows - b.cumulative_rows end,
      case when b.query_key is null then c.cumulative_exec_time_ms else c.cumulative_exec_time_ms - b.cumulative_exec_time_ms end,
      m.meta->>'candidate', m.meta->>'reason', v_start, v_now
    from public.admin_usage_current_query_stats() c
    left join public.admin_usage_query_baselines b using (query_key)
    cross join lateral (select public.admin_usage_classify_query(c.normalized_query) as meta) m
    where (case when b.query_key is null then c.cumulative_calls else c.cumulative_calls - b.cumulative_calls end) > 0;

    select coalesce(sum(calls_delta), 0), coalesce(sum(rows_delta), 0),
           coalesce(sum(exec_time_delta_ms), 0)
      into v_calls, v_rows, v_exec
    from public.admin_usage_query_daily
    where usage_date = v_date;

    update public.admin_usage_query_daily
    set share_pct = case when v_calls > 0 then round(calls_delta * 100.0 / v_calls, 2) else 0 end
    where usage_date = v_date;

    select cause_candidate, sum(calls_delta) as calls
      into v_candidate
    from public.admin_usage_query_daily
    where usage_date = v_date and cause_candidate <> 'UNKNOWN_QUERY_SPIKE'
    group by cause_candidate
    order by sum(calls_delta) desc
    limit 1;

    select query_key, identifier, display_name, share_pct
      into v_primary
    from public.admin_usage_query_daily
    where usage_date = v_date
    order by calls_delta desc
    limit 1;

    update public.admin_usage_daily
    set statement_calls = v_calls,
        statement_rows = v_rows,
        exec_time_ms = v_exec,
        statements_per_visitor = case when visitors > 0 then round(v_calls::numeric / visitors, 2) else null end,
        candidate = case
          when coalesce(v_candidate.calls, 0) * 100.0 / greatest(v_calls, 1) >= 10
            then v_candidate.cause_candidate
          else 'UNKNOWN_QUERY_SPIKE'
        end,
        confidence = case
          when coalesce(v_candidate.calls, 0) * 100.0 / greatest(v_calls, 1) >= 40 then 'high'
          when coalesce(v_candidate.calls, 0) * 100.0 / greatest(v_calls, 1) >= 25 then 'medium'
          else 'low'
        end,
        candidate_share_pct = round(coalesce(v_candidate.calls, 0) * 100.0 / greatest(v_calls, 1), 2),
        primary_query_key = v_primary.query_key,
        primary_identifier = v_primary.identifier,
        primary_display_name = v_primary.display_name,
        primary_share_pct = v_primary.share_pct,
        updated_at = now()
    where usage_date = v_date;
  end if;

  insert into public.admin_usage_query_baselines (
    query_key, queryid, normalized_query, identifier, display_name, category,
    cause_candidate, classification_reason, cumulative_calls, cumulative_rows,
    cumulative_exec_time_ms, stats_reset, captured_at
  )
  select c.query_key, c.queryid, c.normalized_query,
    m.meta->>'identifier', m.meta->>'display_name', m.meta->>'category',
    m.meta->>'candidate', m.meta->>'reason', c.cumulative_calls,
    c.cumulative_rows, c.cumulative_exec_time_ms, v_reset, v_now
  from public.admin_usage_current_query_stats() c
  cross join lateral (select public.admin_usage_classify_query(c.normalized_query) as meta) m
  on conflict (query_key) do update set
    queryid = excluded.queryid,
    normalized_query = excluded.normalized_query,
    identifier = excluded.identifier,
    display_name = excluded.display_name,
    category = excluded.category,
    cause_candidate = excluded.cause_candidate,
    classification_reason = excluded.classification_reason,
    cumulative_calls = excluded.cumulative_calls,
    cumulative_rows = excluded.cumulative_rows,
    cumulative_exec_time_ms = excluded.cumulative_exec_time_ms,
    stats_reset = excluded.stats_reset,
    captured_at = excluded.captured_at;

  delete from public.admin_usage_query_baselines b
  where not exists (
    select 1 from public.admin_usage_current_query_stats() c where c.query_key = b.query_key
  );

  update public.admin_usage_collection_state
  set last_captured_at = v_now,
      last_stats_reset = v_reset,
      last_dealloc = v_dealloc,
      ready_for_daily = true,
      updated_at = v_now
  where singleton;

  delete from public.admin_usage_query_daily where usage_date < v_date - 90;
  delete from public.admin_usage_daily where usage_date < v_date - 366;
end;
$$;

create or replace function public.admin_usage_diagnostics(p_days int default 30)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 7), 30);
  v_latest public.admin_usage_daily;
  v_complete public.admin_usage_daily;
  v_prev public.admin_usage_daily;
  v_prior record;
begin
  if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then
    raise exception using
      errcode = '42501',
      message = 'usage_diagnostics_forbidden';
  end if;

  select * into v_latest from public.admin_usage_daily order by usage_date desc limit 1;
  select * into v_complete from public.admin_usage_daily
    where data_quality = 'complete' order by usage_date desc limit 1;

  if v_complete.usage_date is not null then
    select * into v_prev from public.admin_usage_daily
      where data_quality = 'complete' and usage_date < v_complete.usage_date
      order by usage_date desc limit 1;

    select count(*)::int as days,
      avg(statement_calls)::numeric as avg_calls,
      percentile_cont(0.5) within group (order by statement_calls)::numeric as median_calls,
      case when sum(visitors) > 0 then sum(statement_calls)::numeric / sum(visitors) else null end as weighted_per_visitor
    into v_prior
    from (
      select statement_calls, visitors
      from public.admin_usage_daily
      where data_quality = 'complete' and usage_date < v_complete.usage_date
      order by usage_date desc
      limit 7
    ) p;
  end if;

  return jsonb_build_object(
    'latest_collection', case when v_latest.usage_date is null then null else to_jsonb(v_latest) end,
    'latest_complete', case when v_complete.usage_date is null then null else to_jsonb(v_complete) end,
    'comparison', case when v_complete.usage_date is null then null else jsonb_build_object(
      'previous_date', v_prev.usage_date,
      'previous_calls', v_prev.statement_calls,
      'previous_day_pct', case when coalesce(v_prev.statement_calls, 0) > 0
        then round((v_complete.statement_calls::numeric / v_prev.statement_calls - 1) * 100, 1) else null end,
      'prior_days', coalesce(v_prior.days, 0),
      'prior_7d_avg_calls', round(v_prior.avg_calls, 1),
      'prior_7d_median_calls', round(v_prior.median_calls, 1),
      'vs_7d_avg_pct', case when coalesce(v_prior.avg_calls, 0) > 0
        then round((v_complete.statement_calls::numeric / v_prior.avg_calls - 1) * 100, 1) else null end,
      'prior_7d_weighted_per_visitor', round(v_prior.weighted_per_visitor, 2),
      'per_visitor_vs_7d_pct', case
        when coalesce(v_prior.weighted_per_visitor, 0) > 0 and v_complete.statements_per_visitor is not null
        then round((v_complete.statements_per_visitor / v_prior.weighted_per_visitor - 1) * 100, 1)
        else null end
    ) end,
    'top_queries', case when v_complete.usage_date is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.calls_delta desc), '[]'::jsonb)
      from (
        select query_key, queryid::text as queryid, identifier, display_name, category,
          calls_delta, rows_delta, round(exec_time_delta_ms, 2) as exec_time_delta_ms,
          share_pct, cause_candidate, confidence_basis, normalized_query
        from public.admin_usage_query_daily
        where usage_date = v_complete.usage_date
        order by calls_delta desc
        limit 10
      ) q
    ) end,
    'trend', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.usage_date), '[]'::jsonb)
      from (
        select usage_date, data_quality, visitors, statement_calls, statements_per_visitor,
          round(exec_time_ms, 2) as exec_time_ms, db_size_bytes, db_growth_bytes,
          candidate, confidence, candidate_share_pct
        from public.admin_usage_daily
        order by usage_date desc
        limit v_days
      ) t
    ),
    'db_connections', jsonb_build_object(
      'current', (select count(*) from pg_stat_activity where datname = current_database()),
      'active', (select count(*) from pg_stat_activity where datname = current_database() and state = 'active'),
      'max_configured', current_setting('max_connections')::int,
      'scope', 'direct PostgreSQL sessions visible to pg_stat_activity; Supavisor client totals excluded'
    ),
    'collection', (
      select to_jsonb(s) from public.admin_usage_collection_state s where singleton
    )
  );
end;
$$;

create or replace function public.admin_usage_check_anomalies()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_date date := (now() at time zone 'Asia/Seoul')::date - 1;
  v_cur public.admin_usage_daily;
  v_base record;
  v_calls_pct numeric;
  v_per_visitor_pct numeric;
  v_admin uuid;
begin
  select * into v_cur from public.admin_usage_daily
  where usage_date = v_date and data_quality = 'complete';
  if not found then return; end if;

  select count(*)::int as days, avg(statement_calls)::numeric as avg_calls,
    case when sum(visitors) > 0 then sum(statement_calls)::numeric / sum(visitors) else null end as weighted_per_visitor
  into v_base
  from (
    select statement_calls, visitors
    from public.admin_usage_daily
    where data_quality = 'complete' and usage_date < v_date
    order by usage_date desc limit 7
  ) p;

  if coalesce(v_base.days, 0) < 3 or coalesce(v_base.avg_calls, 0) <= 0 then return; end if;
  v_calls_pct := (v_cur.statement_calls::numeric / v_base.avg_calls - 1) * 100;
  v_per_visitor_pct := case
    when coalesce(v_base.weighted_per_visitor, 0) > 0 and v_cur.statements_per_visitor is not null
    then (v_cur.statements_per_visitor / v_base.weighted_per_visitor - 1) * 100
    else null end;

  if v_cur.statement_calls < 1000
     or v_calls_pct < 100
     or coalesce(v_per_visitor_pct, 0) < 25 then
    return;
  end if;

  if exists (
    select 1 from public.notifications
    where type = 'usage_anomaly' and created_at > now() - interval '1 day'
  ) then return; end if;

  for v_admin in
    select id from public.profiles where role in ('admin', 'office', 'pastor') and status = 'active'
  loop
    insert into public.notifications (user_id, type, title, body, link_url)
    values (
      v_admin,
      'usage_anomaly',
      'DB 호출량 증가 감지',
      format(
        '%s DB statements %s건 · 7일 기준 대비 +%s%% · 방문자당 +%s%% · 추정 원인 %s (%s)',
        to_char(v_date, 'MM/DD'), v_cur.statement_calls, round(v_calls_pct),
        round(coalesce(v_per_visitor_pct, 0)), coalesce(v_cur.candidate, 'UNKNOWN_QUERY_SPIKE'),
        coalesce(v_cur.confidence, 'low')
      ),
      '/admin/usage-status'
    );
  end loop;
end;
$$;

create or replace function public.admin_usage_daily_job()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  -- legacy snapshot은 기존 화면/데이터 호환을 위해 계속 보존한다.
  perform public.admin_usage_take_snapshot();
  perform public.admin_usage_collect_daily();
  perform public.admin_usage_check_anomalies();
end;
$$;

revoke all on function public.admin_usage_classify_query(text) from public, anon, authenticated;
revoke all on function public.admin_usage_pgss_reset_at() from public, anon, authenticated;
revoke all on function public.admin_usage_pgss_dealloc() from public, anon, authenticated;
revoke all on function public.admin_usage_current_query_stats() from public, anon, authenticated;
revoke all on function public.admin_usage_initialize_query_baseline() from public, anon, authenticated;
revoke all on function public.admin_usage_collect_daily() from public, anon, authenticated;
revoke all on function public.admin_usage_check_anomalies() from public, anon, authenticated;
revoke all on function public.admin_usage_daily_job() from public, anon, authenticated;
revoke all on function public.admin_usage_diagnostics(int) from public, anon, authenticated;
grant execute on function public.admin_usage_diagnostics(int) to authenticated;

-- 기존 동일 이름 job을 모두 제거한 뒤 하나만 생성한다. 재실행해도 중복되지 않는다.
do $$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'usage-daily-snapshot'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule(
    'usage-daily-snapshot',
    '10 15 * * *',
    'select public.admin_usage_daily_job()'
  );
end;
$$;

-- 누적 lifetime 값을 오늘 호출량으로 쓰지 않고 baseline만 초기화한다.
select public.admin_usage_initialize_query_baseline();
