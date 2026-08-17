-- 알림을 "개인/업무 사건(user)" 과 "전역 시스템 운영(ops)" 으로 분리한다.
--
-- 원칙: 수신자가 관리자인지가 아니라 "어떤 자격으로 받는가" 로 나눈다.
--   ops  = admin/office/pastor 라는 전역 운영 권한 때문에 받는 알림
--   user = 본인에게 일어난 사건이거나 특정 부서·업무 역할의 당사자로 받는 알림
-- 그래서 dept_join_request / dept_promotion_in / edu_* 는 부서 담당자 자격이므로 user 로 남긴다.
--
-- 이미 적용된 20260817090000 / 20260817223700 은 수정하지 않는다. 전부 forward 변경이다.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) audience 축
-- ─────────────────────────────────────────────────────────────────────────
alter table public.notifications
  add column if not exists audience text not null default 'user';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_audience_check'
  ) then
    alter table public.notifications
      add constraint notifications_audience_check check (audience in ('user', 'ops'));
  end if;
end $$;

-- audience 는 type 에서 결정된다. IMMUTABLE 이라 인덱스/제약에서도 쓸 수 있다.
-- 미등록 타입은 'user' 로 떨어진다 — 운영 알림을 잘못 숨기는 쪽보다 안전하고,
-- 등록 누락은 chflow-app 의 notificationRegistry 테스트가 잡는다.
create or replace function public.notification_audience_of(p_type text)
returns text language sql immutable set search_path = public
as $$
  select case coalesce(p_type, '')
    when 'ops_signup_pending'      then 'ops'
    when 'ops_feedback_new'        then 'ops'
    when 'ops_message_report'      then 'ops'
    when 'ops_usage_anomaly'       then 'ops'
    when 'ops_usage_r2_capacity'   then 'ops'
    when 'ops_usage_db_capacity'   then 'ops'
    when 'ops_bulletin_sync_error' then 'ops'
    -- ops_* rename 이전 이름. 백필 이후에도 방어적으로 남겨둔다.
    when 'signup_pending'          then 'ops'
    when 'feedback_new'            then 'ops'
    when 'message_report'          then 'ops'
    when 'usage_anomaly'           then 'ops'
    when 'usage_r2_capacity'       then 'ops'
    when 'usage_db_capacity'       then 'ops'
    when 'bulletin_sync_error'     then 'ops'
    else 'user'
  end
$$;
revoke all on function public.notification_audience_of(text) from public, anon;
grant execute on function public.notification_audience_of(text) to authenticated, service_role;

-- 생성 지점 32곳에 audience 를 일일이 넣지 않는다. type 이 곧 audience 이므로
-- 트리거가 항상 파생시켜 둘이 어긋날 수 없게 만든다. (type 이 바뀌면 다시 계산)
create or replace function public.set_notification_audience()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.audience := public.notification_audience_of(new.type);
  return new;
end;
$$;

drop trigger if exists trg_set_notification_audience on public.notifications;
create trigger trg_set_notification_audience
  before insert or update of type on public.notifications
  for each row execute function public.set_notification_audience();

-- ─────────────────────────────────────────────────────────────────────────
-- 2) 기존 row 백필 — 명시적 type mapping 만 쓴다 (else → ops 금지)
-- ─────────────────────────────────────────────────────────────────────────
update public.notifications set type = 'ops_signup_pending'      where type = 'signup_pending';
update public.notifications set type = 'ops_feedback_new'        where type = 'feedback_new';
update public.notifications set type = 'ops_message_report'      where type = 'message_report';
update public.notifications set type = 'ops_usage_anomaly'       where type = 'usage_anomaly';
update public.notifications set type = 'ops_usage_r2_capacity'   where type = 'usage_r2_capacity';
update public.notifications set type = 'ops_usage_db_capacity'   where type = 'usage_db_capacity';
update public.notifications set type = 'ops_bulletin_sync_error' where type = 'bulletin_sync_error';

