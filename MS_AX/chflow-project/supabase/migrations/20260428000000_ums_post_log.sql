-- UMS(명성교회 사무실 게시판) 자동 글등록 로그 + 쿨다운 추적
--
-- 목적:
--   ums.or.kr 의 "같은 작성자 30분 내 재등록 차단" 정책을 우리가 선제적으로
--   체크해서 사용자가 의미없는 클릭을 못 하게 하고, 카운트다운 UI 를 띄움.
--
-- 정책:
--   - status='success' 인 가장 최근 게시글 시간 기준 30분 쿨다운
--   - 'rate_limited', 'failed' 도 기록은 남기되 쿨다운 산정엔 빼는 게 맞음
--     (실패는 서버에 글이 안 올라간 거니까 다시 시도 가능해야 함)

create table if not exists ums_post_log (
  id              bigserial primary key,
  ums_user_id     text not null,                                            -- ums.or.kr 의 user_id (예: 'clyawy')
  posted_at       timestamptz not null default now(),
  post_no         int,                                                       -- write_ok.php 응답에서 추출한 글번호
  category        int default 2,                                             -- 2 = 부서주보 (현재 고정)
  subject         text,
  status          text not null check (status in ('success', 'rate_limited', 'failed')),
  error_message   text,                                                      -- 실패 시 사유
  chflow_user_id  uuid references auth.users(id) on delete set null,        -- 누가 chflow 에서 트리거했는지
  dept_id         uuid references departments(id) on delete set null,        -- 어느 부서에서 (감사용)
  pl_date         text                                                        -- write.php 발급 pl_date (디버깅 용)
);

create index if not exists ums_post_log_user_time_idx
  on ums_post_log (ums_user_id, posted_at desc);

create index if not exists ums_post_log_chflow_user_idx
  on ums_post_log (chflow_user_id, posted_at desc);

-- ────────────────────────────────────────────────────────────
-- RPC: 쿨다운 잔여 초 + 직전 성공글 메타 조회
-- ────────────────────────────────────────────────────────────
create or replace function ums_check_cooldown(p_ums_user_id text)
returns table (
  remaining_seconds int,
  last_posted_at    timestamptz,
  last_post_no      int,
  last_subject      text
)
language sql
security definer
set search_path = public
as $$
  with last_success as (
    select posted_at, post_no, subject
    from ums_post_log
    where ums_user_id = p_ums_user_id
      and status = 'success'
    order by posted_at desc
    limit 1
  )
  select
    greatest(
      0,
      30*60 - extract(epoch from (now() - posted_at))::int
    ) as remaining_seconds,
    posted_at         as last_posted_at,
    post_no           as last_post_no,
    subject           as last_subject
  from last_success
  union all
  -- 한 번도 등록한 적 없는 신규 계정인 경우 0/null 행 반환
  select 0, null::timestamptz, null::int, null::text
  where not exists (select 1 from last_success);
$$;

-- ────────────────────────────────────────────────────────────
-- RPC: 등록 결과 로그 기록 (서버 API 에서 호출)
-- ────────────────────────────────────────────────────────────
create or replace function ums_log_post(
  p_ums_user_id    text,
  p_status         text,
  p_post_no        int default null,
  p_subject        text default null,
  p_error_message  text default null,
  p_chflow_user_id uuid default null,
  p_dept_id        uuid default null,
  p_pl_date        text default null,
  p_category       int default 2
)
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into ums_post_log (
    ums_user_id, status, post_no, subject, error_message,
    chflow_user_id, dept_id, pl_date, category
  ) values (
    p_ums_user_id, p_status, p_post_no, p_subject, p_error_message,
    p_chflow_user_id, p_dept_id, p_pl_date, p_category
  )
  returning id;
$$;

-- ────────────────────────────────────────────────────────────
-- 권한
-- ────────────────────────────────────────────────────────────
-- 쿨다운 조회는 인증된 사용자 누구나 가능 (UI 카운트다운 표시용)
grant execute on function ums_check_cooldown(text) to authenticated;

-- 로그 기록은 서버(service_role) 에서만. 클라이언트 직접 위조 방지.
revoke execute on function ums_log_post(text, text, int, text, text, uuid, uuid, text, int) from public;
revoke execute on function ums_log_post(text, text, int, text, text, uuid, uuid, text, int) from authenticated;
grant execute on function ums_log_post(text, text, int, text, text, uuid, uuid, text, int) to service_role;

-- 테이블 자체에는 RLS 켜고, 인증된 사용자가 본인이 트리거한 로그만 select 가능
alter table ums_post_log enable row level security;

drop policy if exists ums_post_log_select_own on ums_post_log;
create policy ums_post_log_select_own
  on ums_post_log
  for select
  to authenticated
  using (chflow_user_id = auth.uid());

-- service_role 은 RLS 우회로 모든 작업 가능 (별도 정책 불필요)
