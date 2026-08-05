-- Admin-only messenger delivery diagnostics.

create or replace function public.diagnose_messenger_delivery(
  p_query text,
  p_limit int default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_query text := btrim(coalesce(p_query, ''));
  v_uuid uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_user_id uuid;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid()
    and status = 'active';

  if v_role not in ('admin', 'office', 'pastor') then
    raise exception 'Not authorized';
  end if;

  if v_query = '' then
    return jsonb_build_object(
      'input', v_query,
      'resolved', jsonb_build_object(),
      'conversation', null,
      'message', null,
      'participants', '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'push_tokens', '[]'::jsonb,
      'deliveries', '[]'::jsonb,
      'flags', '[]'::jsonb,
      'candidates', '[]'::jsonb
    );
  end if;

  begin
    v_uuid := v_query::uuid;
  exception when invalid_text_representation then
    v_uuid := null;
  end;

  if v_uuid is not null then
    select m.id, m.conversation_id
      into v_message_id, v_conversation_id
    from public.messenger_messages m
    where m.id = v_uuid;

    if v_message_id is null then
      select c.id
        into v_conversation_id
      from public.messenger_conversations c
      where c.id = v_uuid;
    end if;

    if v_message_id is null and v_conversation_id is not null then
      select m.id
        into v_message_id
      from public.messenger_messages m
      where m.conversation_id = v_conversation_id
      order by m.created_at desc
      limit 1;
    end if;
  end if;

  if v_uuid is null then
    select p.id
      into v_user_id
    from public.profiles p
    where p.name ilike '%' || v_query || '%'
       or p.username ilike '%' || v_query || '%'
       or p.email ilike '%' || v_query || '%'
       or p.phone ilike '%' || v_query || '%'
    order by
      case when p.name = v_query or p.username = v_query then 0 else 1 end,
      p.name nulls last
    limit 1;

    if v_user_id is not null then
      select mp.conversation_id
        into v_conversation_id
      from public.messenger_participants mp
      join public.messenger_conversations c on c.id = mp.conversation_id
      where mp.user_id = v_user_id
      order by c.updated_at desc
      limit 1;

      select m.id
        into v_message_id
      from public.messenger_messages m
      where m.conversation_id = v_conversation_id
      order by m.created_at desc
      limit 1;
    end if;
  end if;

  return (
    with selected_message as (
      select m.*
      from public.messenger_messages m
      where m.id = v_message_id
    ),
    selected_conversation as (
      select c.*
      from public.messenger_conversations c
      where c.id = v_conversation_id
    ),
    participant_rows as (
      select
        mp.conversation_id,
        mp.user_id,
        coalesce(p.name, p.email, p.username) as name,
        p.role as app_role,
        p.status as profile_status,
        mp.role as participant_role,
        mp.joined_at,
        mp.last_read_at,
        mp.muted_until,
        mp.archived_at
      from public.messenger_participants mp
      join public.profiles p on p.id = mp.user_id
      where mp.conversation_id = v_conversation_id
    ),
    notification_rows as (
      select n.*
      from public.notifications n
      where n.type = 'message_new'
        and (
          (v_message_id is not null and n.metadata->>'message_id' = v_message_id::text)
          or (v_message_id is null and v_conversation_id is not null and n.metadata->>'conversation_id' = v_conversation_id::text)
          or (v_user_id is not null and n.user_id = v_user_id)
        )
      order by n.created_at desc
      limit greatest(1, least(coalesce(p_limit, 20), 100))
    ),
    token_rows as (
      select t.*
      from public.user_push_tokens t
      where t.user_id in (select user_id from participant_rows)
         or (v_user_id is not null and t.user_id = v_user_id)
      order by t.enabled desc, t.last_seen_at desc nulls last
      limit 200
    ),
    delivery_rows as (
      select d.*
      from public.notification_push_deliveries d
      where d.notification_id in (select id from notification_rows)
      order by d.created_at desc
      limit 200
    ),
    candidate_rows as (
      select jsonb_build_object(
        'kind', 'user',
        'id', p.id,
        'label', coalesce(p.name, p.username, p.email),
        'detail', concat_ws(' / ', p.role, p.status, p.phone)
      ) as item
      from public.profiles p
      where v_uuid is null
        and (
          p.name ilike '%' || v_query || '%'
          or p.username ilike '%' || v_query || '%'
          or p.email ilike '%' || v_query || '%'
          or p.phone ilike '%' || v_query || '%'
        )
      order by p.name nulls last
      limit 10
    ),
    flag_rows as (
      select jsonb_build_object(
        'severity', 'danger',
        'code', 'duplicate_notifications',
        'message', 'One recipient has duplicate message_new notification rows for this message.',
        'user_id', n.user_id,
        'count', count(*)
      ) as flag
      from notification_rows n
      group by n.user_id, n.metadata->>'message_id'
      having count(*) > 1

      union all

      select jsonb_build_object(
        'severity', 'danger',
        'code', 'missing_notification',
        'message', 'A recipient participant has no message_new notification row.',
        'user_id', pr.user_id,
        'name', pr.name
      )
      from participant_rows pr
      cross join selected_message sm
      where pr.user_id <> sm.sender_id
        and pr.archived_at is null
        and not exists (
          select 1
          from notification_rows n
          where n.user_id = pr.user_id
            and n.metadata->>'message_id' = sm.id::text
        )

      union all

      select jsonb_build_object(
        'severity', 'warning',
        'code', 'muted_recipient',
        'message', 'Recipient has the conversation muted but a notification row exists.',
        'user_id', pr.user_id,
        'name', pr.name,
        'muted_until', pr.muted_until
      )
      from participant_rows pr
      join notification_rows n on n.user_id = pr.user_id
      where pr.muted_until is not null
        and pr.muted_until > now()

      union all

      select jsonb_build_object(
        'severity', 'warning',
        'code', 'multiple_active_tokens_same_device',
        'message', 'User has multiple active push tokens for the same device.',
        'user_id', t.user_id,
        'device_id', t.device_id,
        'count', count(*)
      )
      from token_rows t
      where t.enabled = true
        and t.device_id is not null
      group by t.user_id, t.platform, t.device_id
      having count(*) > 1

      union all

      select jsonb_build_object(
        'severity', 'warning',
        'code', 'push_delivery_not_sent',
        'message', 'Push delivery is queued, failed, skipped, or still sending.',
        'delivery_id', d.id,
        'notification_id', d.notification_id,
        'status', d.status,
        'attempts', d.attempts,
        'error', d.error_message
      )
      from delivery_rows d
      where d.status <> 'sent'
    )
    select jsonb_build_object(
      'input', v_query,
      'resolved', jsonb_build_object(
        'conversation_id', v_conversation_id,
        'message_id', v_message_id,
        'user_id', v_user_id
      ),
      'conversation', (
        select to_jsonb(sc)
        from selected_conversation sc
      ),
      'message', (
        select jsonb_build_object(
          'id', sm.id,
          'conversation_id', sm.conversation_id,
          'sender_id', sm.sender_id,
          'sender_name', coalesce(sp.name, sp.email, sp.username),
          'body', sm.body,
          'kind', sm.kind,
          'created_at', sm.created_at,
          'edited_at', sm.edited_at,
          'deleted_at', sm.deleted_at
        )
        from selected_message sm
        left join public.profiles sp on sp.id = sm.sender_id
      ),
      'participants', coalesce((
        select jsonb_agg(to_jsonb(pr) order by pr.name)
        from participant_rows pr
      ), '[]'::jsonb),
      'notifications', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n.id,
          'user_id', n.user_id,
          'recipient_name', coalesce(p.name, p.email, p.username),
          'type', n.type,
          'title', n.title,
          'body', n.body,
          'link_url', n.link_url,
          'is_read', n.is_read,
          'read_at', n.read_at,
          'created_at', n.created_at,
          'metadata', n.metadata
        ) order by n.created_at desc)
        from notification_rows n
        left join public.profiles p on p.id = n.user_id
      ), '[]'::jsonb),
      'push_tokens', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'user_id', t.user_id,
          'user_name', coalesce(p.name, p.email, p.username),
          'platform', t.platform,
          'device_id', t.device_id,
          'app_id', t.app_id,
          'enabled', t.enabled,
          'last_seen_at', t.last_seen_at,
          'created_at', t.created_at,
          'updated_at', t.updated_at,
          'token_tail', right(t.expo_push_token, 18)
        ) order by t.enabled desc, t.last_seen_at desc nulls last)
        from token_rows t
        left join public.profiles p on p.id = t.user_id
      ), '[]'::jsonb),
      'deliveries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id,
          'notification_id', d.notification_id,
          'user_id', d.user_id,
          'user_name', coalesce(p.name, p.email, p.username),
          'push_token_id', d.push_token_id,
          'token_tail', right(d.expo_push_token, 18),
          'status', d.status,
          'attempts', d.attempts,
          'expo_ticket_id', d.expo_ticket_id,
          'error_message', d.error_message,
          'sent_at', d.sent_at,
          'created_at', d.created_at,
          'updated_at', d.updated_at
        ) order by d.created_at desc)
        from delivery_rows d
        left join public.profiles p on p.id = d.user_id
      ), '[]'::jsonb),
      'flags', coalesce((
        select jsonb_agg(fr.flag)
        from flag_rows fr
      ), '[]'::jsonb),
      'candidates', coalesce((
        select jsonb_agg(cr.item)
        from candidate_rows cr
      ), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.diagnose_messenger_delivery(text, int) to authenticated;