-- 위 UPDATE 는 트리거가 audience 를 채운다. 나머지 기존 row 는 컬럼 기본값 'user' 이지만
-- 혹시 남은 불일치가 없도록 한 번 더 정합성을 맞춘다.
update public.notifications
set audience = public.notification_audience_of(type)
where audience is distinct from public.notification_audience_of(type);

create index if not exists idx_notif_user_audience_unread
  on public.notifications (user_id, audience, is_read, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 운영 알림 열람 권한 — 기존 get_user_role() 을 그대로 위임한다
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.can_view_ops_notifications()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(public.get_user_role(), '') in ('admin', 'office', 'pastor')
$$;
revoke all on function public.can_view_ops_notifications() from public, anon;
grant execute on function public.can_view_ops_notifications() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) RLS — 권한 강등(admin → member) 후 과거 ops 알림에 손댈 수 없게 한다
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "notif_select_own" on public.notifications;
create policy "notif_select_own"
  on public.notifications for select
  to authenticated
  using (
    user_id = auth.uid()
    and (audience = 'user' or public.can_view_ops_notifications())
  );

drop policy if exists "notif_update_own" on public.notifications;
create policy "notif_update_own"
  on public.notifications for update
  to authenticated
  using (
    user_id = auth.uid()
    and (audience = 'user' or public.can_view_ops_notifications())
  )
  with check (
    user_id = auth.uid()
    and (audience = 'user' or public.can_view_ops_notifications())
  );

drop policy if exists "notif_delete_own" on public.notifications;
create policy "notif_delete_own"
  on public.notifications for delete
  to authenticated
  using (
    user_id = auth.uid()
    and (audience = 'user' or public.can_view_ops_notifications())
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 5) 조회 RPC — SECURITY DEFINER 라 RLS 를 안 타므로 같은 권한 조건을 다시 넣는다.
--    폴링 비용을 늘리지 않기 위해 목록은 한 번의 호출로 user+ops 를 함께 돌려준다.
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists public.get_my_notifications(int, boolean);
create or replace function public.get_my_notifications(
  p_limit int default 30,
  p_only_unread boolean default false
)
returns table(
  id uuid, type text, title text, body text, link_url text,
  is_read boolean, created_at timestamptz, metadata jsonb, audience text
)
language sql stable security definer set search_path = public
as $$
  select n.id, n.type, n.title, n.body, n.link_url,
         n.is_read, n.created_at, n.metadata, n.audience
  from public.notifications n
  where n.user_id = auth.uid()
    and (n.audience = 'user' or public.can_view_ops_notifications())
    and (not p_only_unread or n.is_read = false)
  order by n.created_at desc
  limit p_limit
$$;
grant execute on function public.get_my_notifications(int, boolean) to authenticated;

-- 탭별 미읽음 + 운영 탭 노출 여부를 한 번에. 탭 때문에 쿼리를 늘리지 않기 위한 RPC.
create or replace function public.get_my_notification_counts()
returns table(user_unread int, ops_unread int, ops_viewer boolean)
language sql stable security definer set search_path = public
as $$
  select
    count(*) filter (where n.audience = 'user')::int,
    count(*) filter (where n.audience = 'ops')::int,
    public.can_view_ops_notifications()
  from public.notifications n
  where n.user_id = auth.uid()
    and n.is_read = false
    and (n.audience = 'user' or public.can_view_ops_notifications())
$$;
grant execute on function public.get_my_notification_counts() to authenticated;

-- 배지 합계용 기존 RPC 도 권한 조건을 맞춘다 (강등자가 ops 를 세지 못하게)
create or replace function public.get_unread_count()
returns int language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.notifications n
  where n.user_id = auth.uid() and n.is_read = false
    and (n.audience = 'user' or public.can_view_ops_notifications())
$$;
grant execute on function public.get_unread_count() to authenticated;

