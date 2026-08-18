-- admin_usage_diagnostics() 가 complete 행이 없을 때 500 으로 죽는 문제를 구조적으로 고친다.
--
-- 원인
--   20260817090000 의 함수는 v_prior 를 bare `record` 로 선언하고
--   `if v_complete.usage_date is not null then ... into v_prior ... end if;` 안에서만 할당한다.
--   complete 행이 하나도 없으면 그 SELECT 가 실행되지 않아 v_prior 가 미할당 상태가 되는데,
--   반환문의 jsonb_build_object 에서 v_prior.days 등을 참조한다.
--   PL/pgSQL 은 쿼리를 준비할 때 참조된 변수를 전부 파라미터로 평가하므로
--   `case when v_complete.usage_date is null then null else ... end` 가드가 short-circuit 되지 않고
--   55000 "record \"v_prior\" is not assigned yet" 이 발생한다.
--   (v_prev 는 rowtype public.admin_usage_daily 이라 NULL 로 초기화되어 같은 문제가 없다)
--
-- 수정
--   v_prior record 를 없애고 필요한 값 4개를 초기값 있는 scalar 로 분리한다.
--   데이터가 0건이어도, complete 행이 0건이어도, 통계 reset 이후에도 항상 안전하다.
--   계산식·threshold·JSON shape 는 한 글자도 바꾸지 않는다.
--   (comparison 은 기존 설계대로 complete 행이 없으면 null 이다)
--
-- 이미 적용된 20260817090000 / 20260817223700 / 20260818093000 은 수정하지 않는다.

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
  -- record 대신 초기값을 가진 scalar 를 쓴다. 조건부 SELECT 를 타지 않아도 참조가 안전하다.
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

-- 권한은 원본과 동일하게 다시 고정한다 (CREATE OR REPLACE 는 기존 grant 를 유지하지만 명시한다)
revoke all on function public.admin_usage_diagnostics(int) from public, anon, authenticated;
grant execute on function public.admin_usage_diagnostics(int) to authenticated;
