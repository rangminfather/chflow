-- pg_stat_statements entry 축출 때문에 하루치 query 통계를 통째로 버리던 문제를 고친다.
--
-- 배경 (2026-08-18 실측)
--   dealloc 12 → 13, baseline 2440 → 2342(-98) 로 항목이 축출되자
--   data_quality = 'stats_evicted' 가 되어 statement_calls = null,
--   admin_usage_query_daily 0건으로 24시간 데이터가 전부 폐기됐다.
--   축출은 최저빈도 항목부터 일어나는데, 그 때문에 살아남은 고빈도 폴링 query 통계까지 버려졌다.
--
-- 개선
--   1) 축출을 dealloc 카운터와 baseline 키 소실로 감지한다.
--      counter regression 은 선택적 reset과 구분할 수 없으므로 기존처럼 reset_detected 로 둔다.
--   2) 새 상태 partial_evicted 를 둔다. 안전하게 delta 를 낼 수 있는 query 만 저장한다.
--   3) 전역 stats_reset(A) 과 interval 오류(D) 는 기존대로 무효 처리한다.
--   4) QUERY_SPIKE / ops_usage_anomaly 는 계속 complete 에서만 판정한다.
--      admin_usage_check_anomalies() 는 이미 data_quality='complete' 로 조회하므로 손대지 않는다.
--
-- 이미 적용된 20260817090000 / 20260817223700 / 20260818093000 / 20260818220000 은 수정하지 않는다.
-- 기존 2026-08-18 stats_evicted 행도 재구성하지 않는다. 새 로직은 다음 수집부터 적용된다.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) 스키마: partial_evicted 허용 + 품질 메타데이터
-- ─────────────────────────────────────────────────────────────────────────
alter table public.admin_usage_daily
  drop constraint admin_usage_daily_data_quality_check,
  add constraint admin_usage_daily_data_quality_check check (data_quality in (
    'baseline_pending', 'complete', 'partial_evicted',
    -- stats_evicted 는 이번 개선 전에 기록된 값이다. 기존 행 호환을 위해 남긴다.
    'stats_evicted', 'reset_detected', 'interval_misaligned'
  ));

-- query_daily 는 지금까지 complete 만 담았다. partial 도 담을 수 있게 넓힌다.
alter table public.admin_usage_query_daily
  drop constraint admin_usage_query_daily_data_quality_check,
  add constraint admin_usage_query_daily_data_quality_check
  check (data_quality in ('complete', 'partial_evicted'));

-- 부분 통계의 신뢰 범위를 숫자로 남긴다 (컬럼 3개만 추가한다)
alter table public.admin_usage_daily
  add column if not exists dealloc_delta bigint,
  add column if not exists tracked_query_count int,
  add column if not exists excluded_query_count int;

comment on column public.admin_usage_daily.dealloc_delta is
  'pg_stat_statements_info.dealloc 증가량. 0 이면 축출 없음, null 이면 dealloc 관측 불가.';
comment on column public.admin_usage_daily.tracked_query_count is
  '안전하게 delta 를 계산해 admin_usage_query_daily 에 저장한 query 수.';
comment on column public.admin_usage_daily.excluded_query_count is
  'baseline 에 있었지만 소실·역행으로 제외한 query 수. partial_evicted 또는 reset_detected 의 누락 규모.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2) 수집기: 축출을 견디고 부분 통계를 보존한다
