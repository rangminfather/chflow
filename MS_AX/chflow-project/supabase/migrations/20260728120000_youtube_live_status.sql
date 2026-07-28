-- 예배 생방송(YouTube Live) 상태 캐시
--
-- 왜 캐시인가: YouTube Data API 는 일일 쿼터(기본 10,000 유닛)가 있어
-- 사용자가 홈 화면을 열 때마다 조회하면 금방 소진된다. Vercel Cron 이
-- 주기적으로 상태를 갱신해 이 테이블에 넣고, 앱은 이 테이블만 읽는다.
--
-- 쓰기: service_role(cron) 전용. 읽기: 로그인 사용자.

create table if not exists public.youtube_live_status (
  id          text primary key default 'main',
  channel_id  text        not null,
  is_live     boolean     not null default false,
  video_id    text,
  title       text,
  thumbnail_url text,
  started_at  timestamptz,
  checked_at  timestamptz not null default now(),
  last_error  text,
  updated_at  timestamptz not null default now()
);

comment on table  public.youtube_live_status is '예배 생방송 상태 캐시 (cron 갱신, 앱은 읽기만)';
comment on column public.youtube_live_status.is_live    is '현재 라이브 방송 중인지';
comment on column public.youtube_live_status.video_id   is '라이브 중일 때의 YouTube videoId. 종료 시 null';
comment on column public.youtube_live_status.checked_at is '마지막으로 YouTube 를 조회한 시각(성공/실패 무관)';
comment on column public.youtube_live_status.last_error is '마지막 조회 실패 사유. 성공 시 null';

alter table public.youtube_live_status enable row level security;

-- 로그인한 사용자는 상태를 읽을 수 있다 (홈 화면 LIVE 배지 · 생방송 페이지)
drop policy if exists "youtube_live_status read for authenticated" on public.youtube_live_status;
create policy "youtube_live_status read for authenticated"
  on public.youtube_live_status
  for select
  to authenticated
  using (true);

-- 쓰기 정책은 만들지 않는다. 갱신은 service_role(cron)만 수행한다.

-- Data API 노출 GRANT (_GRANT_TEMPLATE.md 규칙)
grant select on public.youtube_live_status to authenticated;
grant all    on public.youtube_live_status to service_role;

-- 초기 행 (울산명성교회 채널)
insert into public.youtube_live_status (id, channel_id, is_live)
values ('main', 'UCGqoK8XTWHLkyU8Nt-as1og', false)
on conflict (id) do nothing;
