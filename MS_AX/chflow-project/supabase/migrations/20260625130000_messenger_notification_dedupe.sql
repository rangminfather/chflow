-- Prevent duplicate messenger notification rows for the same recipient/message.

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, type, metadata->>'message_id'
      order by created_at asc, id asc
    ) as rn
  from public.notifications
  where type = 'message_new'
    and metadata ? 'message_id'
)
delete from public.notifications n
using ranked r
where n.id = r.id
  and r.rn > 1;

create unique index if not exists ux_notifications_message_new_user_message
  on public.notifications (user_id, ((metadata->>'message_id')))
  where type = 'message_new'
    and metadata ? 'message_id';

create or replace function public.prevent_duplicate_message_new_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'message_new'
     and new.metadata ? 'message_id'
     and exists (
       select 1
       from public.notifications n
       where n.user_id = new.user_id
         and n.type = 'message_new'
         and n.metadata ? 'message_id'
         and n.metadata->>'message_id' = new.metadata->>'message_id'
     )
  then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_duplicate_message_new_notifications on public.notifications;
create trigger trg_prevent_duplicate_message_new_notifications
before insert on public.notifications
for each row
execute function public.prevent_duplicate_message_new_notifications();