-- ─────────────────────────────────────────────────────────────────────────
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
  v_dealloc_delta bigint;
  v_ready boolean;
  v_quality text;
  v_regressed boolean := false;
  v_missing boolean := false;
  v_excluded_count int := 0;
  v_new_excluded_count int := 0;
  v_tracked_count int := 0;
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

  v_dealloc_delta := case
    when v_dealloc is null or v_prev_dealloc is null then null
    else v_dealloc - v_prev_dealloc
  end;

  -- 축출의 "실제 효과"를 본다. dealloc 관측이 불가한 환경에서도 동작한다.
  --   역행: 축출 후 재실행되어 cumulative 가 0 부터 다시 쌓인 경우 (또는 개별 reset)
  --   소실: 축출되고 재실행되지 않아 현재 통계에서 사라진 경우
  select exists (
    select 1
    from public.admin_usage_current_query_stats() c
    join public.admin_usage_query_baselines b using (query_key)
    where c.cumulative_calls < b.cumulative_calls
       or c.cumulative_rows < b.cumulative_rows
       or c.cumulative_exec_time_ms < b.cumulative_exec_time_ms
  ) into v_regressed;

  -- baseline 에 있었지만 지금 안전하게 쓸 수 없는 key 수 (소실 + 역행)
  select count(*)::int into v_excluded_count
  from public.admin_usage_query_baselines b
  where not exists (
    select 1 from public.admin_usage_current_query_stats() c
    where c.query_key = b.query_key
      and c.cumulative_calls >= b.cumulative_calls
      and c.cumulative_rows >= b.cumulative_rows
      and c.cumulative_exec_time_ms >= b.cumulative_exec_time_ms
  );
  v_missing := v_excluded_count > 0;

  if not v_ready then
    v_quality := 'baseline_pending';
  elsif v_prev_reset is distinct from v_reset and (v_prev_reset is not null or v_reset is not null) then
    -- A) 전역 stats_reset. 모든 baseline 이 무의미해지므로 기존대로 무효 처리한다.
    v_quality := 'reset_detected';
  elsif v_regressed then
    -- 개별 counter 감소는 축출 후 재생성인지 선택적 reset인지 구분할 수 없다.
    -- 요청된 fail-closed 정책에 따라 interval 전체 delta 를 사용하지 않는다.
    v_quality := 'reset_detected';
  elsif v_start is null
     or (v_start at time zone 'Asia/Seoul')::date <> v_date
     or (v_now at time zone 'Asia/Seoul')::date <> v_date + 1
     or extract(epoch from (v_now - v_start)) not between 82800 and 90000 then
    -- D) 수집 간격 오류. 델타 자체를 신뢰할 수 없다.
    v_quality := 'interval_misaligned';
  elsif coalesce(v_dealloc_delta, 0) <> 0 or v_missing then
    -- C) 축출. 양쪽 snapshot 에서 안전하게 추적되는 query 만으로 부분 통계를 만든다.
    v_quality := 'partial_evicted';
  else
    v_quality := 'complete';
  end if;

  -- A new entry is a valid full-interval delta when no eviction occurred, so it must not
  -- make an otherwise complete interval partial. Once the interval is already partial,
  -- however, a baseline-less entry cannot be distinguished from an evicted/reintroduced
  -- lifetime counter and is therefore included in the excluded-query metadata.
  if v_quality = 'partial_evicted' then
    select count(*)::int into v_new_excluded_count
    from public.admin_usage_current_query_stats() c
    where not exists (
      select 1 from public.admin_usage_query_baselines b
      where b.query_key = c.query_key
    );
    v_excluded_count := v_excluded_count + v_new_excluded_count;
  end if;

  select d.db_size_bytes into v_db_previous
  from public.admin_usage_daily d
  where d.usage_date < v_date
  order by d.usage_date desc
  limit 1;

  insert into public.admin_usage_daily (
    usage_date, interval_started_at, interval_ended_at, data_quality, stats_reset,
    visitors, db_size_bytes, db_growth_bytes, dealloc_delta, excluded_query_count
  ) values (
    v_date, v_start, v_now, v_quality, v_reset,
    (select count(distinct user_id)::int from public.app_daily_visits where visit_date = v_date),
    v_db_size,
    case when v_db_previous is null then null else v_db_size - v_db_previous end,
    v_dealloc_delta,
    case when v_quality in ('complete', 'partial_evicted') then v_excluded_count else null end
  );

  if v_quality in ('complete', 'partial_evicted') then
    insert into public.admin_usage_query_daily (
      usage_date, query_key, queryid, normalized_query, identifier, display_name,
      category, calls_delta, rows_delta, exec_time_delta_ms, cause_candidate,
      confidence_basis, data_quality, interval_started_at, interval_ended_at
    )
    select v_date, c.query_key, c.queryid, c.normalized_query,
      m.meta->>'identifier', m.meta->>'display_name', m.meta->>'category',
      case when b.query_key is null then c.cumulative_calls else c.cumulative_calls - b.cumulative_calls end,
      case when b.query_key is null then c.cumulative_rows else c.cumulative_rows - b.cumulative_rows end,
      case when b.query_key is null then c.cumulative_exec_time_ms else c.cumulative_exec_time_ms - b.cumulative_exec_time_ms end,
      m.meta->>'candidate', m.meta->>'reason', v_quality, v_start, v_now
    from public.admin_usage_current_query_stats() c
    left join public.admin_usage_query_baselines b using (query_key)
    cross join lateral (select public.admin_usage_classify_query(c.normalized_query) as meta) m
    where
      (
        -- complete 는 기존 동작을 그대로 유지한다.
        -- (축출이 없었으므로 baseline 없는 key 는 진짜 신규이고 lifetime cumulative 가 곧 이 구간 기여량이다)
        v_quality = 'complete'
        or (
          -- partial 은 baseline 양쪽에 존재하고 counter 가 정상 증가한 key 만 센다.
          -- baseline 없는 key(신규 또는 축출 후 재생성)는 구간 기여량을 증명할 수 없어 제외한다.
          b.query_key is not null
          and c.cumulative_calls >= b.cumulative_calls
          and c.cumulative_rows >= b.cumulative_rows
          and c.cumulative_exec_time_ms >= b.cumulative_exec_time_ms
        )
      )
      and (case when b.query_key is null then c.cumulative_calls else c.cumulative_calls - b.cumulative_calls end) > 0;

    select count(*)::int into v_tracked_count
    from public.admin_usage_query_daily where usage_date = v_date;

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
        -- partial 의 known share 는 전체 workload 비율이 아니므로 candidate/confidence 를
        -- 확정하지 않는다. TOP query 의 category 만 참고 정보로 제공한다.
        candidate = case
          when v_quality = 'complete'
           and coalesce(v_candidate.calls, 0) * 100.0 / greatest(v_calls, 1) >= 10
            then v_candidate.cause_candidate
          when v_quality = 'complete' then 'UNKNOWN_QUERY_SPIKE'
          else null
        end,
        confidence = case
          when v_quality <> 'complete' then null
          when coalesce(v_candidate.calls, 0) * 100.0 / greatest(v_calls, 1) >= 40 then 'high'
          when coalesce(v_candidate.calls, 0) * 100.0 / greatest(v_calls, 1) >= 25 then 'medium'
          else 'low'
        end,
        candidate_share_pct = case when v_quality = 'complete'
          then round(coalesce(v_candidate.calls, 0) * 100.0 / greatest(v_calls, 1), 2)
          else null end,
        primary_query_key = v_primary.query_key,
        primary_identifier = v_primary.identifier,
        primary_display_name = v_primary.display_name,
        primary_share_pct = v_primary.share_pct,
        tracked_query_count = v_tracked_count,
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

