-- Messenger reactions, stronger block enforcement, leave flow, and report operations.

alter table public.messenger_message_attachments
  drop constraint if exists messenger_message_attachments_file_path_key;

create index if not exists idx_messenger_attachments_file_path
  on public.messenger_message_attachments(file_path);

create table if not exists public.messenger_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messenger_messages(id) on delete cascade,
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists idx_messenger_reactions_message
  on public.messenger_message_reactions(message_id, emoji);
create index if not exists idx_messenger_reactions_conversation
  on public.messenger_message_reactions(conversation_id, created_at desc);

alter table public.messenger_message_reactions enable row level security;

drop policy if exists messenger_reactions_select_participant on public.messenger_message_reactions;
create policy messenger_reactions_select_participant
  on public.messenger_message_reactions for select
  to authenticated
  using (public.is_messenger_participant(conversation_id, auth.uid()));

create or replace function public.messenger_direct_blocked(
  p_user_a uuid,
  p_user_b uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.messenger_user_blocks b
    where (b.blocker_id = p_user_a and b.blocked_id = p_user_b)
       or (b.blocker_id = p_user_b and b.blocked_id = p_user_a)
  );
$$;

grant execute on function public.messenger_direct_blocked(uuid, uuid) to authenticated;

create or replace function public.start_direct_message(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_key text;
begin
  perform public.messenger_require_active_user();

  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Choose another user';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_user_id and status = 'active'
  ) then
    raise exception 'Recipient is not active';
  end if;

  if public.messenger_direct_blocked(auth.uid(), p_user_id) then
    raise exception 'This conversation is blocked';
  end if;

  v_key := least(auth.uid()::text, p_user_id::text) || ':' || greatest(auth.uid()::text, p_user_id::text);

  select id into v_conversation_id
  from public.messenger_conversations
  where type = 'direct' and direct_key = v_key;

  if v_conversation_id is null then
    insert into public.messenger_conversations (type, direct_key, created_by)
    values ('direct', v_key, auth.uid())
    returning id into v_conversation_id;

    insert into public.messenger_participants (conversation_id, user_id, role, last_read_at)
    values
      (v_conversation_id, auth.uid(), 'owner', now()),
      (v_conversation_id, p_user_id, 'member', null);
  else
    insert into public.messenger_participants (conversation_id, user_id, role, last_read_at)
    values (v_conversation_id, auth.uid(), 'member', now())
    on conflict (conversation_id, user_id)
    do update set archived_at = null;
  end if;

  return v_conversation_id;
end;
$$;

grant execute on function public.start_direct_message(uuid) to authenticated;

create or replace function public.send_messenger_message_v2(
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
  v_message_id uuid;
  v_body text;
  v_sender_name text;
  v_att jsonb;
  v_idx int := 0;
  v_has_attachments boolean := false;
  v_preview text;
  v_conversation_type text;
begin
  perform public.messenger_require_active_user();

  select type into v_conversation_type
  from public.messenger_conversations
  where id = p_conversation_id;

  if not found or not public.is_messenger_participant(p_conversation_id, auth.uid()) then
    raise exception 'No access to this conversation';
  end if;

  if v_conversation_type = 'direct' and exists (
    select 1
    from public.messenger_participants mp
    where mp.conversation_id = p_conversation_id
      and mp.user_id <> auth.uid()
      and public.messenger_direct_blocked(auth.uid(), mp.user_id)
  ) then
    raise exception 'This conversation is blocked';
  end if;

  if p_reply_to_id is not null and not exists (
    select 1
    from public.messenger_messages
    where id = p_reply_to_id
      and conversation_id = p_conversation_id
      and deleted_at is null
  ) then
    raise exception 'Reply target is not available';
  end if;

  v_body := nullif(trim(coalesce(p_body, '')), '');
  v_has_attachments := jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0;

  if v_body is null and not v_has_attachments then
    raise exception 'Message body or attachment is required';
  end if;

  if length(coalesce(v_body, '')) > 4000 then
    raise exception 'Message is too long';
  end if;

  insert into public.messenger_messages (conversation_id, sender_id, body, reply_to_id)
  values (p_conversation_id, auth.uid(), coalesce(v_body, ''), p_reply_to_id)
  returning id into v_message_id;

  if v_has_attachments then
    for v_att in select * from jsonb_array_elements(p_attachments)
    loop
      if coalesce(v_att->>'file_path', '') = ''
        or (string_to_array(v_att->>'file_path', '/'))[1] is distinct from auth.uid()::text
      then
        raise exception 'Invalid attachment path';
      end if;

      insert into public.messenger_message_attachments (
        message_id,
        conversation_id,
        file_path,
        file_name,
        mime_type,
        size_bytes,
        width,
        height,
        position,
        uploaded_by
      )
      values (
        v_message_id,
        p_conversation_id,
        v_att->>'file_path',
        coalesce(nullif(v_att->>'file_name', ''), 'attachment'),
        v_att->>'mime_type',
        nullif(v_att->>'size_bytes', '')::int,
        nullif(v_att->>'width', '')::int,
        nullif(v_att->>'height', '')::int,
        v_idx,
        auth.uid()
      );
      v_idx := v_idx + 1;
    end loop;
  end if;

  update public.messenger_conversations
  set last_message_id = v_message_id,
      updated_at = now()
  where id = p_conversation_id;

  update public.messenger_participants
  set last_read_at = now(),
      archived_at = null
  where conversation_id = p_conversation_id
    and user_id = auth.uid();

  select coalesce(name, 'Messenger') into v_sender_name
  from public.profiles
  where id = auth.uid();

  v_preview := case
    when v_body is not null then left(v_body, 120)
    when v_has_attachments then 'Attachment sent'
    else ''
  end;

  insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
  select
    mp.user_id,
    'message_new',
    v_sender_name,
    v_preview,
    '/messenger?c=' || p_conversation_id::text,
    auth.uid(),
    jsonb_build_object(
      'conversation_id', p_conversation_id,
      'message_id', v_message_id,
      'sender_id', auth.uid()
    )
  from public.messenger_participants mp
  where mp.conversation_id = p_conversation_id
    and mp.user_id <> auth.uid()
    and (mp.muted_until is null or mp.muted_until < now())
    and not exists (
      select 1
      from public.messenger_user_blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = mp.user_id)
         or (b.blocker_id = mp.user_id and b.blocked_id = auth.uid())
    );

  return v_message_id;
