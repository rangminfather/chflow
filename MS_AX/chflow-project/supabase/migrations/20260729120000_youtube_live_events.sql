-- 예배 생방송 감지·알림 이벤트 로그 (관리자 확인용)
--
-- 왜 이벤트만 남기나: 폴러는 1분마다 돌지만 매 호출을 기록하면 하루 1,440행이라
-- 무료 플랜에서 의미 없이 쌓인다. 상태가 바뀐 순간·발송·오류만 남기면 주당 수십 행이다.
-- 30일 지난 행은 폴러가 기회가 될 때 정리한다.

create table if not exists public.youtube_live_events (
  id          bigserial primary key,
  event       text        not null,   -- live_started | live_ended | notified | notify_skipped | error
  video_id    text,
  session_key text,                   -- sun_2 | sun_3 | sun_4 | wed_pm | null
  title       text,
  detail      text,
  recipients  integer,
  created_at  timestamptz not null default now()
);

create index if not exists idx_youtube_live_events_created_at
  on public.youtube_live_events(created_at desc);

comment on table  public.youtube_live_events is '예배 생방송 감지·알림 이벤트 로그 (관리자 확인용, 30일 보관)';
comment on column public.youtube_live_events.event      is 'live_started/live_ended/notified/notify_skipped/error';
comment on column public.youtube_live_events.recipients is 'notified 일 때 알림을 받은 사용자 수';

alter table public.youtube_live_events enable row level security;

-- 관리자만 조회 (일반 성도에게 필요한 정보가 아니다)
drop policy if exists "youtube_live_events read for staff" on public.youtube_live_events;
create policy "youtube_live_events read for staff"
  on public.youtube_live_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'office', 'pastor')
    )
  );

-- 쓰기 정책 없음 → service_role(폴러)만 기록한다.

-- Data API 노출 GRANT (_GRANT_TEMPLATE.md 규칙)
grant select on public.youtube_live_events to authenticated;
grant all    on public.youtube_live_events to service_role;
