-- Keep a hotline private until the requester sends the first real message.

create or replace function public.open_admin_hotline()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_session_date date := (now() at time zone 'Asia/Seoul')::date;
  v_guide_sender_id uuid;
  v_guide_message_id uuid;
  v_guide text := '안녕하세요 스마트명성 관리자입니다. 문의시간은 평일 오전9시에서 오후6시에 통상 답변드리며, 주말에도 활동 시 답변드리도록 노력하겠습니다.';
begin
  perform public.messenger_require_active_user();

  if public.get_user_role() in ('admin', 'office', 'pastor') then
    raise exception '관리자 계정은 핫라인 접수 목록을 이용해 주세요.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || v_session_date::text, 0));

  select c.id
  into v_conversation_id
  from public.messenger_conversations c
  where c.channel_kind = 'admin_hotline'
    and c.hotline_owner_id = auth.uid()
    and c.hotline_session_date = v_session_date;

  if v_conversation_id is not null then
    update public.messenger_participants
    set archived_at = null
    where conversation_id = v_conversation_id
      and user_id = auth.uid();
    return v_conversation_id;
  end if;

  select p.id
  into v_guide_sender_id
  from public.profiles p
  where p.status = 'active'
    and p.role in ('admin', 'office', 'pastor')
    and p.id <> auth.uid()
  order by
    case when lower(coalesce(p.username, '')) = 'clyawy' then 1 else 0 end,
    case p.role when 'admin' then 0 when 'office' then 1 else 2 end,
    p.created_at,
    p.id
  limit 1;

  if v_guide_sender_id is null then
    raise exception '현재 핫라인에 연결할 수 있는 관리자가 없습니다.';
  end if;

  insert into public.messenger_conversations (
    type,
    title,
    created_by,
    channel_kind,
    hotline_owner_id,
    hotline_session_date
  ) values (
    'group',
    '관리자 핫라인 · ' || to_char(v_session_date, 'YYYY.MM.DD'),
    auth.uid(),
    'admin_hotline',
    auth.uid(),
    v_session_date
  )
  returning id into v_conversation_id;

  insert into public.messenger_participants (conversation_id, user_id, role, last_read_at)
  values (v_conversation_id, auth.uid(), 'owner', now());

  insert into public.messenger_messages (conversation_id, sender_id, kind, body)
  values (v_conversation_id, v_guide_sender_id, 'system', v_guide)
  returning id into v_guide_message_id;

  update public.messenger_conversations
  set last_message_id = v_guide_message_id,
      updated_at = now()
  where id = v_conversation_id;

  update public.messenger_participants
  set last_read_at = now()
  where conversation_id = v_conversation_id
    and user_id = auth.uid();

  return v_conversation_id;
end;
$$;

grant execute on function public.open_admin_hotline() to authenticated;

create or replace function public.send_admin_hotline_message_v2(
  p_conversation_id uuid,
  p_body text default '',
  p_reply_to_id uuid default null,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_before_message_at timestamptz;
  v_message_id uuid;
begin
  perform public.messenger_require_active_user();

  select c.hotline_owner_id, c.updated_at
  into v_owner_id, v_before_message_at
  from public.messenger_conversations c
  where c.id = p_conversation_id
    and c.channel_kind = 'admin_hotline';

  if v_owner_id is null then
    raise exception '관리자 핫라인 대화가 아닙니다.';
  end if;

  if auth.uid() = v_owner_id then
    insert into public.messenger_participants (conversation_id, user_id, role, last_read_at)
    select
      p_conversation_id,
      p.id,
      'member',
      v_before_message_at
    from public.profiles p
    where p.status = 'active'
      and p.role in ('admin', 'office', 'pastor')
      and p.id <> auth.uid()
    on conflict (conversation_id, user_id) do nothing;
  elsif not public.is_messenger_participant(p_conversation_id, auth.uid()) then
    raise exception '이 핫라인 대화에 접근할 수 없습니다.';
  end if;

  v_message_id := public.send_messenger_message_v2(
    p_conversation_id,
    p_body,
    p_reply_to_id,
    p_attachments
  );

  return v_message_id;
end;
$$;

revoke all on function public.send_admin_hotline_message_v2(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.send_admin_hotline_message_v2(uuid, text, uuid, jsonb) to authenticated;

-- The first migration was briefly live before this correction. Hide untouched rooms
-- from operators again; any room with a real text message remains connected.
delete from public.messenger_participants mp
using public.messenger_conversations c
where mp.conversation_id = c.id
  and c.channel_kind = 'admin_hotline'
  and mp.user_id <> c.hotline_owner_id
  and not exists (
    select 1
    from public.messenger_messages msg
    where msg.conversation_id = c.id
      and msg.kind = 'text'
      and msg.deleted_at is null
  );