end;
$$;

grant execute on function public.send_messenger_message_v2(uuid, text, uuid, jsonb) to authenticated;

drop function if exists public.get_messenger_messages_v2(uuid, int, timestamptz);

create or replace function public.get_messenger_messages_v2(
  p_conversation_id uuid,
  p_limit int default 50,
  p_before timestamptz default null
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  sender_name text,
  sender_avatar_url text,
  body text,
  kind text,
  reply_to_id uuid,
  reply_to jsonb,
  attachments jsonb,
  read_by jsonb,
  reactions jsonb,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  is_mine boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    msg.id,
    msg.conversation_id,
    msg.sender_id,
    p.name as sender_name,
    coalesce(p.avatar_url, m.photo_url) as sender_avatar_url,
    case when msg.deleted_at is null then msg.body else 'Deleted message' end as body,
    msg.kind,
    msg.reply_to_id,
    case
      when rt.id is null then null
      else jsonb_build_object(
        'id', rt.id,
        'sender_id', rt.sender_id,
        'sender_name', rtp.name,
        'body', case when rt.deleted_at is null then rt.body else 'Deleted message' end,
        'deleted_at', rt.deleted_at
      )
    end as reply_to,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'file_path', a.file_path,
        'file_name', a.file_name,
        'mime_type', a.mime_type,
        'size_bytes', a.size_bytes,
        'width', a.width,
        'height', a.height
      ) order by a.position)
      from public.messenger_message_attachments a
      where a.message_id = msg.id
    ), '[]'::jsonb) as attachments,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', rp.user_id,
        'name', pr.name,
        'read_at', rp.last_read_at
      ) order by pr.name)
      from public.messenger_participants rp
      join public.profiles pr on pr.id = rp.user_id
      where rp.conversation_id = msg.conversation_id
        and rp.user_id <> msg.sender_id
        and rp.last_read_at is not null
        and rp.last_read_at >= msg.created_at
    ), '[]'::jsonb) as read_by,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'emoji', grouped.emoji,
        'count', grouped.reaction_count,
        'mine', grouped.mine,
        'names', grouped.names
      ) order by grouped.reaction_count desc, grouped.emoji)
      from (
        select
          r.emoji,
          count(*)::int as reaction_count,
          bool_or(r.user_id = auth.uid()) as mine,
          array_remove(array_agg(coalesce(rp.name, 'User') order by r.created_at), null) as names
        from public.messenger_message_reactions r
        left join public.profiles rp on rp.id = r.user_id
        where r.message_id = msg.id
        group by r.emoji
      ) grouped
    ), '[]'::jsonb) as reactions,
    msg.created_at,
    msg.edited_at,
    msg.deleted_at,
    msg.sender_id = auth.uid() as is_mine
  from public.messenger_messages msg
  join public.profiles p on p.id = msg.sender_id
  left join public.members m on m.id = p.member_id
  left join public.messenger_messages rt on rt.id = msg.reply_to_id
  left join public.profiles rtp on rtp.id = rt.sender_id
  where msg.conversation_id = p_conversation_id
    and public.is_messenger_participant(p_conversation_id, auth.uid())
    and (p_before is null or msg.created_at < p_before)
  order by msg.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