-- 모두 읽음은 audience 범위를 명시해야 한다.
-- 「내 알림」에서 모두 읽음을 눌렀다고 운영 알림 미읽음까지 사라지면 안 되므로
-- 인자 없는 구버전(전체 처리)은 제거하고 기본값을 'user' 로 둔다.
drop function if exists public.mark_all_notifications_read();
create or replace function public.mark_all_notifications_read(p_audience text default 'user')
returns int language plpgsql security definer set search_path = public
as $$
declare
  v_count int;
  v_audience text := coalesce(p_audience, 'user');
begin
  if v_audience not in ('user', 'ops') then
    raise exception using errcode = '22023', message = 'invalid notification audience';
  end if;

  -- UI 만 믿지 않는다. ops 범위는 현재 role 로 다시 확인한다.
  if v_audience = 'ops' and not public.can_view_ops_notifications() then
    raise exception using errcode = '42501', message = 'ops_notifications_forbidden';
  end if;

  update public.notifications n
  set is_read = true, read_at = now()
  where n.user_id = auth.uid()
    and n.is_read = false
    and n.audience = v_audience;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.mark_all_notifications_read(text) to authenticated;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.notifications n
  set is_read = true, read_at = now()
  where n.id = p_notification_id and n.user_id = auth.uid()
    and (n.audience = 'user' or public.can_view_ops_notifications())
$$;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 알림 설정 — 사용자용/운영용 분리
--    필수 운영 알림(신고·장애·용량)은 스위치를 만들지 않는다. 선택 운영 알림만 끌 수 있다.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.notification_preferences
  add column if not exists ops_signup_enabled boolean not null default true,
  add column if not exists ops_feedback_enabled boolean not null default true;

-- 미등록 타입은 'system' 으로 흘려보내지 않고 'unclassified' 로 남긴다.
create or replace function public.notification_category(p_type text)
returns text language sql immutable set search_path = public
as $$
  select case coalesce(p_type, '')
    when 'notice_worship_live'        then 'worship'
    when 'notice_worship_live_ended'  then 'worship'
    when 'message_new'                then 'message'
    when 'signup_approved'            then 'account'
    when 'signup_rejected'            then 'account'
    when 'feedback_reply'             then 'feedback'
    when 'feedback_status'            then 'feedback'
    when 'dept_join_approved'         then 'department'
    when 'dept_join_rejected'         then 'department'
    when 'dept_approved'              then 'department'
    when 'dept_rejected'              then 'department'
    when 'dept_removed'               then 'department'
    when 'dept_role_assigned'         then 'department'
    when 'dept_appointed'             then 'department'
    when 'dept_notice_new'            then 'department'
    when 'dept_notice_reply'          then 'department'
    when 'dept_verse_memory_new'      then 'department'
    when 'dept_join_request'          then 'department'
    when 'dept_promotion_in'          then 'department'
    when 'edu_promotion_done'         then 'education'
    when 'edu_promotion_upcoming'     then 'education'
    when 'edu_absence'                then 'education'
    when 'ops_signup_pending'         then 'ops_signup'
    when 'ops_feedback_new'           then 'ops_feedback'
    when 'ops_message_report'         then 'ops_report'
    when 'ops_usage_anomaly'          then 'ops_system'
    when 'ops_usage_r2_capacity'      then 'ops_system'
    when 'ops_usage_db_capacity'      then 'ops_system'
    when 'ops_bulletin_sync_error'    then 'ops_system'
    else 'unclassified'
  end
$$;

-- 필수 운영 알림은 사용자 알림 설정과 무관하게 전달한다.
-- 선택 운영 알림은 운영 스위치만 본다 (사용자용 enabled/push/in_app 은 보지 않는다).
create or replace function public.notification_channel_allowed(
  p_user_id uuid, p_type text, p_channel text
)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when public.notification_category(p_type) in ('ops_report', 'ops_system') then true
    when public.notification_category(p_type) = 'ops_signup' then coalesce(
      (select np.ops_signup_enabled from public.notification_preferences np where np.user_id = p_user_id), true)
    when public.notification_category(p_type) = 'ops_feedback' then coalesce(
      (select np.ops_feedback_enabled from public.notification_preferences np where np.user_id = p_user_id), true)
    -- 분류가 없으면 차단하지 않는다. 분류 누락으로 알림이 유실되는 쪽이 더 나쁘다.
    when public.notification_category(p_type) = 'unclassified' then true
    else coalesce((
      select np.enabled
        and case p_channel when 'push' then np.push_enabled when 'in_app' then np.in_app_enabled else false end
        and case public.notification_category(p_type)
          when 'message' then np.message_enabled
          when 'worship' then np.worship_enabled
          when 'notice' then np.notice_enabled
          when 'department' then np.department_enabled
          when 'education' then np.education_enabled
          when 'feedback' then np.feedback_enabled
          when 'account' then np.account_enabled
          else np.system_enabled
        end
      from public.notification_preferences np where np.user_id = p_user_id
    ), true)
  end
