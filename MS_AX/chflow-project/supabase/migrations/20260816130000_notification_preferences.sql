-- 사용자별 알림 채널(휴대폰 푸시/앱 내)과 유형 설정.
-- 기존 사용 경험을 보존하기 위해 설정 행이 없으면 모든 알림을 허용한다.

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  push_enabled boolean not null default true,
  in_app_enabled boolean not null default true,
  message_enabled boolean not null default true,
  worship_enabled boolean not null default true,
  notice_enabled boolean not null default true,
  department_enabled boolean not null default true,
  education_enabled boolean not null default true,
  feedback_enabled boolean not null default true,
  account_enabled boolean not null default true,
  system_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own on public.notification_preferences
  for select to authenticated using (user_id=auth.uid());
drop policy if exists notification_preferences_insert_own on public.notification_preferences;
create policy notification_preferences_insert_own on public.notification_preferences
  for insert to authenticated with check (user_id=auth.uid());
drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own on public.notification_preferences
  for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

grant select, insert, update on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;

create or replace function public.notification_category(p_type text)
returns text language sql immutable set search_path=public
as $$
  select case
    when coalesce(p_type,'') like 'message_%' or p_type='message' then 'message'
    when coalesce(p_type,'') like 'notice_worship_%' then 'worship'
    when coalesce(p_type,'') like 'edu_%' then 'education'
    when coalesce(p_type,'') like 'feedback_%' then 'feedback'
    when coalesce(p_type,'') like 'signup_%' then 'account'
    when coalesce(p_type,'') like 'dept_%' then 'department'
    when coalesce(p_type,'') like 'notice_%' or p_type='notice'
      or coalesce(p_type,'') like 'verse_%' then 'notice'
    else 'system'
  end
$$;

create or replace function public.notification_channel_allowed(
  p_user_id uuid, p_type text, p_channel text
)
returns boolean language sql stable security definer set search_path=public
as $$
  select coalesce((
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
    from public.notification_preferences np where np.user_id=p_user_id
  ), true)
$$;
revoke all on function public.notification_channel_allowed(uuid,text,text) from public;
grant execute on function public.notification_channel_allowed(uuid,text,text) to service_role;

create or replace function public.get_my_notification_preferences()
returns table(
  enabled boolean, push_enabled boolean, in_app_enabled boolean,
  message_enabled boolean, worship_enabled boolean, notice_enabled boolean,
  department_enabled boolean, education_enabled boolean, feedback_enabled boolean,
  account_enabled boolean, system_enabled boolean
)
language sql stable security definer set search_path=public
as $$
  select
    coalesce(np.enabled,true), coalesce(np.push_enabled,true), coalesce(np.in_app_enabled,true),
    coalesce(np.message_enabled,true), coalesce(np.worship_enabled,true), coalesce(np.notice_enabled,true),
    coalesce(np.department_enabled,true), coalesce(np.education_enabled,true), coalesce(np.feedback_enabled,true),
    coalesce(np.account_enabled,true), coalesce(np.system_enabled,true)
  from (select 1) seed
  left join public.notification_preferences np on np.user_id=auth.uid()
$$;
grant execute on function public.get_my_notification_preferences() to authenticated;

create or replace function public.set_my_notification_preferences(
  p_enabled boolean, p_push_enabled boolean, p_in_app_enabled boolean,
  p_message_enabled boolean, p_worship_enabled boolean, p_notice_enabled boolean,
  p_department_enabled boolean, p_education_enabled boolean, p_feedback_enabled boolean,
  p_account_enabled boolean, p_system_enabled boolean
)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  insert into public.notification_preferences(
    user_id,enabled,push_enabled,in_app_enabled,message_enabled,worship_enabled,
    notice_enabled,department_enabled,education_enabled,feedback_enabled,
    account_enabled,system_enabled,updated_at
  ) values(
    auth.uid(),coalesce(p_enabled,true),coalesce(p_push_enabled,true),coalesce(p_in_app_enabled,true),
    coalesce(p_message_enabled,true),coalesce(p_worship_enabled,true),coalesce(p_notice_enabled,true),
    coalesce(p_department_enabled,true),coalesce(p_education_enabled,true),coalesce(p_feedback_enabled,true),
    coalesce(p_account_enabled,true),coalesce(p_system_enabled,true),now()
  ) on conflict(user_id) do update set
    enabled=excluded.enabled,push_enabled=excluded.push_enabled,in_app_enabled=excluded.in_app_enabled,
    message_enabled=excluded.message_enabled,worship_enabled=excluded.worship_enabled,
    notice_enabled=excluded.notice_enabled,department_enabled=excluded.department_enabled,
    education_enabled=excluded.education_enabled,feedback_enabled=excluded.feedback_enabled,
    account_enabled=excluded.account_enabled,system_enabled=excluded.system_enabled,updated_at=now();
end;
$$;
grant execute on function public.set_my_notification_preferences(boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean) to authenticated;

create or replace function public.get_my_notifications(p_limit int default 30,p_only_unread boolean default false)
returns table(id uuid,type text,title text,body text,link_url text,is_read boolean,created_at timestamptz,metadata jsonb)
language sql stable security definer set search_path=public
as $$
  select n.id,n.type,n.title,n.body,n.link_url,n.is_read,n.created_at,n.metadata
  from public.notifications n
  where n.user_id=auth.uid()
    and public.notification_channel_allowed(n.user_id,n.type,'in_app')
    and (not p_only_unread or n.is_read=false)
  order by n.created_at desc limit p_limit
$$;
grant execute on function public.get_my_notifications(int,boolean) to authenticated;

create or replace function public.get_unread_count()
returns int language sql stable security definer set search_path=public
as $$
  select count(*)::int from public.notifications n
  where n.user_id=auth.uid() and n.is_read=false
    and public.notification_channel_allowed(n.user_id,n.type,'in_app')
$$;
grant execute on function public.get_unread_count() to authenticated;

create or replace function public.enqueue_notification_push_deliveries()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if not public.notification_channel_allowed(new.user_id,new.type,'push') then return new; end if;
  insert into public.notification_push_deliveries(notification_id,user_id,push_token_id,expo_push_token)
  select new.id,new.user_id,t.id,t.expo_push_token from public.user_push_tokens t
  where t.user_id=new.user_id and t.enabled=true
  on conflict(notification_id,expo_push_token) do nothing;
  return new;
end;
$$;
