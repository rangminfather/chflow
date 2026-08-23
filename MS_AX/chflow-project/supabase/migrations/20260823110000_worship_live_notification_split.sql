-- =============================================================
-- 예배 생방송 알림: 시작/종료를 각각 끌 수 있게 카테고리 분리
--   worship      = notice_worship_live       (시작)
--   worship_end  = notice_worship_live_ended (종료, 신규 컬럼)
--
-- 기존 사용자 설정 보존: worship_enabled=false 였던 사람은 종료 알림도 꺼둔 상태로
-- 시작한다. 분리 때문에 껐던 알림이 다시 켜지면 안 된다.
-- =============================================================

alter table public.notification_preferences
  add column if not exists worship_end_enabled boolean not null default true;

update public.notification_preferences
set worship_end_enabled = false, updated_at = now()
where worship_enabled = false and worship_end_enabled = true;

-- 미등록 타입은 'system' 으로 흘려보내지 않고 'unclassified' 로 남긴다.
create or replace function public.notification_category(p_type text)
returns text language sql immutable set search_path = public
as $$
  select case coalesce(p_type, '')
    when 'notice_worship_live'        then 'worship'
    when 'notice_worship_live_ended'  then 'worship_end'
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
          when 'worship_end' then np.worship_end_enabled
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
  message_enabled boolean, worship_enabled boolean, worship_end_enabled boolean,
  notice_enabled boolean,
  department_enabled boolean, education_enabled boolean, feedback_enabled boolean,
  account_enabled boolean, system_enabled boolean,
  ops_signup_enabled boolean, ops_feedback_enabled boolean
)
language sql stable security definer set search_path = public
as $$
  select
    coalesce(np.enabled,true), coalesce(np.push_enabled,true), coalesce(np.in_app_enabled,true),
    coalesce(np.message_enabled,true), coalesce(np.worship_enabled,true), coalesce(np.worship_end_enabled,true),
    coalesce(np.notice_enabled,true),
    coalesce(np.department_enabled,true), coalesce(np.education_enabled,true), coalesce(np.feedback_enabled,true),
    coalesce(np.account_enabled,true), coalesce(np.system_enabled,true),
    coalesce(np.ops_signup_enabled,true), coalesce(np.ops_feedback_enabled,true)
  from (select 1) seed
  left join public.notification_preferences np on np.user_id = auth.uid()
$$;
grant execute on function public.get_my_notification_preferences() to authenticated;

-- 새 인자는 기본값을 주고 뒤에 붙인다. 배포 전 구버전 클라이언트(13인자 호출)도 계속 동작한다.
-- 단 13인자 구버전 함수를 남겨두면 오버로드가 둘이 되어 호출이 모호해지므로 제거한다.
drop function if exists public.set_my_notification_preferences(
  boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean
);
create or replace function public.set_my_notification_preferences(
  p_enabled boolean, p_push_enabled boolean, p_in_app_enabled boolean,
  p_message_enabled boolean, p_worship_enabled boolean, p_notice_enabled boolean,
  p_department_enabled boolean, p_education_enabled boolean, p_feedback_enabled boolean,
  p_account_enabled boolean, p_system_enabled boolean,
  p_ops_signup_enabled boolean default true, p_ops_feedback_enabled boolean default true,
  p_worship_end_enabled boolean default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  -- 구버전 클라이언트는 이 인자를 보내지 않는다. 그 경우 시작 알림 설정을 따라가게 해
  -- "종료만 몰래 켜지는" 상황을 막는다.
  v_worship_end boolean := coalesce(p_worship_end_enabled, p_worship_enabled, true);
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  insert into public.notification_preferences(
    user_id,enabled,push_enabled,in_app_enabled,message_enabled,worship_enabled,worship_end_enabled,
    notice_enabled,department_enabled,education_enabled,feedback_enabled,
    account_enabled,system_enabled,ops_signup_enabled,ops_feedback_enabled,updated_at
  ) values(
    auth.uid(),coalesce(p_enabled,true),coalesce(p_push_enabled,true),coalesce(p_in_app_enabled,true),
    coalesce(p_message_enabled,true),coalesce(p_worship_enabled,true),v_worship_end,
    coalesce(p_notice_enabled,true),
    coalesce(p_department_enabled,true),coalesce(p_education_enabled,true),coalesce(p_feedback_enabled,true),
    coalesce(p_account_enabled,true),coalesce(p_system_enabled,true),
    coalesce(p_ops_signup_enabled,true),coalesce(p_ops_feedback_enabled,true),now()
  ) on conflict(user_id) do update set
    enabled=excluded.enabled,push_enabled=excluded.push_enabled,in_app_enabled=excluded.in_app_enabled,
    message_enabled=excluded.message_enabled,worship_enabled=excluded.worship_enabled,
    worship_end_enabled=excluded.worship_end_enabled,
    notice_enabled=excluded.notice_enabled,department_enabled=excluded.department_enabled,
    education_enabled=excluded.education_enabled,feedback_enabled=excluded.feedback_enabled,
    account_enabled=excluded.account_enabled,system_enabled=excluded.system_enabled,
    ops_signup_enabled=excluded.ops_signup_enabled,ops_feedback_enabled=excluded.ops_feedback_enabled,
    updated_at=now();
end;
$$;
grant execute on function public.set_my_notification_preferences(
  boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean
) to authenticated;
