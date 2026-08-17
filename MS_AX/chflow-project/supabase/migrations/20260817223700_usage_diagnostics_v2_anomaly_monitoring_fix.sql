-- Preserve the anomaly monitors that predate usage diagnostics v2.
-- The already-applied 20260817090000 migration is immutable; this is a forward-only
-- replacement of the anomaly function introduced by that migration.

create or replace function public.admin_usage_check_anomalies()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_date date := (now() at time zone 'Asia/Seoul')::date - 1;
  v_msgs text[] := '{}';
  v_spike boolean := false;
  -- usage diagnostics v2 query-volume spike
  v_cur public.admin_usage_daily;
  v_base record;
  v_prev_calls bigint;
  v_calls_pct numeric;
  v_prev_day_pct numeric;
  v_per_visitor_pct numeric;
  v_calls_txt text;
  v_prev_txt text;
  -- legacy snapshot-based monitors
  v_snap record;
  v_latest public.admin_usage_snapshots;
  v_snap_prev public.admin_usage_snapshots;
  v_week public.admin_usage_snapshots;
  v_title text;
  v_admin uuid;
  rec record;
begin
  -- 1) DB statement volume spike.
  -- Keep these thresholds aligned with lib/usageDiagnostics.ts.
  select * into v_cur from public.admin_usage_daily
  where usage_date = v_date and data_quality = 'complete';

  if found then
    select statement_calls into v_prev_calls
    from public.admin_usage_daily
    where data_quality = 'complete' and usage_date < v_date
    order by usage_date desc limit 1;

    select count(*)::int as days, avg(statement_calls)::numeric as avg_calls,
      case when sum(visitors) > 0 then sum(statement_calls)::numeric / sum(visitors) else null end as weighted_per_visitor
    into v_base
    from (
      select statement_calls, visitors
      from public.admin_usage_daily
      where data_quality = 'complete' and usage_date < v_date
      order by usage_date desc limit 7
    ) p;

    if coalesce(v_base.days, 0) >= 3 then
      v_calls_pct := case when coalesce(v_base.avg_calls, 0) > 0
        then (v_cur.statement_calls::numeric / v_base.avg_calls - 1) * 100 else null end;
      v_prev_day_pct := case when coalesce(v_prev_calls, 0) > 0
        then (v_cur.statement_calls::numeric / v_prev_calls - 1) * 100 else null end;
      v_per_visitor_pct := case
        when coalesce(v_base.weighted_per_visitor, 0) > 0 and v_cur.statements_per_visitor is not null
        then (v_cur.statements_per_visitor / v_base.weighted_per_visitor - 1) * 100
        else null end;

      v_spike := coalesce(v_cur.statement_calls, 0) >= 1000
        and ((v_calls_pct is not null and v_calls_pct >= 100)
          or (v_prev_day_pct is not null and v_prev_day_pct >= 150))
        and coalesce(v_per_visitor_pct, 0) >= 25;

      if v_spike then
        v_calls_txt := case when v_calls_pct is null then 'n/a'
          else (case when v_calls_pct >= 0 then '+' else '' end) || round(v_calls_pct)::text || '%' end;
        v_prev_txt := case when v_prev_day_pct is null then 'n/a'
          else (case when v_prev_day_pct >= 0 then '+' else '' end) || round(v_prev_day_pct)::text || '%' end;
        v_msgs := v_msgs || format(
          'DB statements %s건 (7일 평균 대비 %s · 전일 대비 %s · 방문자당 +%s%%) — 추정 원인 %s (%s)',
          v_cur.statement_calls, v_calls_txt, v_prev_txt,
          round(coalesce(v_per_visitor_pct, 0)),
          coalesce(v_cur.candidate, 'UNKNOWN_QUERY_SPIKE'),
          coalesce(v_cur.confidence, 'low')
        );
      end if;
    end if;
  end if;

  -- 2) Visitor spike and 3) daily DB growth spike.
  -- These retain the legacy snapshot thresholds and remain independent of the
  -- pg_stat_statements baseline quality.
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
      percentile_cont(0.5) within group (order by db_delta) as med_db,
      count(*) as n
    from snaps
    where snap_date < v_date and calls_delta is not null and calls_delta >= 0
  )
  select s.visitors, s.db_delta, s.db_size_bytes,
         b.med_visitors, b.med_db, b.n
  into v_snap
  from snaps s cross join base b
  where s.snap_date = v_date;

  if coalesce(v_snap.n, 0) >= 7 then
    if v_snap.visitors >= 10 and v_snap.visitors > 3 * greatest(v_snap.med_visitors, 1) then
      v_msgs := v_msgs || format('방문자 %s명 (30일 중앙값 %s명의 3배 초과)', v_snap.visitors, round(v_snap.med_visitors));
    end if;
    if v_snap.db_delta is not null and v_snap.db_delta >= 5 * 1024 * 1024
       and v_snap.db_delta > 3 * greatest(v_snap.med_db, 1024 * 1024) then
      v_msgs := v_msgs || format('DB 하루 증가 %sMB (30일 중앙값의 3배 초과)', round(v_snap.db_delta / 1048576.0, 1));
    end if;
  end if;

  select * into v_latest from public.admin_usage_snapshots where snap_date = v_date;
  if v_latest.snap_date is not null then
    -- 4) Row-heavy query: more than 500 added calls and 50 rows per call.
    select * into v_snap_prev from public.admin_usage_snapshots
    where snap_date < v_date order by snap_date desc limit 1;
    if v_snap_prev.snap_date is not null then
      for rec in
        select l->>'q' as q,
               (l->>'calls')::bigint - coalesce((p->>'calls')::bigint, 0) as cd,
               (l->>'rows')::bigint - coalesce((p->>'rows')::bigint, 0) as rd
        from jsonb_array_elements(v_latest.top_queries) l
        left join jsonb_array_elements(coalesce(v_snap_prev.top_queries, '[]'::jsonb)) p
          on p->>'qid' = l->>'qid'
        where (l->>'calls')::bigint - coalesce((p->>'calls')::bigint, 0) > 500
          and ((l->>'rows')::bigint - coalesce((p->>'rows')::bigint, 0))
              / greatest((l->>'calls')::bigint - coalesce((p->>'calls')::bigint, 0), 1) > 50
        order by 2 desc
        limit 2
      loop
        v_msgs := v_msgs || format('행 과다 쿼리 +%s회 (%s…) — 인덱스·limit 확인 필요', rec.cd, left(rec.q, 50));
      end loop;
    end if;

    -- 5) Table growth above 20 MB in a week.
    select * into v_week from public.admin_usage_snapshots
    where snap_date <= v_date - 7 order by snap_date desc limit 1;
    if v_week.snap_date is not null then
      for rec in
        select l->>'name' as name,
               (l->>'bytes')::bigint - coalesce((p->>'bytes')::bigint, 0) as bd
        from jsonb_array_elements(v_latest.table_sizes) l
        left join jsonb_array_elements(coalesce(v_week.table_sizes, '[]'::jsonb)) p
          on p->>'name' = l->>'name'
        where (l->>'bytes')::bigint - coalesce((p->>'bytes')::bigint, 0) > 20 * 1024 * 1024
        order by 2 desc
        limit 2
      loop
        v_msgs := v_msgs || format('%s 테이블 주간 +%sMB — 로그성 적재·보존기간 확인 필요', rec.name, round(rec.bd / 1048576.0, 1));
      end loop;
    end if;
  end if;

  -- Keep the v2 daily notification dedupe.
  if array_length(v_msgs, 1) is null or exists (
    select 1 from public.notifications
    where type = 'usage_anomaly' and created_at > now() - interval '1 day'
  ) then return; end if;

  v_title := case when v_spike then 'DB 호출량 증가 감지' else '리소스 사용 이상 감지' end;

  for v_admin in
    select id from public.profiles where role in ('admin', 'office', 'pastor') and status = 'active'
  loop
    insert into public.notifications (user_id, type, title, body, link_url)
    values (
      v_admin,
      'usage_anomaly',
      v_title,
      format('%s 기준: ', to_char(v_date, 'MM/DD')) || array_to_string(v_msgs, ' · '),
      '/admin/usage-status'
    );
  end loop;
end;
$$;

revoke all on function public.admin_usage_check_anomalies() from public, anon, authenticated;
