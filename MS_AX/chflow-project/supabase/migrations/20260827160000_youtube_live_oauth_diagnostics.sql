-- 예배 생방송 OAuth 진단 필드
--
-- 왜 상태 테이블인가: 장애 구간(최초 실패 시각 유지·연속 실패 수·마지막 정상 시각)을
-- 알려면 누적 상태가 필요하다. 대안인 "매 polling 마다 이벤트 적립"은
--   ① youtube_live_events 가 무기한 보관이고
--   ② 동일 오류 반복 적립 방지 원칙(20260823 notify 수정)과 정면으로 충돌한다.
-- 그래서 이벤트는 상태가 바뀌는 순간(첫 실패·회복)만 남기고, 카운터는 이 컬럼들에 둔다.
--
-- 쓰기: service_role(폴러) 전용. 읽기: 기존 정책 그대로 로그인 사용자.
-- 기존 컬럼·RLS·GRANT 는 건드리지 않는다 (컬럼 추가 only).

alter table public.youtube_live_status
  add column if not exists oauth_last_ok_at             timestamptz,
  add column if not exists oauth_first_failed_at        timestamptz,
  add column if not exists oauth_last_failed_at         timestamptz,
  add column if not exists oauth_consecutive_failures   integer not null default 0,
  add column if not exists oauth_last_error_code        text,
  add column if not exists oauth_last_error_description text,
  add column if not exists oauth_last_failed_stage      text,
  add column if not exists oauth_last_http_status       integer;

comment on column public.youtube_live_status.oauth_last_ok_at is
  'OAuth 토큰 교환 + liveBroadcasts.list(mine=true) 가 마지막으로 모두 성공한 시각';
comment on column public.youtube_live_status.oauth_first_failed_at is
  '현재 장애 구간의 최초 실패 시각. 회복 시에만 null 로 초기화한다(구간 추적용)';
comment on column public.youtube_live_status.oauth_last_failed_at is
  '가장 최근 OAuth 실패 시각';
comment on column public.youtube_live_status.oauth_consecutive_failures is
  '연속 실패 횟수. 성공하면 0으로 초기화';
comment on column public.youtube_live_status.oauth_last_error_code is
  'Google 응답의 error 값 (invalid_grant / unauthorized_client / invalid_client / http_401 등)';
comment on column public.youtube_live_status.oauth_last_error_description is
  'Google 응답의 error_description(+error_subtype). credential 값은 저장하지 않으며 200자로 절단';
comment on column public.youtube_live_status.oauth_last_failed_stage is
  '실패 단계: token_exchange | live_broadcasts_list | unknown';
comment on column public.youtube_live_status.oauth_last_http_status is
  '실패 응답의 HTTP status';

-- 진단 필드는 기존 읽기 정책(youtube_live_status read for authenticated)에 그대로 포함된다.
-- 별도 정책·GRANT 변경 없음. credential 값은 어떤 컬럼에도 저장하지 않는다.
