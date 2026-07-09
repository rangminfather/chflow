-- 주간 방문 집계 개선:
--  1) 주 시작을 ISO 월요일 → 주일(일요일)로 변경 (교회 주간 사이클과 일치)
--  2) 집계 시작 이전의 빈 주는 반환하지 않음 ("0명·기준주 없음" 나열 제거)

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
  v_week date;
begin
  if public.get_user_role() not in ('admin','office','pastor') then
    raise exception '관리자만 조회할 수 있습니다';
  end if;
  -- 이번 주의 일요일 (dow: 일=0)
  v_week := v_today - extract(dow from v_today)::int;
  return query
  with wv as (
    select (d.visit_date - extract(dow from d.visit_date)::int)::date as ws, d.user_id
    from public.app_daily_visits d
    group by 1, 2
  ),
  weeks as (
    select (v_week - (i.n * 7))::date as ws
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
  where w.ws >= coalesce(
    (select min((d2.visit_date - extract(dow from d2.visit_date)::int)::date) from public.app_daily_visits d2),
    v_week
  )
  order by w.ws;
end;
$$;