$$;
revoke all on function public.notification_channel_allowed(uuid, text, text) from public, anon, authenticated;
grant execute on function public.notification_channel_allowed(uuid, text, text) to service_role;

-- RETURNS TABLE 컬럼이 늘어나므로 CREATE OR REPLACE 로는 바꿀 수 없다(42P13). 먼저 제거한다.
drop function if exists public.get_my_notification_preferences();
create or replace function public.get_my_notification_preferences()
returns table(
  enabled boolean, push_enabled boolean, in_app_enabled boolean,
  message_enabled boolean, worship_enabled boolean, notice_enabled boolean,
  department_enabled boolean, education_enabled boolean, feedback_enabled boolean,
  account_enabled boolean, system_enabled boolean,
  ops_signup_enabled boolean, ops_feedback_enabled boolean
)
language sql stable security definer set search_path = public
as $$
  select
    coalesce(np.enabled,true), coalesce(np.push_enabled,true), coalesce(np.in_app_enabled,true),
    coalesce(np.message_enabled,true), coalesce(np.worship_enabled,true), coalesce(np.notice_enabled,true),
    coalesce(np.department_enabled,true), coalesce(np.education_enabled,true), coalesce(np.feedback_enabled,true),
    coalesce(np.account_enabled,true), coalesce(np.system_enabled,true),
    coalesce(np.ops_signup_enabled,true), coalesce(np.ops_feedback_enabled,true)
  from (select 1) seed
  left join public.notification_preferences np on np.user_id = auth.uid()
$$;
grant execute on function public.get_my_notification_preferences() to authenticated;

-- 새 인자는 기본값을 주고 뒤에 붙인다. 구버전 클라이언트 호출도 계속 동작한다.
-- 단 11인자 구버전을 남겨두면 오버로드가 둘이 되어 11개 인자 호출이 모호해지므로 제거한다.
drop function if exists public.set_my_notification_preferences(
  boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean
);
create or replace function public.set_my_notification_preferences(
  p_enabled boolean, p_push_enabled boolean, p_in_app_enabled boolean,
  p_message_enabled boolean, p_worship_enabled boolean, p_notice_enabled boolean,
  p_department_enabled boolean, p_education_enabled boolean, p_feedback_enabled boolean,
  p_account_enabled boolean, p_system_enabled boolean,
  p_ops_signup_enabled boolean default true, p_ops_feedback_enabled boolean default true
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  insert into public.notification_preferences(
    user_id,enabled,push_enabled,in_app_enabled,message_enabled,worship_enabled,
    notice_enabled,department_enabled,education_enabled,feedback_enabled,
    account_enabled,system_enabled,ops_signup_enabled,ops_feedback_enabled,updated_at
  ) values(
    auth.uid(),coalesce(p_enabled,true),coalesce(p_push_enabled,true),coalesce(p_in_app_enabled,true),
    coalesce(p_message_enabled,true),coalesce(p_worship_enabled,true),coalesce(p_notice_enabled,true),
    coalesce(p_department_enabled,true),coalesce(p_education_enabled,true),coalesce(p_feedback_enabled,true),
    coalesce(p_account_enabled,true),coalesce(p_system_enabled,true),
    coalesce(p_ops_signup_enabled,true),coalesce(p_ops_feedback_enabled,true),now()
  ) on conflict(user_id) do update set
    enabled=excluded.enabled,push_enabled=excluded.push_enabled,in_app_enabled=excluded.in_app_enabled,
    message_enabled=excluded.message_enabled,worship_enabled=excluded.worship_enabled,
    notice_enabled=excluded.notice_enabled,department_enabled=excluded.department_enabled,
    education_enabled=excluded.education_enabled,feedback_enabled=excluded.feedback_enabled,
    account_enabled=excluded.account_enabled,system_enabled=excluded.system_enabled,
    ops_signup_enabled=excluded.ops_signup_enabled,ops_feedback_enabled=excluded.ops_feedback_enabled,
    updated_at=now();
end;
$$;
grant execute on function public.set_my_notification_preferences(
  boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean
) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) 생성 지점의 타입을 ops_* 로 교체. 로직은 그대로 두고 타입 문자열만 바꾼다.
--    (dedupe 조건도 새 타입으로 맞춰야 중복 발송이 생기지 않는다)
-- ─────────────────────────────────────────────────────────────────────────