grant execute on function public.get_messenger_messages_v2(uuid, int, timestamptz) to authenticated;

create or replace function public.toggle_messenger_reaction(
  p_message_id uuid,
  p_emoji text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messenger_messages;
  v_emoji text;
begin
  perform public.messenger_require_active_user();

  v_emoji := left(nullif(trim(coalesce(p_emoji, '')), ''), 16);
  if v_emoji is null then
    raise exception 'Reaction is required';
  end if;

  select * into v_msg
  from public.messenger_messages
  where id = p_message_id;

  if not found or v_msg.deleted_at is not null then
    raise exception 'Message not found';
  end if;

  if not public.is_messenger_participant(v_msg.conversation_id, auth.uid()) then
    raise exception 'No access to this message';
  end if;

  if exists (
    select 1
    from public.messenger_message_reactions
    where message_id = p_message_id
      and user_id = auth.uid()
      and emoji = v_emoji
  ) then
    delete from public.messenger_message_reactions
    where message_id = p_message_id
      and user_id = auth.uid()
      and emoji = v_emoji;
  else
    insert into public.messenger_message_reactions (
      message_id,
      conversation_id,
      user_id,
      emoji
    )
    values (
      v_msg.id,
      v_msg.conversation_id,
      auth.uid(),
      v_emoji
    );
  end if;

  update public.messenger_conversations
  set updated_at = now()
  where id = v_msg.conversation_id;

  perform public.messenger_log_action(
    'message_reaction',
    v_msg.conversation_id,
    v_msg.id,
    null,
    jsonb_build_object('emoji', v_emoji)
  );
end;
$$;

grant execute on function public.toggle_messenger_reaction(uuid, text) to authenticated;

create or replace function public.leave_messenger_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_type text;
  v_remaining_count int;
  v_new_owner uuid;
begin
  perform public.messenger_require_active_user();

  select type into v_conversation_type
  from public.messenger_conversations
  where id = p_conversation_id;

  if not found or not public.is_messenger_participant(p_conversation_id, auth.uid()) then
    raise exception 'No access to this conversation';
  end if;

  if v_conversation_type = 'direct' then
    update public.messenger_participants
    set archived_at = now()
    where conversation_id = p_conversation_id
      and user_id = auth.uid();
  else
    delete from public.messenger_participants
    where conversation_id = p_conversation_id
      and user_id = auth.uid();

    select count(*)::int into v_remaining_count
    from public.messenger_participants
    where conversation_id = p_conversation_id;

    if v_remaining_count = 0 then
      delete from public.messenger_conversations
      where id = p_conversation_id;
    else
      select user_id into v_new_owner
      from public.messenger_participants
      where conversation_id = p_conversation_id
      order by joined_at
      limit 1;

      update public.messenger_participants
      set role = 'owner'
      where conversation_id = p_conversation_id
        and user_id = v_new_owner
        and not exists (
          select 1
          from public.messenger_participants owner_check
          where owner_check.conversation_id = p_conversation_id
            and owner_check.role = 'owner'
        );

      update public.messenger_conversations
      set updated_at = now()
      where id = p_conversation_id;
    end if;
  end if;

  perform public.messenger_log_action(
    'conversation_leave',
    case
      when v_conversation_type = 'group' and coalesce(v_remaining_count, 1) = 0 then null
      else p_conversation_id
    end,
    null,
    auth.uid(),
    jsonb_build_object('conversation_type', v_conversation_type)
  );
end;
$$;

grant execute on function public.leave_messenger_conversation(uuid) to authenticated;

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
  v_body text;
  v_sender_name text;
  v_target_type text;
begin
  perform public.messenger_require_active_user();

  select * into v_msg from public.messenger_messages where id = p_message_id;
  if not found or v_msg.deleted_at is not null then
    raise exception 'Message not found';
  end if;

  select type into v_target_type
  from public.messenger_conversations
  where id = p_target_conversation_id;

  if not public.is_messenger_participant(v_msg.conversation_id, auth.uid())
    or not public.is_messenger_participant(p_target_conversation_id, auth.uid())
  then
    raise exception 'No access to forward this message';
  end if;

  if v_target_type = 'direct' and exists (
    select 1
    from public.messenger_participants mp
    where mp.conversation_id = p_target_conversation_id
      and mp.user_id <> auth.uid()
      and public.messenger_direct_blocked(auth.uid(), mp.user_id)
  ) then
    raise exception 'This conversation is blocked';
  end if;

  v_body := case
    when coalesce(v_msg.body, '') = '' then 'Forwarded attachment'
    else 'Forwarded: ' || v_msg.body
  end;

  insert into public.messenger_messages (conversation_id, sender_id, body)
  values (p_target_conversation_id, auth.uid(), left(v_body, 4000))
  returning id into v_new_id;

  insert into public.messenger_message_attachments (
    message_id,
    conversation_id,
    file_path,
    file_name,
    mime_type,
    size_bytes,
    width,
    height,
    position,
    uploaded_by
  )
  select
    v_new_id,
    p_target_conversation_id,
    a.file_path,
    a.file_name,
    a.mime_type,
    a.size_bytes,
    a.width,
    a.height,
    a.position,
    a.uploaded_by
  from public.messenger_message_attachments a
  where a.message_id = p_message_id
  order by a.position;

  update public.messenger_conversations
  set last_message_id = v_new_id,
      updated_at = now()
  where id = p_target_conversation_id;

  update public.messenger_participants
  set last_read_at = now(),
      archived_at = null
  where conversation_id = p_target_conversation_id
    and user_id = auth.uid();

  select coalesce(name, 'Messenger') into v_sender_name
  from public.profiles
  where id = auth.uid();

  insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
  select
    mp.user_id,
    'message_new',
    v_sender_name,
    left(v_body, 120),
    '/messenger?c=' || p_target_conversation_id::text,
    auth.uid(),
    jsonb_build_object(
      'conversation_id', p_target_conversation_id,
      'message_id', v_new_id,
      'sender_id', auth.uid(),
      'forwarded_from', p_message_id
    )
  from public.messenger_participants mp
  where mp.conversation_id = p_target_conversation_id
    and mp.user_id <> auth.uid()
    and (mp.muted_until is null or mp.muted_until < now())
    and not exists (
      select 1
      from public.messenger_user_blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = mp.user_id)
         or (b.blocker_id = mp.user_id and b.blocked_id = auth.uid())
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

create or replace function public.list_messenger_reports(
  p_status text default 'open',
  p_limit int default 50
)
returns table (
  report_id uuid,
  status text,
  reason text,
  note text,
  created_at timestamptz,
  resolved_at timestamptz,
  conversation_id uuid,
  message_id uuid,
  message_body text,
  reporter_id uuid,
  reporter_name text,
  reported_user_id uuid,
  reported_user_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id as report_id,
    r.status,
    r.reason,
    r.note,
    r.created_at,
    r.resolved_at,
    r.conversation_id,
    r.message_id,
    msg.body as message_body,
    r.reporter_id,
    reporter.name as reporter_name,
    r.reported_user_id,
    reported.name as reported_user_name
  from public.messenger_reports r
  left join public.messenger_messages msg on msg.id = r.message_id
  left join public.profiles reporter on reporter.id = r.reporter_id
  left join public.profiles reported on reported.id = r.reported_user_id
  where public.get_user_role() in ('admin', 'office', 'pastor')
    and (
      coalesce(trim(p_status), '') = ''
      or r.status = p_status
    )
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

grant execute on function public.list_messenger_reports(text, int) to authenticated;

create or replace function public.resolve_messenger_report(
  p_report_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public.messenger_require_active_user();

  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception 'Admin permission is required';
  end if;

  v_status := lower(trim(coalesce(p_status, '')));
  if v_status not in ('open', 'reviewing', 'resolved', 'dismissed') then
    raise exception 'Invalid report status';
  end if;

  update public.messenger_reports
  set status = v_status,
      note = nullif(trim(coalesce(p_note, note, '')), ''),
      resolved_at = case when v_status in ('resolved', 'dismissed') then now() else null end,
      resolved_by = case when v_status in ('resolved', 'dismissed') then auth.uid() else null end
  where id = p_report_id;

  if not found then
    raise exception 'Report not found';
  end if;

  perform public.messenger_log_action(
    'message_report_resolve',
    null,
    null,
    null,
    jsonb_build_object('report_id', p_report_id, 'status', v_status)
  );
end;
$$;

grant execute on function public.resolve_messenger_report(uuid, text, text) to authenticated;

do $$
begin
  alter table public.messenger_message_reactions replica identity full;

  begin
    alter publication supabase_realtime add table public.messenger_message_reactions;
  exception when duplicate_object then null;
  end;
exception when undefined_object then
  null;
end $$;
