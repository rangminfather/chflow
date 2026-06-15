-- Messenger commercial upgrade: attachments, replies, edit/delete, read receipts.

alter table public.messenger_messages
  add column if not exists reply_to_id uuid references public.messenger_messages(id) on delete set null;

create table if not exists public.messenger_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messenger_messages(id) on delete cascade,
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  file_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes int,
  width int,
  height int,
  position int not null default 0,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_messenger_attachments_message
  on public.messenger_message_attachments(message_id, position);
create index if not exists idx_messenger_attachments_conversation
  on public.messenger_message_attachments(conversation_id, created_at desc);
create index if not exists idx_messenger_messages_reply
  on public.messenger_messages(reply_to_id);

alter table public.messenger_message_attachments enable row level security;

drop policy if exists messenger_attachments_select_participant on public.messenger_message_attachments;
create policy messenger_attachments_select_participant
  on public.messenger_message_attachments for select
  to authenticated
  using (public.is_messenger_participant(conversation_id, auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'messenger-attachments',
  'messenger-attachments',
  false,
  26214400,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists messenger_attach_upload_own_folder on storage.objects;
create policy messenger_attach_upload_own_folder
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'messenger-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists messenger_attach_update_own_folder on storage.objects;
create policy messenger_attach_update_own_folder
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'messenger-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'messenger-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists messenger_attach_delete_own_folder on storage.objects;
create policy messenger_attach_delete_own_folder
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'messenger-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

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
begin
  perform public.messenger_require_active_user();

  if not public.is_messenger_participant(p_conversation_id, auth.uid()) then
    raise exception 'No access to this conversation';
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
    when v_has_attachments then '첨부파일을 보냈습니다'
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
    and (
      mp.muted_until is null
      or mp.muted_until < now()
    );

  return v_message_id;
end;
$$;

grant execute on function public.send_messenger_message_v2(uuid, text, uuid, jsonb) to authenticated;

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
    case when msg.deleted_at is null then msg.body else '삭제된 메시지입니다' end as body,
    msg.kind,
    msg.reply_to_id,
    case
      when rt.id is null then null
      else jsonb_build_object(
        'id', rt.id,
        'sender_id', rt.sender_id,
        'sender_name', rtp.name,
        'body', case when rt.deleted_at is null then rt.body else '삭제된 메시지입니다' end,
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

create or replace function public.edit_messenger_message(
  p_message_id uuid,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messenger_messages;
  v_body text;
begin
  perform public.messenger_require_active_user();

  select * into v_msg
  from public.messenger_messages
  where id = p_message_id;

  if not found then
    raise exception 'Message not found';
  end if;

  if v_msg.sender_id <> auth.uid() then
    raise exception 'Only sender can edit this message';
  end if;

  if v_msg.deleted_at is not null then
    raise exception 'Deleted message cannot be edited';
  end if;

  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null then
    raise exception 'Message body is required';
  end if;

  if length(v_body) > 4000 then
    raise exception 'Message is too long';
  end if;

  update public.messenger_messages
  set body = v_body,
      edited_at = now()
  where id = p_message_id;

  update public.messenger_conversations
  set updated_at = now()
  where id = v_msg.conversation_id;
end;
$$;

grant execute on function public.edit_messenger_message(uuid, text) to authenticated;

create or replace function public.delete_messenger_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messenger_messages;
begin
  perform public.messenger_require_active_user();

  select * into v_msg
  from public.messenger_messages
  where id = p_message_id;

  if not found then
    raise exception 'Message not found';
  end if;

  if v_msg.sender_id <> auth.uid()
    and public.get_user_role() not in ('admin', 'office', 'pastor')
  then
    raise exception 'No permission to delete this message';
  end if;

  update public.messenger_messages
  set deleted_at = now(),
      body = ''
  where id = p_message_id
    and deleted_at is null;

  update public.messenger_conversations
  set updated_at = now()
  where id = v_msg.conversation_id;
end;
$$;

grant execute on function public.delete_messenger_message(uuid) to authenticated;

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
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select mp.conversation_id, mp.last_read_at
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
    c.updated_at
  from mine
  join public.messenger_conversations c on c.id = mine.conversation_id
  left join participants pt on pt.conversation_id = c.id
  left join public.messenger_messages lm on lm.id = c.last_message_id
  left join public.profiles sp on sp.id = lm.sender_id
  order by c.updated_at desc;
$$;

grant execute on function public.list_messenger_conversations() to authenticated;
