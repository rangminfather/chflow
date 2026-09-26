-- 주보 성경봉독 자동 판독의 실행 기록(자가 진단용).
-- 실행마다 총 소요 시간·모델별 응답 시간과 결과·시간 부족으로 미룬 일을 남겨
-- "함수 제한 시간을 늘려야 하는가", "모델이 단종됐는가" 를 기록으로 판단한다.

create table if not exists public.bulletin_scripture_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid references public.bulletins(id) on delete cascade,
  trigger text not null check (trigger in ('cron', 'manual')),
  started_at timestamptz not null default now(),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  budget_ms integer not null default 0 check (budget_ms >= 0),
  render_ms integer,
  models jsonb not null default '[]'::jsonb,
  result_status text not null check (result_status in ('retry', 'done', 'review', 'failed', 'deferred')),
  time_limited boolean not null default false,
  note text
);

create index if not exists bulletin_scripture_extraction_runs_started_idx
  on public.bulletin_scripture_extraction_runs (started_at desc);

alter table public.bulletin_scripture_extraction_runs enable row level security;

create policy "bulletin scripture extraction runs staff read"
  on public.bulletin_scripture_extraction_runs for select to authenticated
  using (public.get_user_role() in ('admin', 'office', 'pastor'));

-- 쓰기는 서버(service_role)만 한다.
grant select on table public.bulletin_scripture_extraction_runs to authenticated;
grant all on table public.bulletin_scripture_extraction_runs to service_role;
