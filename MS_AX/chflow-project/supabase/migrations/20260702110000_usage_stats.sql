create table if not exists public.app_daily_visits (
  visit_date    date not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  primary key (visit_date, user_id)
);
create index if not exists idx_app_daily_visits_date on public.app_daily_visits(visit_date);
alter table public.app_daily_visits enable row level security;
-- 정책 없음: RPC(security definer)로만 접근

-- ─────────────────────────────────────────
-- 방문 기록: 로그인 사용자가 하루 1회 기록 (KST 기준). 홈 진입 시 fire-and-forget.
-- ─────────────────────────────────────────
create or replace function public.log_daily_visit()
returns void
language sql security definer set search_path = public as $$
  insert into public.app_daily_visits (visit_date, user_id)
  select (now() at time zone 'Asia/Seoul')::date, auth.uid()
  where auth.uid() is not null
  on conflict do nothing;
$$;
grant execute on function public.log_daily_visit() to authenticated;

-- ─────────────────────────────────────────
-- 관리자 요약: 오늘/최근7일/최근30일 고유 방문자 + 집계 시작일
-- ─────────────────────────────────────────
create or replace function public.admin_usage_summary()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if public.get_user_role() <> 'admin' then
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
grant execute on function public.admin_usage_summary() to authenticated;

-- ─────────────────────────────────────────
-- 관리자: 최근 N일 일자별 방문자 수 (빈 날은 0)
-- ─────────────────────────────────────────
create or replace function public.admin_usage_visits(p_days int default 30)
returns table (visit_date date, visitors int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_days int := least(greatest(coalesce(p_days, 30), 1), 366);
begin
  if public.get_user_role() <> 'admin' then
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
grant execute on function public.admin_usage_visits(int) to authenticated;

-- ─────────────────────────────────────────
-- 관리자: 부서별 활동량 (해당 연·월, KST) — 추가 수집 없이 기존 테이블 집계
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
  if public.get_user_role() <> 'admin' then
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
grant execute on function public.admin_usage_dept_activity(int, int) to authenticated;