-- 7-1) 가입 신청 대기 (트리거 2개)
create or replace function public.notify_admins_on_signup()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'pending' then
    insert into public.notifications (user_id, type, title, body, link_url, metadata)
    select
      p.id,
      'ops_signup_pending',
      '🆕 새 가입 신청',
      coalesce(new.name, new.username, '신규 사용자') || ' 님이 가입을 신청했습니다.',
      '/admin/pending',
      jsonb_build_object(
        'signup_user_id', new.id,
        'signup_name', new.name,
        'signup_username', new.username
      )
    from public.profiles p
    where p.role in ('admin','office','pastor')
      and p.status = 'active'
      and p.id <> new.id;
  end if;
  return new;
end;
$$;

create or replace function public.notify_admins_on_signup_status()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'pending' and old.status is distinct from 'pending' then
    insert into public.notifications (user_id, type, title, body, link_url, metadata)
    select
      p.id,
      'ops_signup_pending',
      '🆕 가입 재신청',
      coalesce(new.name, new.username, '신규 사용자') || ' 님이 가입을 재신청했습니다.',
      '/admin/pending',
      jsonb_build_object(
        'signup_user_id', new.id,
        'signup_name', new.name,
        'signup_username', new.username
      )
    from public.profiles p
    where p.role in ('admin','office','pastor')
      and p.status = 'active'
      and p.id <> new.id;
  end if;
  return new;
end;
$$;

