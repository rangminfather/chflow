-- =============================================================
-- 이상감지 알림 확장 — 행 과다 쿼리 · 테이블 주간 급증도 관리자 알림에 포함
-- (기존: 방문자/쿼리/DB증가 중앙값×3, DB 80%)
-- =============================================================
create or replace function public.admin_usage_check_anomalies()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_date date := (now() at time zone 'Asia/Seoul')::date - 1;
  v_msgs text[] := '{}';
  v_db_limit bigint := 500 * 1024 * 1024;
  v_cur record;
  v_latest public.admin_usage_snapshots;
  v_prev public.admin_usage_snapshots;
  v_week public.admin_usage_snapshots;
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
      v_msgs := v_msgs || format('DB 쿼리 호출 %s건 (30일 중앙값 %s건의 3배 초과) — 폴링·루프 확인 필요', v_cur.calls_delta, round(v_cur.med_calls));
    end if;
    if v_cur.db_delta is not null and v_cur.db_delta >= 5 * 1024 * 1024
       and v_cur.db_delta > 3 * greatest(v_cur.med_db, 1024 * 1024) then
      v_msgs := v_msgs || format('DB 하루 증가 %sMB (30일 중앙값의 3배 초과)', round(v_cur.db_delta / 1048576.0, 1));
    end if;
  end if;

  if v_cur.db_size_bytes > v_db_limit * 0.8 then
    v_msgs := v_msgs || format('DB 용량 %s%% — 무료플랜 500MB의 80%% 초과', round(v_cur.db_size_bytes * 100.0 / v_db_limit));
  end if;

  -- 행 과다 쿼리 (전일 증가분: +500회 이상 & 호출당 50행 초과) — 인덱스·limit 확인 필요
  select * into v_latest from public.admin_usage_snapshots where snap_date = v_date;
  select * into v_prev from public.admin_usage_snapshots where snap_date < v_date order by snap_date desc limit 1;
  if v_prev.snap_date is not null then
    for rec in
      select l->>'q' as q,
             (l->>'calls')::bigint - coalesce((p->>'calls')::bigint, 0) as cd,
             (l->>'rows')::bigint - coalesce((p->>'rows')::bigint, 0) as rd
      from jsonb_array_elements(v_latest.top_queries) l
      left join jsonb_array_elements(coalesce(v_prev.top_queries, '[]'::jsonb)) p
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

  -- 테이블 주간 급증 (+20MB/주) — 로그성 적재·보존기간 확인 필요
  select * into v_week from public.admin_usage_snapshots where snap_date <= v_date - 7 order by snap_date desc limit 1;
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
