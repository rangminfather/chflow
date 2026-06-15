-- Messenger operational controls: pin/favorite/mute/archive, block/report, forward, audit log.

alter table public.messenger_participants
  add column if not exists pinned_at timestamptz,
  add column if not exists favorite_at timestamptz;

create table if not exists public.messenger_user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.messenger_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.messenger_conversations(id) on delete set null,
  message_id uuid references public.messenger_messages(id) on delete set null,
  reported_user_id uuid references auth.users(id) on delete set null,
  reason text not null,
  note text,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create table if not exists public.messenger_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  conversation_id uuid references public.messenger_conversations(id) on delete set null,
  message_id uuid references public.messenger_messages(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_messenger_blocks_blocker
  on public.messenger_user_blocks(blocker_id, blocked_id);
create index if not exists idx_messenger_reports_status
  on public.messenger_reports(status, created_at desc);
create index if not exists idx_messenger_reports_reporter
  on public.messenger_reports(reporter_id, created_at desc);
create index if not exists idx_messenger_audit_conversation
  on public.messenger_audit_log(conversation_id, created_at desc);
create index if not exists idx_messenger_audit_actor
  on public.messenger_audit_log(actor_id, created_at desc);

alter table public.messenger_user_blocks enable row level security;
alter table public.messenger_reports enable row level security;
alter table public.messenger_audit_log enable row level security;

drop policy if exists messenger_blocks_select_own on public.messenger_user_blocks;
create policy messenger_blocks_select_own
  on public.messenger_user_blocks for select
  to authenticated
  using (blocker_id = auth.uid());

drop policy if exists messenger_reports_select_own_or_admin on public.messenger_reports;
create policy messenger_reports_select_own_or_admin
  on public.messenger_reports for select
  to authenticated
  using (reporter_id = auth.uid() or public.get_user_role() in ('admin', 'office', 'pastor'));

drop policy if exists messenger_audit_select_admin on public.messenger_audit_log;
create policy messenger_audit_select_admin
  on public.messenger_audit_log for select
  to authenticated
  using (public.get_user_role() in ('admin', 'office', 'pastor'));

create or replace function public.messenger_log_action(
  p_action text,
  p_conversation_id uuid default null,
  p_message_id uuid default null,
  p_target_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.messenger_audit_log (
    actor_id,
    action,
    conversation_id,
    message_id,
    target_user_id,
    metadata
  )
  values (
    auth.uid(),
    p_action,
    p_conversation_id,
    p_message_id,
    p_target_user_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
$$;

grant execute on function public.messenger_log_action(text, uuid, uuid, uuid, jsonb) to authenticated;

create or replace function public.set_messenger_conversation_state(
  p_conversation_id uuid,
  p_pinned boolean default null,
  p_favorite boolean default null,
  p_muted boolean default null,
  p_archived boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  perform public.messenger_require_active_user();

  select exists (
    select 1 from public.messenger_participants
    where conversation_id = p_conversation_id
      and user_id = auth.uid()
  ) into v_exists;

  if not v_exists then
    raise exception 'No access to this conversation';
  end if;

  update public.messenger_participants
  set
    pinned_at = case
      when p_pinned is null then pinned_at
      when p_pinned then coalesce(pinned_at, now())
      else null
    end,
    favorite_at = case
      when p_favorite is null then favorite_at
      when p_favorite then coalesce(favorite_at, now())
      else null
    end,
    muted_until = case
      when p_muted is null then muted_until
      when p_muted then 'infinity'::timestamptz
      else null
    end,
    archived_at = case
      when p_archived is null then archived_at
      when p_archived then now()
      else null
    end
  where conversation_id = p_conversation_id
    and user_id = auth.uid();

  perform public.messenger_log_action(
    'conversation_state',
    p_conversation_id,
    null,
    null,
    jsonb_build_object(
      'pinned', p_pinned,
      'favorite', p_favorite,
      'muted', p_muted,
      'archived', p_archived
    )
  );
end;
$$;

grant execute on function public.set_messenger_conversation_state(uuid, boolean, boolean, boolean, boolean) to authenticated;

create or replace function public.block_messenger_user(
  p_user_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.messenger_require_active_user();

  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Choose another user';
  end if;

  insert into public.messenger_user_blocks (blocker_id, blocked_id, reason)
  values (auth.uid(), p_user_id, nullif(trim(coalesce(p_reason, '')), ''))
  on conflict (blocker_id, blocked_id)
  do update set reason = excluded.reason, created_at = now();

  perform public.messenger_log_action('user_block', null, null, p_user_id, '{}'::jsonb);
end;
$$;

grant execute on function public.block_messenger_user(uuid, text) to authenticated;

create or replace function public.unblock_messenger_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.messenger_require_active_user();

  delete from public.messenger_user_blocks
  where blocker_id = auth.uid()
    and blocked_id = p_user_id;

  perform public.messenger_log_action('user_unblock', null, null, p_user_id, '{}'::jsonb);
end;
$$;

grant execute on function public.unblock_messenger_user(uuid) to authenticated;

create or replace function public.report_messenger_message(
  p_message_id uuid,
  p_reason text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
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
    reporter_id,
    conversation_id,
    message_id,
    reported_user_id,
    reason,
    note
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
    'message_report',
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

create or replace function public.forward_messenger_message(
  p_message_id uuid,
  p_target_conversation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messenger_messages;
  v_new_id uuid;
  v_attachments jsonb;
begin
  perform public.messenger_require_active_user();

  select * into v_msg from public.messenger_messages where id = p_message_id;
  if not found or v_msg.deleted_at is not null then
    raise exception 'Message not found';
  end if;

  if not public.is_messenger_participant(v_msg.conversation_id, auth.uid())
    or not public.is_messenger_participant(p_target_conversation_id, auth.uid())
  then
    raise exception 'No access to forward this message';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'file_path', a.file_path,
    'file_name', a.file_name,
    'mime_type', a.mime_type,
    'size_bytes', a.size_bytes,
    'width', a.width,
    'height', a.height
  ) order by a.position), '[]'::jsonb)
  into v_attachments
  from public.messenger_message_attachments a
  where a.message_id = p_message_id;

  v_new_id := public.send_messenger_message_v2(
    p_target_conversation_id,
    case
      when coalesce(v_msg.body, '') = '' then ''
      else '전달: ' || v_msg.body
    end,
    null,
    v_attachments
  );

  perform public.messenger_log_action(
    'message_forward',
    p_target_conversation_id,
    v_new_id,
    null,
    jsonb_build_object('source_message_id', p_message_id, 'source_conversation_id', v_msg.conversation_id)
  );

  return v_new_id;
end;
$$;

grant execute on function public.forward_messenger_message(uuid, uuid) to authenticated;

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
  archived_at timestamptz
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
      when c.type = 'direct' then coalesce(pt.other_name, 'Messenger')
      else coalesce(c.title, pt.other_names, 'Group chat')
    end as display_title,
    case when c.type = 'direct' then pt.other_avatar_url else null end as display_avatar_url,
    coalesce(pt.participant_count, 0) as participant_count,
    lm.id as last_message_id,
    case
      when lm.deleted_at is not null then '삭제된 메시지입니다'
      when coalesce(nullif(lm.body, ''), '') <> '' then lm.body
      when exists (select 1 from public.messenger_message_attachments a where a.message_id = lm.id and a.mime_type ilike 'image/%') then '사진을 보냈습니다'
      when exists (select 1 from public.messenger_message_attachments a where a.message_id = lm.id) then '첨부파일을 보냈습니다'
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
    mine.archived_at
  from mine
  join public.messenger_conversations c on c.id = mine.conversation_id
  left join participants pt on pt.conversation_id = c.id
  left join public.messenger_messages lm on lm.id = c.last_message_id
  left join public.profiles sp on sp.id = lm.sender_id
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
