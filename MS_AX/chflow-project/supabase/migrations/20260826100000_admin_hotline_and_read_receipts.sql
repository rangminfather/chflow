-- Daily administrator hotline conversations and accurate messenger read state support.

alter table public.messenger_conversations
  add column if not exists channel_kind text not null default 'standard'
    check (channel_kind in ('standard', 'admin_hotline')),
  add column if not exists hotline_owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists hotline_session_date date;

create unique index if not exists idx_messenger_hotline_owner_session
  on public.messenger_conversations(hotline_owner_id, hotline_session_date)
  where channel_kind = 'admin_hotline';

create index if not exists idx_messenger_hotline_retention
  on public.messenger_conversations(hotline_session_date)
  where channel_kind = 'admin_hotline';

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

  insert into public.messenger_participants (conversation_id, user_id, role, last_read_at)
  select
    v_conversation_id,
    p.id,
    'member',
    null
  from public.profiles p
  where p.status = 'active'
    and p.role in ('admin', 'office', 'pastor')
    and p.id <> auth.uid()
  on conflict (conversation_id, user_id) do nothing;

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

drop function if exists public.get_messenger_unread_count();
drop function if exists public.list_messenger_conversations();

create or replace function public.list_messenger_conversations()
returns table (
  conversation_id uuid,
  type text,
  title text,
  display_title text,
  display_avatar_url text,
  participant_count int,
  last_message_id uuid,
  last_message_body text,
  last_message_at timestamptz,
  last_sender_id uuid,
  last_sender_name text,
  unread_count int,
  updated_at timestamptz,
  is_pinned boolean,
  is_favorite boolean,
  is_muted boolean,
  archived_at timestamptz,
  channel_kind text,
  hotline_session_date date
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select
      mp.conversation_id,
      mp.last_read_at,
      mp.pinned_at,
      mp.favorite_at,
      mp.muted_until,
      mp.archived_at
    from public.messenger_participants mp
    where mp.user_id = auth.uid()
      and mp.archived_at is null
  ),
  participants as (
    select
      mp.conversation_id,
      count(*)::int as participant_count,
      max(p.name) filter (where mp.user_id <> auth.uid()) as other_name,
      max(coalesce(p.avatar_url, m.photo_url)) filter (where mp.user_id <> auth.uid()) as other_avatar_url,
      string_agg(p.name, ', ' order by p.name) filter (where mp.user_id <> auth.uid()) as other_names
    from public.messenger_participants mp
    join public.profiles p on p.id = mp.user_id
    left join public.members m on m.id = p.member_id
    group by mp.conversation_id
  )
  select
    c.id as conversation_id,
    c.type,
    c.title,
    case
      when c.channel_kind = 'admin_hotline' and c.hotline_owner_id <> auth.uid() then
        '관리자 핫라인 · ' || coalesce(hp.name, '사용자') || ' · ' || to_char(c.hotline_session_date, 'YYYY.MM.DD')
      when c.channel_kind = 'admin_hotline' then coalesce(c.title, '관리자 핫라인')
      when c.type = 'direct' then coalesce(pt.other_name, 'Messenger')
      else coalesce(c.title, pt.other_names, 'Group chat')
    end as display_title,
    case
      when c.channel_kind = 'admin_hotline' then null
      when c.type = 'direct' then pt.other_avatar_url
      else null
    end as display_avatar_url,
    coalesce(pt.participant_count, 0) as participant_count,
    lm.id as last_message_id,
    case
      when lm.deleted_at is not null then '삭제된 메시지입니다'
      when coalesce(nullif(lm.body, ''), '') <> '' then lm.body
      when exists (select 1 from public.messenger_message_attachments a where a.message_id = lm.id and a.mime_type ilike 'image/%') then '사진을 보냈습니다'
      when exists (select 1 from public.messenger_message_attachments a where a.message_id = lm.id) then '첨부 파일을 보냈습니다'
      else null
    end as last_message_body,
    lm.created_at as last_message_at,
    lm.sender_id as last_sender_id,
    sp.name as last_sender_name,
    (
      select count(*)::int
      from public.messenger_messages msg
      where msg.conversation_id = c.id
        and msg.sender_id <> auth.uid()
        and msg.deleted_at is null
        and (mine.last_read_at is null or msg.created_at > mine.last_read_at)
    ) as unread_count,
    c.updated_at,
    mine.pinned_at is not null as is_pinned,
    mine.favorite_at is not null as is_favorite,
    mine.muted_until is not null and mine.muted_until > now() as is_muted,
    mine.archived_at,
    c.channel_kind,
    c.hotline_session_date
  from mine
  join public.messenger_conversations c on c.id = mine.conversation_id
  left join participants pt on pt.conversation_id = c.id
  left join public.messenger_messages lm on lm.id = c.last_message_id
  left join public.profiles sp on sp.id = lm.sender_id
  left join public.profiles hp on hp.id = c.hotline_owner_id
  where c.channel_kind <> 'admin_hotline'
    or c.hotline_session_date >= ((now() at time zone 'Asia/Seoul')::date - 30)
  order by
    mine.pinned_at desc nulls last,
    c.updated_at desc;
$$;

grant execute on function public.list_messenger_conversations() to authenticated;

create or replace function public.get_messenger_unread_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(unread_count), 0)::int
  from public.list_messenger_conversations();
$$;

grant execute on function public.get_messenger_unread_count() to authenticated;
