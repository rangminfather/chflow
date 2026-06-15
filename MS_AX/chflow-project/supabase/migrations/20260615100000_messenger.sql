-- Text messenger: conversations, participants, messages, unread state, and notifications.

create table if not exists public.messenger_conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct' check (type in ('direct', 'group')),
  title text,
  direct_key text unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_id uuid
);

create table if not exists public.messenger_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  archived_at timestamptz,
  muted_until timestamptz,
  unique (conversation_id, user_id)
);

create table if not exists public.messenger_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'system')),
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

alter table public.messenger_conversations
  drop constraint if exists messenger_conversations_last_message_id_fkey;
alter table public.messenger_conversations
  add constraint messenger_conversations_last_message_id_fkey
  foreign key (last_message_id) references public.messenger_messages(id) on delete set null;

create index if not exists idx_messenger_participants_user
  on public.messenger_participants(user_id, archived_at, conversation_id);
create index if not exists idx_messenger_participants_conversation
  on public.messenger_participants(conversation_id, user_id);
create index if not exists idx_messenger_messages_conversation_created
  on public.messenger_messages(conversation_id, created_at desc);
create index if not exists idx_messenger_conversations_updated
  on public.messenger_conversations(updated_at desc);

alter table public.messenger_conversations enable row level security;
alter table public.messenger_participants enable row level security;
alter table public.messenger_messages enable row level security;

create or replace function public.is_messenger_participant(
  p_conversation_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.messenger_participants mp
    join public.profiles p on p.id = mp.user_id
    where mp.conversation_id = p_conversation_id
      and mp.user_id = p_user_id
      and p.status = 'active'
  );
$$;

grant execute on function public.is_messenger_participant(uuid, uuid) to authenticated;

drop policy if exists messenger_conversations_select_participant on public.messenger_conversations;
create policy messenger_conversations_select_participant
  on public.messenger_conversations for select
  to authenticated
  using (public.is_messenger_participant(id, auth.uid()));

drop policy if exists messenger_participants_select_conversation_participant on public.messenger_participants;
create policy messenger_participants_select_conversation_participant
  on public.messenger_participants for select
  to authenticated
  using (public.is_messenger_participant(conversation_id, auth.uid()));

drop policy if exists messenger_messages_select_participant on public.messenger_messages;
create policy messenger_messages_select_participant
  on public.messenger_messages for select
  to authenticated
  using (public.is_messenger_participant(conversation_id, auth.uid()));

create or replace function public.messenger_require_active_user()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Login is required';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  ) then
    raise exception 'Only active users can use messenger';
  end if;
end;
$$;

grant execute on function public.messenger_require_active_user() to authenticated;

create or replace function public.search_messenger_users(
  p_query text default '',
  p_limit int default 20
)
returns table (
  user_id uuid,
  name text,
  sub_role text,
  role text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as user_id,
    p.name,
    p.sub_role,
    p.role,
    coalesce(p.avatar_url, m.photo_url) as avatar_url
  from public.profiles p
  left join public.members m on m.id = p.member_id
  where p.status = 'active'
    and p.id <> auth.uid()
    and exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.status = 'active'
    )
    and (
      coalesce(trim(p_query), '') = ''
      or p.name ilike '%' || trim(p_query) || '%'
      or p.username ilike '%' || trim(p_query) || '%'
      or p.sub_role ilike '%' || trim(p_query) || '%'
    )
  order by
    case when p.name ilike trim(p_query) || '%' then 0 else 1 end,
    p.name nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.search_messenger_users(text, int) to authenticated;

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

create or replace function public.create_group_conversation(
  p_title text,
  p_participant_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_user_id uuid;
  v_title text;
begin
  perform public.messenger_require_active_user();

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null then
    raise exception 'Group title is required';
  end if;

  insert into public.messenger_conversations (type, title, created_by)
  values ('group', left(v_title, 80), auth.uid())
  returning id into v_conversation_id;

  insert into public.messenger_participants (conversation_id, user_id, role, last_read_at)
  values (v_conversation_id, auth.uid(), 'owner', now());

  for v_user_id in
    select distinct unnest(coalesce(p_participant_ids, array[]::uuid[]))
  loop
    if v_user_id <> auth.uid()
      and exists (select 1 from public.profiles where id = v_user_id and status = 'active')
    then
      insert into public.messenger_participants (conversation_id, user_id, role)
      values (v_conversation_id, v_user_id, 'member')
      on conflict do nothing;
    end if;
  end loop;

  if (select count(*) from public.messenger_participants where conversation_id = v_conversation_id) < 2 then
    raise exception 'Add at least one participant';
  end if;

  return v_conversation_id;
end;
$$;

grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

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
    case when lm.deleted_at is null then lm.body else 'Deleted message' end as last_message_body,
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

create or replace function public.get_messenger_participants(p_conversation_id uuid)
returns table (
  user_id uuid,
  name text,
  sub_role text,
  avatar_url text,
  role text,
  last_read_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as user_id,
    p.name,
    p.sub_role,
    coalesce(p.avatar_url, m.photo_url) as avatar_url,
    mp.role,
    mp.last_read_at
  from public.messenger_participants mp
  join public.profiles p on p.id = mp.user_id
  left join public.members m on m.id = p.member_id
  where mp.conversation_id = p_conversation_id
    and public.is_messenger_participant(p_conversation_id, auth.uid())
  order by case when mp.user_id = auth.uid() then 0 else 1 end, p.name;
$$;

grant execute on function public.get_messenger_participants(uuid) to authenticated;

create or replace function public.get_messenger_messages(
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
    msg.created_at,
    msg.edited_at,
    msg.deleted_at,
    msg.sender_id = auth.uid() as is_mine
  from public.messenger_messages msg
  join public.profiles p on p.id = msg.sender_id
  left join public.members m on m.id = p.member_id
  where msg.conversation_id = p_conversation_id
    and public.is_messenger_participant(p_conversation_id, auth.uid())
    and (p_before is null or msg.created_at < p_before)
  order by msg.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

grant execute on function public.get_messenger_messages(uuid, int, timestamptz) to authenticated;

create or replace function public.mark_messenger_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.messenger_participants
  set last_read_at = now()
  where conversation_id = p_conversation_id
    and user_id = auth.uid()
    and public.is_messenger_participant(p_conversation_id, auth.uid());
$$;

grant execute on function public.mark_messenger_read(uuid) to authenticated;

create or replace function public.send_messenger_message(
  p_conversation_id uuid,
  p_body text
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
begin
  perform public.messenger_require_active_user();

  if not public.is_messenger_participant(p_conversation_id, auth.uid()) then
    raise exception 'No access to this conversation';
  end if;

  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null then
    raise exception 'Message body is required';
  end if;

  if length(v_body) > 4000 then
    raise exception 'Message is too long';
  end if;

  insert into public.messenger_messages (conversation_id, sender_id, body)
  values (p_conversation_id, auth.uid(), v_body)
  returning id into v_message_id;

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

  insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
  select
    mp.user_id,
    'message_new',
    v_sender_name,
    left(v_body, 120),
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

grant execute on function public.send_messenger_message(uuid, text) to authenticated;

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

do $$
begin
  alter table public.messenger_conversations replica identity full;
  alter table public.messenger_participants replica identity full;
  alter table public.messenger_messages replica identity full;

  begin
    alter publication supabase_realtime add table public.messenger_conversations;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.messenger_participants;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.messenger_messages;
  exception when duplicate_object then null;
  end;
exception when undefined_object then
  null;
end $$;
