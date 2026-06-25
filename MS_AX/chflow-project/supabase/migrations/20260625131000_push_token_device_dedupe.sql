-- Keep only the newest active push token per user/app/platform/device.

update public.user_push_tokens stale
set enabled = false,
    updated_at = now()
where stale.device_id is not null
  and stale.enabled = true
  and exists (
    select 1
    from public.user_push_tokens newer
    where newer.user_id = stale.user_id
      and newer.app_id = stale.app_id
      and newer.platform = stale.platform
      and newer.device_id = stale.device_id
      and newer.enabled = true
      and newer.id <> stale.id
      and (
        newer.updated_at > stale.updated_at
        or (newer.updated_at = stale.updated_at and newer.id > stale.id)
      )
  );

create index if not exists idx_user_push_tokens_device_enabled
  on public.user_push_tokens(user_id, app_id, platform, device_id, enabled)
  where device_id is not null;
