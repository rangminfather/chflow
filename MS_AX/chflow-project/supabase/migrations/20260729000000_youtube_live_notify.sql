-- 예배 생방송 시작 알림 중복 방지용 컬럼.
--
-- 1분 간격 폴러가 라이브를 감지하면 전 성도에게 알림을 넣는다. 폴러가 매분 돌기
-- 때문에 "이 방송에 대해 이미 보냈는지"를 기록해야 같은 방송으로 반복 발송하지 않는다.
-- notified_video_id 를 조건부로 갱신해 동시 실행에서도 한 번만 발송된다.

alter table public.youtube_live_status
  add column if not exists notified_video_id text,
  add column if not exists notified_at timestamptz;

comment on column public.youtube_live_status.notified_video_id is
  '예배 시작 알림을 이미 발송한 videoId. 같은 방송 재발송 방지';
comment on column public.youtube_live_status.notified_at is
  '마지막 예배 시작 알림 발송 시각';