revoke all on function public.admin_usage_collect_daily() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 조회 RPC: partial 에서도 top_queries 를 돌려준다
--    comparison / latest_complete 는 계속 complete 전용이다 (QUERY_SPIKE 판정 보호).
--    top_queries 의 출처를 top_queries_source 로 함께 알려 UI 가 부분 통계임을 표시할 수 있게 한다.
-- ─────────────────────────────────────────────────────────────────────────
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
  -- query delta 가 존재하는 최신 분석일 (complete 또는 partial_evicted).
  -- summary/TOP/source 는 반드시 이 한 날짜를 함께 사용한다.
  v_analyzable public.admin_usage_daily;
  -- record 대신 초기값을 가진 scalar 를 쓴다 (20260818220000 과 같은 이유)
  v_prior_days int := 0;
  v_prior_avg_calls numeric := null;
  v_prior_median_calls numeric := null;
  v_prior_weighted_per_visitor numeric := null;
begin
  if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then
    raise exception using
      errcode = '42501',
      message = 'usage_diagnostics_forbidden';
  end if;

  select * into v_latest from public.admin_usage_daily order by usage_date desc limit 1;
  select * into v_complete from public.admin_usage_daily
    where data_quality = 'complete' order by usage_date desc limit 1;
  select * into v_analyzable from public.admin_usage_daily
    where data_quality in ('complete', 'partial_evicted') order by usage_date desc limit 1;

  if v_complete.usage_date is not null then
    select * into v_prev from public.admin_usage_daily
      where data_quality = 'complete' and usage_date < v_complete.usage_date
      order by usage_date desc limit 1;

    select count(*)::int as days,
      avg(statement_calls)::numeric as avg_calls,
      percentile_cont(0.5) within group (order by statement_calls)::numeric as median_calls,
      case when sum(visitors) > 0 then sum(statement_calls)::numeric / sum(visitors) else null end as weighted_per_visitor
    into v_prior_days, v_prior_avg_calls, v_prior_median_calls, v_prior_weighted_per_visitor
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
    'latest_analysis', case when v_analyzable.usage_date is null then null else to_jsonb(v_analyzable) end,
    'latest_complete', case when v_complete.usage_date is null then null else to_jsonb(v_complete) end,
    'comparison', case when v_complete.usage_date is null then null else jsonb_build_object(
      'previous_date', v_prev.usage_date,
      'previous_calls', v_prev.statement_calls,
      'previous_day_pct', case when coalesce(v_prev.statement_calls, 0) > 0
        then round((v_complete.statement_calls::numeric / v_prev.statement_calls - 1) * 100, 1) else null end,
      'prior_days', coalesce(v_prior_days, 0),
      'prior_7d_avg_calls', round(v_prior_avg_calls, 1),
      'prior_7d_median_calls', round(v_prior_median_calls, 1),
      'vs_7d_avg_pct', case when coalesce(v_prior_avg_calls, 0) > 0
        then round((v_complete.statement_calls::numeric / v_prior_avg_calls - 1) * 100, 1) else null end,
      'prior_7d_weighted_per_visitor', round(v_prior_weighted_per_visitor, 2),
      'per_visitor_vs_7d_pct', case
        when coalesce(v_prior_weighted_per_visitor, 0) > 0 and v_complete.statements_per_visitor is not null
        then round((v_complete.statements_per_visitor / v_prior_weighted_per_visitor - 1) * 100, 1)
        else null end
    ) end,
    'top_queries_source', case when v_analyzable.usage_date is null then null else jsonb_build_object(
      'usage_date', v_analyzable.usage_date,
      'data_quality', v_analyzable.data_quality,
      'tracked_query_count', v_analyzable.tracked_query_count,
      'excluded_query_count', v_analyzable.excluded_query_count,
      'dealloc_delta', v_analyzable.dealloc_delta,
      'known_statement_calls', v_analyzable.statement_calls,
      'known_statement_rows', v_analyzable.statement_rows,
      'known_exec_time_ms', round(v_analyzable.exec_time_ms, 2),
      'lower_bound', v_analyzable.data_quality = 'partial_evicted',
      'share_basis', case when v_analyzable.data_quality = 'partial_evicted'
        then 'known_calls' else 'total_calls' end
    ) end,
    'top_queries', case when v_analyzable.usage_date is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.calls_delta desc), '[]'::jsonb)
      from (
        select query_key, queryid::text as queryid, identifier, display_name, category,
          calls_delta, rows_delta, round(exec_time_delta_ms, 2) as exec_time_delta_ms,
          share_pct, cause_candidate, confidence_basis, normalized_query
        from public.admin_usage_query_daily
        where usage_date = v_analyzable.usage_date
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

revoke all on function public.admin_usage_diagnostics(int) from public, anon, authenticated;
grant execute on function public.admin_usage_diagnostics(int) to authenticated;
