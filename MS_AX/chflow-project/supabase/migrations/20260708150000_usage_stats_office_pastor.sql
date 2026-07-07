-- 이용현황 조회 권한 확장: admin 단독 → admin·office(행정원)·pastor(목사)
-- 홈 관리자 메뉴 노출 범위(admin/office/pastor)와 페이지·RPC 권한을 일치시킨다.

-- ─────────────────────────────────────────
-- 요약: 오늘/최근7일/최근30일 고유 방문자 + 집계 시작일
-- ─────────────────────────────────────────
create or replace function public.admin_usage_summary()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if public.get_user_role() not in ('admin','office','pastor') then
    raise exception '관리자만 조회할 수 있습니다';
  end if;
  return jsonb_build_object(
    'today',    (select count(*) from public.app_daily_visits where visit_date = v_today),
    'unique7',  (select count(distinct user_id) from public.app_daily_visits where visit_date > v_today - 7),
    'unique30', (select count(distinct user_id) from public.app_daily_visits where visit_date > v_today - 30),
    'since',    (select min(visit_date) from public.app_daily_visits)
  );
end;
$$;

-- ─────────────────────────────────────────
-- 최근 N일 일자별 방문자 수 (빈 날은 0)
-- ─────────────────────────────────────────
create or replace function public.admin_usage_visits(p_days int default 30)
returns table (visit_date date, visitors int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_days int := least(greatest(coalesce(p_days, 30), 1), 366);
begin
  if public.get_user_role() not in ('admin','office','pastor') then
    raise exception '관리자만 조회할 수 있습니다';
  end if;
  return query
  select
    gs::date as visit_date,
    coalesce(v.cnt, 0)::int as visitors
  from generate_series(v_today - (v_days - 1), v_today, interval '1 day') gs
  left join (
    select d.visit_date as vd, count(*)::int as cnt
    from public.app_daily_visits d
    group by d.visit_date
  ) v on v.vd = gs::date
  order by 1;
end;
$$;

-- ─────────────────────────────────────────
-- 주간 방문 · 재방문율
-- ─────────────────────────────────────────
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
  if public.get_user_role() not in ('admin','office','pastor') then
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

-- ─────────────────────────────────────────
-- 무료 플랜 리소스 상태
-- ─────────────────────────────────────────
create or replace function public.admin_db_health()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_user_role() not in ('admin','office','pastor') then
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

-- ─────────────────────────────────────────
-- 부서별 활동량
-- ─────────────────────────────────────────
create or replace function public.admin_usage_dept_activity(p_year int, p_month int)
returns table (
  dept_id uuid,
  dept_name text,
  category text,
  attendance_saves int,
  talent_records int,
  notices int,
  new_friends int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_user_role() not in ('admin','office','pastor') then
    raise exception '관리자만 조회할 수 있습니다';
  end if;
  return query
  select
    d.id as dept_id,
    d.name as dept_name,
    d.category,
    (select count(*)::int from public.edu_student_attendance a
      where a.dept_id = d.id
        and extract(year from a.attend_date) = p_year
        and extract(month from a.attend_date) = p_month) as attendance_saves,
    (
      (select count(*)::int from public.edu_talent_records t
        where t.department_id = d.id
          and extract(year from t.record_date) = p_year
          and extract(month from t.record_date) = p_month)
      + (select count(*)::int from public.edu_weekly_extra w
          where w.department_id = d.id
            and extract(year from w.attend_date) = p_year
            and extract(month from w.attend_date) = p_month)
      + (select count(*)::int from public.edu_quiz_talent q
          where q.department_id = d.id
            and extract(year from q.quiz_date) = p_year
            and extract(month from q.quiz_date) = p_month)
    ) as talent_records,
    (select count(*)::int from public.dept_notices n
      where n.department_id = d.id
        and n.deleted_at is null
        and extract(year from (n.created_at at time zone 'Asia/Seoul')) = p_year
        and extract(month from (n.created_at at time zone 'Asia/Seoul')) = p_month) as notices,
    (select count(*)::int from public.edu_new_friends f
      where f.department_id = d.id
        and extract(year from (f.created_at at time zone 'Asia/Seoul')) = p_year
        and extract(month from (f.created_at at time zone 'Asia/Seoul')) = p_month) as new_friends
  from public.departments d
  order by d.category, d.name;
end;
$$;
