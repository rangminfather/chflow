-- Messenger search: participant-scoped full text-like message search.

create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_messenger_messages_body_trgm
  on public.messenger_messages using gin (body extensions.gin_trgm_ops);

create or replace function public.search_messenger_messages(
  p_query text,
  p_limit int default 30
)
returns table (
  conversation_id uuid,
  conversation_title text,
  message_id uuid,
  sender_id uuid,
  sender_name text,
  body text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select nullif(trim(coalesce(p_query, '')), '') as text
  ),
  my_conversations as (
    select mp.conversation_id
    from public.messenger_participants mp
    where mp.user_id = auth.uid()
      and mp.archived_at is null
  ),
  participant_names as (
    select
      mp.conversation_id,
      string_agg(p.name, ', ' order by p.name) filter (where mp.user_id <> auth.uid()) as other_names
    from public.messenger_participants mp
    join public.profiles p on p.id = mp.user_id
    group by mp.conversation_id
  )
  select
    msg.conversation_id,
    case
      when c.type = 'direct' then coalesce(pn.other_names, 'Messenger')
      else coalesce(c.title, pn.other_names, 'Group chat')
    end as conversation_title,
    msg.id as message_id,
    msg.sender_id,
    sp.name as sender_name,
    msg.body,
    msg.created_at
  from q
  join my_conversations mine on q.text is not null
  join public.messenger_messages msg on msg.conversation_id = mine.conversation_id
  join public.messenger_conversations c on c.id = msg.conversation_id
  left join participant_names pn on pn.conversation_id = msg.conversation_id
  left join public.profiles sp on sp.id = msg.sender_id
  where msg.deleted_at is null
    and msg.body ilike '%' || q.text || '%'
  order by msg.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 80));
$$;

grant execute on function public.search_messenger_messages(text, int) to authenticated;
