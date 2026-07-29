-- 지난 말씀(설교 영상) 목록 캐시
--
-- UMS 홈페이지 설교 게시판은 로그인해야 영상 주소가 나온다. 그래서 서버가 주 1회
-- 로그인해 목록을 긁어 이 표에 담고, 앱은 이 표만 읽는다.
-- 영상 파일 자체는 UMS VOD 서버(http)에 있고 Cloudflare Worker 가 https 로 중계한다.
--
-- video_path 는 VOD 서버 기준 상대 경로만 저장한다
--   예: /2026/sermon_am/2026_0726_sermon_am_<hash>.mp4
-- 전체 주소는 앱이 프록시 주소와 합쳐서 만든다(호스트가 바뀌어도 데이터를 안 고치게).

create table if not exists public.sermon_archive (
  board        text        not null,          -- sermon_am | sermon_pm | sermon_pm3 | sermon_wed | sermon_event
  post_no      integer     not null,          -- UMS 게시글 번호
  title        text        not null,
  preacher     text,
  bible        text,                          -- 본문 구절
  preached_on  date,
  video_path   text        not null,
  thumb_path   text,
  byte_size    bigint,                        -- 파일 크기(모바일 데이터 안내용)
  synced_at    timestamptz not null default now(),
  primary key (board, post_no)
);

create index if not exists idx_sermon_archive_board_date
  on public.sermon_archive(board, preached_on desc);

comment on table  public.sermon_archive is '지난 말씀 목록 캐시 (UMS 설교 게시판, 주 1회 동기화)';
comment on column public.sermon_archive.video_path is 'VOD 서버 기준 상대 경로. 전체 주소는 앱이 프록시 주소와 합쳐 만든다';
comment on column public.sermon_archive.byte_size is '파일 크기. 성도에게 데이터 사용량을 미리 알리기 위해 저장';

alter table public.sermon_archive enable row level security;

-- 로그인한 성도만 목록을 볼 수 있다 (UMS 도 로그인 뒤에 보여주는 자료다)
drop policy if exists "sermon_archive read for authenticated" on public.sermon_archive;
create policy "sermon_archive read for authenticated"
  on public.sermon_archive
  for select
  to authenticated
  using (true);

-- 쓰기 정책 없음 → 동기화(service_role)만 기록한다.

-- Data API 노출 GRANT (_GRANT_TEMPLATE.md 규칙)
grant select on public.sermon_archive to authenticated;
grant all    on public.sermon_archive to service_role;
