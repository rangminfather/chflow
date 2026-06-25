-- Group conversation management: rename, add participants, and remove members.

create or replace function public.can_manage_messenger_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.messenger_participants mp
    where mp.conversation_id = p_conversation_id
      and mp.user_id = auth.uid()
      and mp.role = 'owner'
  )
  or public.get_user_role() in ('admin', 'office', 'pastor');
$$;

grant execute on function public.can_manage_messenger_conversation(uuid) to authenticated;

create or replace function public.rename_group_conversation(
  p_conversation_id uuid,
  p_title text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  perform public.messenger_require_active_user();

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null then
    raise exception 'Group title is required';
  end if;

  if not exists (
    select 1
    from public.messenger_conversations
    where id = p_conversation_id
      and type = 'group'
  ) then
    raise exception 'Group conversation not found';
  end if;

  if not public.can_manage_messenger_conversation(p_conversation_id) then
    raise exception 'No permission to manage this conversation';
  end if;

  update public.messenger_conversations
  set title = left(v_title, 80),
      updated_at = now()
  where id = p_conversation_id
    and type = 'group';

  perform public.messenger_log_action(
    'group_rename',
    p_conversation_id,
    null,
    null,
    jsonb_build_object('title', left(v_title, 80))
  );
end;
$$;

grant execute on function public.rename_group_conversation(uuid, text) to authenticated;

create or replace function public.add_group_participants(
  p_conversation_id uuid,
  p_participant_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_added_count int := 0;
begin
  perform public.messenger_require_active_user();

  if not exists (
    select 1
    from public.messenger_conversations
    where id = p_conversation_id
      and type = 'group'
  ) then
    raise exception 'Group conversation not found';
  end if;

  if not public.can_manage_messenger_conversation(p_conversation_id) then
    raise exception 'No permission to manage this conversation';
  end if;

  for v_user_id in
    select distinct unnest(coalesce(p_participant_ids, array[]::uuid[]))
  loop
    if v_user_id <> auth.uid()
       and exists (select 1 from public.profiles where id = v_user_id and status = 'active')
    then
      insert into public.messenger_participants (conversation_id, user_id, role)
      values (p_conversation_id, v_user_id, 'member')
      on conflict (conversation_id, user_id)
      do update set archived_at = null;

      v_added_count := v_added_count + 1;
    end if;
  end loop;

  if v_added_count > 0 then
    update public.messenger_conversations
    set updated_at = now()
    where id = p_conversation_id;

    perform public.messenger_log_action(
      'group_participants_add',
      p_conversation_id,
      null,
      null,
      jsonb_build_object('count', v_added_count)
    );
  end if;
end;
$$;

grant execute on function public.add_group_participants(uuid, uuid[]) to authenticated;

create or replace function public.remove_group_participant(
  p_conversation_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role text;
  v_remaining_count int;
begin
  perform public.messenger_require_active_user();

  if not exists (
    select 1
    from public.messenger_conversations
    where id = p_conversation_id
      and type = 'group'
  ) then
    raise exception 'Group conversation not found';
  end if;

  if not public.can_manage_messenger_conversation(p_conversation_id) then
    raise exception 'No permission to manage this conversation';
  end if;

  select role into v_target_role
  from public.messenger_participants
  where conversation_id = p_conversation_id
    and user_id = p_user_id;

  if v_target_role is null then
    return;
  end if;

  if v_target_role = 'owner' and public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception 'Owner cannot be removed';
  end if;

  select count(*)::int into v_remaining_count
  from public.messenger_participants
  where conversation_id = p_conversation_id
    and user_id <> p_user_id;

  if v_remaining_count < 2 then
    raise exception 'Group conversation needs at least two participants';
  end if;

  delete from public.messenger_participants
  where conversation_id = p_conversation_id
    and user_id = p_user_id;

  update public.messenger_conversations
  set updated_at = now()
  where id = p_conversation_id;

  perform public.messenger_log_action(
    'group_participant_remove',
    p_conversation_id,
    null,
    p_user_id,
    jsonb_build_object('removed_role', v_target_role)
  );
end;
$$;

grant execute on function public.remove_group_participant(uuid, uuid) to authenticated;
