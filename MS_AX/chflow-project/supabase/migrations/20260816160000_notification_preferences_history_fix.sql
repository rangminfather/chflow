-- 알림 설정이 "알림 이력 숨김"으로 동작하던 문제 수정.
--
-- 20260816130000 에서 get_my_notifications / get_unread_count 에
-- notification_channel_allowed(..., 'in_app') 필터를 걸었더니,
-- 사용자가 "앱 내 알림"을 끄는 순간 이미 받아둔 알림 이력까지 통째로
-- 조회에서 빠져 "알림이 전부 사라졌다" 로 보였다. (데이터는 남아 있었음)
--
-- 수정 후 원칙:
--   - 알림 이력(목록)과 안읽음 개수는 설정과 무관하게 항상 실제 데이터를 보여준다.
--   - 설정은 "새 알림을 어떻게 전달할지"만 제어한다.
--       push   → 트리거 + push-dispatch (휴대폰 상단바)
--       in_app → 클라이언트 토스트 팝업 (NotificationBell)
--   - 푸시가 설정으로 차단된 경우에도 delivery 행을 'skipped' 로 남겨
--     "왜 안 왔는지" 추적할 수 있게 한다. (기존에는 아무 흔적도 안 남았다)

-- 1) 알림 목록 — 설정 필터 제거
create or replace function public.get_my_notifications(p_limit int default 30,p_only_unread boolean default false)
returns table(id uuid,type text,title text,body text,link_url text,is_read boolean,created_at timestamptz,metadata jsonb)
language sql stable security definer set search_path=public
as $$
  select n.id,n.type,n.title,n.body,n.link_url,n.is_read,n.created_at,n.metadata
  from public.notifications n
  where n.user_id=auth.uid()
    and (not p_only_unread or n.is_read=false)
  order by n.created_at desc limit p_limit
$$;
grant execute on function public.get_my_notifications(int,boolean) to authenticated;

-- 2) 안읽음 개수 — 설정 필터 제거 (휴대폰 배지 숫자와 앱 배지 숫자를 일치시킨다)
create or replace function public.get_unread_count()
returns int language sql stable security definer set search_path=public
as $$
  select count(*)::int from public.notifications n
  where n.user_id=auth.uid() and n.is_read=false
$$;
grant execute on function public.get_unread_count() to authenticated;

-- 3) 푸시 큐 — 차단돼도 'skipped' 행을 남겨 추적 가능하게
create or replace function public.enqueue_notification_push_deliveries()
returns trigger language plpgsql security definer set search_path=public
as $$
declare
  v_allowed boolean;
begin
  v_allowed := public.notification_channel_allowed(new.user_id,new.type,'push');

  insert into public.notification_push_deliveries(
    notification_id,user_id,push_token_id,expo_push_token,status,error_message
  )
  select
    new.id,new.user_id,t.id,t.expo_push_token,
    case when v_allowed then 'queued' else 'skipped' end,
    case when v_allowed then null else '사용자 알림 설정으로 푸시 차단됨' end
  from public.user_push_tokens t
  where t.user_id=new.user_id and t.enabled=true
  on conflict(notification_id,expo_push_token) do nothing;

  return new;
end;
$$;