-- 7-2) 문의 접수
create or replace function public.create_feedback_post(
  p_title text,
  p_body text,
  p_is_private boolean default false,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_post_id uuid;
  v_author_name text;
  v_idx int := 0;
  v_att jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception '제목을 입력하세요'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception '내용을 입력하세요'; end if;

  insert into public.feedback_posts (author_id, title, body, is_private)
  values (auth.uid(), p_title, p_body, coalesce(p_is_private, false))
  returning id into v_post_id;

  if jsonb_typeof(p_attachments) = 'array' then
    for v_att in select * from jsonb_array_elements(p_attachments)
    loop
      insert into public.feedback_attachments
        (post_id, file_path, file_name, mime_type, size_bytes, position, uploaded_by)
      values (
        v_post_id,
        v_att->>'file_path',
        coalesce(v_att->>'file_name', 'image'),
        v_att->>'mime_type',
        nullif(v_att->>'size_bytes','')::int,
        v_idx,
        auth.uid()
      );
      v_idx := v_idx + 1;
    end loop;
  end if;

  select name into v_author_name from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
  select
    pr.id,
    'ops_feedback_new',
    '📮 새 불편신고/건의',
    coalesce(v_author_name, '익명') || ': ' || left(p_title, 40),
    '/feedback/' || v_post_id,
    auth.uid(),
    jsonb_build_object('post_id', v_post_id)
  from public.profiles pr
  where pr.role in ('admin','office','pastor')
    and pr.id <> auth.uid();

  return v_post_id;
end;
$$;
grant execute on function public.create_feedback_post(text, text, boolean, jsonb) to authenticated;

-- 7-3) 주보 자동 수집 실패
create or replace function public.log_bulletin_sync(
  p_source text,
  p_status text,
  p_detail text default null,
  p_item_no integer default null,
  p_issue_date date default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.bulletin_sync_log (source, status, detail, item_no, issue_date)
  values (p_source, p_status, p_detail, p_item_no, p_issue_date);

  if p_status = 'error' then
    if not exists (
      select 1 from public.notifications
      where type = 'ops_bulletin_sync_error'
        and metadata->>'source' = p_source
        and created_at > now() - interval '12 hours'
    ) then
      insert into public.notifications (user_id, type, title, body, link_url, metadata)
      select
        p.id,
        'ops_bulletin_sync_error',
        '⚠️ 주보 자동 수집 실패',
        p_source || ' 주보 자동 다운로드가 실패했습니다: ' || left(coalesce(p_detail, '원인 미상'), 200),
        '/admin',
        jsonb_build_object('source', p_source, 'detail', p_detail)
      from public.profiles p
      where p.role in ('admin', 'office')
        and p.status = 'active';
    end if;
  end if;
end;
$$;
grant execute on function public.log_bulletin_sync(text, text, text, integer, date) to service_role;

-- 7-4) 메신저 신고 접수
--      messenger_log_action('message_report', ...) 은 감사 로그의 action 값이라 그대로 둔다.
create or replace function public.report_messenger_message(
  p_message_id uuid,
  p_reason text,
  p_note text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_msg public.messenger_messages;
  v_report_id uuid;
  v_reason text;
begin
  perform public.messenger_require_active_user();

  select * into v_msg from public.messenger_messages where id = p_message_id;
  if not found then
    raise exception 'Message not found';
  end if;

  if not public.is_messenger_participant(v_msg.conversation_id, auth.uid()) then
    raise exception 'No access to this message';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'Report reason is required';
  end if;

  insert into public.messenger_reports (
    reporter_id, conversation_id, message_id, reported_user_id, reason, note
  )
  values (
    auth.uid(),
    v_msg.conversation_id,
    v_msg.id,
    v_msg.sender_id,
    left(v_reason, 120),
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_report_id;

  perform public.messenger_log_action(
    'message_report',
    v_msg.conversation_id,
    v_msg.id,
    v_msg.sender_id,
    jsonb_build_object('report_id', v_report_id, 'reason', v_reason)
  );

  insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
  select
    p.id,
    'ops_message_report',
    '메신저 신고 접수',
    left(v_reason, 120),
    '/messenger',
    auth.uid(),
    jsonb_build_object('report_id', v_report_id, 'message_id', v_msg.id)
  from public.profiles p
  where p.role in ('admin', 'office', 'pastor')
    and p.status = 'active'
    and p.id <> auth.uid();

  return v_report_id;
end;
$$;
grant execute on function public.report_messenger_message(uuid, text, text) to authenticated;

-- 7-5) 리소스 이상감지 — 20260817223700 의 감시 6종을 그대로 유지하고 타입만 교체한다.
--      DB 용량 임계치는 여전히 /api/cron/storage-cleanup 담당이다
--      (quota 가 Vercel 환경변수 SUPABASE_DB_QUOTA_BYTES 라 pg_cron 이 볼 수 없다).
create or replace function public.admin_usage_check_anomalies()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_date date := (now() at time zone 'Asia/Seoul')::date - 1;
  v_msgs text[] := '{}';
  v_spike boolean := false;
  -- usage diagnostics v2 query-volume spike
  v_cur public.admin_usage_daily;
  v_base record;
  v_prev_calls bigint;
  v_calls_pct numeric;
  v_prev_day_pct numeric;
  v_per_visitor_pct numeric;
  v_calls_txt text;
  v_prev_txt text;
  -- legacy snapshot-based monitors
  v_snap record;
  v_latest public.admin_usage_snapshots;
  v_snap_prev public.admin_usage_snapshots;
  v_week public.admin_usage_snapshots;
  v_title text;
  v_admin uuid;
  rec record;
begin
  -- 1) DB 쿼리 호출 급증 — 기준은 lib/usageDiagnostics.ts 의 QUERY_SPIKE_THRESHOLDS 와 같다.
  select * into v_cur from public.admin_usage_daily
  where usage_date = v_date and data_quality = 'complete';

  if found then
    select statement_calls into v_prev_calls
    from public.admin_usage_daily
    where data_quality = 'complete' and usage_date < v_date
    order by usage_date desc limit 1;

    select count(*)::int as days, avg(statement_calls)::numeric as avg_calls,
      case when sum(visitors) > 0 then sum(statement_calls)::numeric / sum(visitors) else null end as weighted_per_visitor
    into v_base
    from (
      select statement_calls, visitors
      from public.admin_usage_daily
      where data_quality = 'complete' and usage_date < v_date
      order by usage_date desc limit 7
    ) p;

    if coalesce(v_base.days, 0) >= 3 then
      v_calls_pct := case when coalesce(v_base.avg_calls, 0) > 0
        then (v_cur.statement_calls::numeric / v_base.avg_calls - 1) * 100 else null end;
      v_prev_day_pct := case when coalesce(v_prev_calls, 0) > 0
        then (v_cur.statement_calls::numeric / v_prev_calls - 1) * 100 else null end;
      v_per_visitor_pct := case
        when coalesce(v_base.weighted_per_visitor, 0) > 0 and v_cur.statements_per_visitor is not null
        then (v_cur.statements_per_visitor / v_base.weighted_per_visitor - 1) * 100
        else null end;

      v_spike := coalesce(v_cur.statement_calls, 0) >= 1000
        and ((v_calls_pct is not null and v_calls_pct >= 100)
          or (v_prev_day_pct is not null and v_prev_day_pct >= 150))
        and coalesce(v_per_visitor_pct, 0) >= 25;

      if v_spike then
        v_calls_txt := case when v_calls_pct is null then 'n/a'
          else (case when v_calls_pct >= 0 then '+' else '' end) || round(v_calls_pct)::text || '%' end;
        v_prev_txt := case when v_prev_day_pct is null then 'n/a'
          else (case when v_prev_day_pct >= 0 then '+' else '' end) || round(v_prev_day_pct)::text || '%' end;
        v_msgs := v_msgs || format(
          'DB statements %s건 (7일 평균 대비 %s · 전일 대비 %s · 방문자당 +%s%%) — 추정 원인 %s (%s)',
          v_cur.statement_calls, v_calls_txt, v_prev_txt,
          round(coalesce(v_per_visitor_pct, 0)),
          coalesce(v_cur.candidate, 'UNKNOWN_QUERY_SPIKE'),
          coalesce(v_cur.confidence, 'low')
        );
      end if;
    end if;
  end if;

  -- 2) 방문자 급증 · 3) DB 하루 증가 급증
  with snaps as (
    select snap_date, db_size_bytes, visitors,
           coalesce((stmt_totals->>'calls')::bigint, 0) as calls,
           db_size_bytes - lag(db_size_bytes) over (order by snap_date) as db_delta,
           coalesce((stmt_totals->>'calls')::bigint, 0)
             - lag(coalesce((stmt_totals->>'calls')::bigint, 0)) over (order by snap_date) as calls_delta
    from public.admin_usage_snapshots
    where snap_date >= v_date - 31
  ),
  base as (
    select
      percentile_cont(0.5) within group (order by visitors) as med_visitors,
      percentile_cont(0.5) within group (order by db_delta) as med_db,
      count(*) as n
    from snaps
    where snap_date < v_date and calls_delta is not null and calls_delta >= 0
  )
  select s.visitors, s.db_delta, s.db_size_bytes,
         b.med_visitors, b.med_db, b.n
  into v_snap
  from snaps s cross join base b
  where s.snap_date = v_date;

  if coalesce(v_snap.n, 0) >= 7 then
    if v_snap.visitors >= 10 and v_snap.visitors > 3 * greatest(v_snap.med_visitors, 1) then
      v_msgs := v_msgs || format('방문자 %s명 (30일 중앙값 %s명의 3배 초과)', v_snap.visitors, round(v_snap.med_visitors));
    end if;
    if v_snap.db_delta is not null and v_snap.db_delta >= 5 * 1024 * 1024
       and v_snap.db_delta > 3 * greatest(v_snap.med_db, 1024 * 1024) then
      v_msgs := v_msgs || format('DB 하루 증가 %sMB (30일 중앙값의 3배 초과)', round(v_snap.db_delta / 1048576.0, 1));
    end if;
  end if;

  select * into v_latest from public.admin_usage_snapshots where snap_date = v_date;
  if v_latest.snap_date is not null then
    -- 4) 행 과다 쿼리 (전일 증가분: +500회 이상 & 호출당 50행 초과)
    select * into v_snap_prev from public.admin_usage_snapshots
    where snap_date < v_date order by snap_date desc limit 1;
    if v_snap_prev.snap_date is not null then
      for rec in
        select l->>'q' as q,
               (l->>'calls')::bigint - coalesce((p->>'calls')::bigint, 0) as cd,
               (l->>'rows')::bigint - coalesce((p->>'rows')::bigint, 0) as rd
        from jsonb_array_elements(v_latest.top_queries) l
        left join jsonb_array_elements(coalesce(v_snap_prev.top_queries, '[]'::jsonb)) p
          on p->>'qid' = l->>'qid'
        where (l->>'calls')::bigint - coalesce((p->>'calls')::bigint, 0) > 500
          and ((l->>'rows')::bigint - coalesce((p->>'rows')::bigint, 0))
              / greatest((l->>'calls')::bigint - coalesce((p->>'calls')::bigint, 0), 1) > 50
        order by 2 desc
        limit 2
      loop
        v_msgs := v_msgs || format('행 과다 쿼리 +%s회 (%s…) — 인덱스·limit 확인 필요', rec.cd, left(rec.q, 50));
      end loop;
    end if;

    -- 5) 테이블 주간 급증 (+20MB/주)
    select * into v_week from public.admin_usage_snapshots
    where snap_date <= v_date - 7 order by snap_date desc limit 1;
    if v_week.snap_date is not null then
      for rec in
        select l->>'name' as name,
               (l->>'bytes')::bigint - coalesce((p->>'bytes')::bigint, 0) as bd
        from jsonb_array_elements(v_latest.table_sizes) l
        left join jsonb_array_elements(coalesce(v_week.table_sizes, '[]'::jsonb)) p
          on p->>'name' = l->>'name'
        where (l->>'bytes')::bigint - coalesce((p->>'bytes')::bigint, 0) > 20 * 1024 * 1024
        order by 2 desc
        limit 2
      loop
        v_msgs := v_msgs || format('%s 테이블 주간 +%sMB — 로그성 적재·보존기간 확인 필요', rec.name, round(rec.bd / 1048576.0, 1));
      end loop;
    end if;
  end if;

  -- 발송: 하루 단위 dedupe (타입만 ops_usage_anomaly 로 바뀌었다)
  if array_length(v_msgs, 1) is null or exists (
    select 1 from public.notifications
    where type = 'ops_usage_anomaly' and created_at > now() - interval '1 day'
  ) then return; end if;

  v_title := case when v_spike then 'DB 호출량 증가 감지' else '리소스 사용 이상 감지' end;

  for v_admin in
    select id from public.profiles where role in ('admin', 'office', 'pastor') and status = 'active'
  loop
    insert into public.notifications (user_id, type, title, body, link_url)
    values (
      v_admin,
      'ops_usage_anomaly',
      v_title,
      format('%s 기준: ', to_char(v_date, 'MM/DD')) || array_to_string(v_msgs, ' · '),
      '/admin/usage-status'
    );
  end loop;
end;
$$;

revoke all on function public.admin_usage_check_anomalies() from public, anon, authenticated;
