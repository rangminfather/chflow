drop function if exists public.admin_mark_member_no_photo(uuid);
create or replace function public.admin_mark_member_no_photo(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception 'not authorized';
  end if;

  update public.members
  set
    photo_url = null,
    photo_status = 'no_photo_in_pdf',
    review_status = 'verified',
    reviewed_at = now()
  where id = p_member_id;
end;
$$;

grant execute on function public.admin_mark_member_no_photo(uuid) to authenticated;

drop function if exists public.admin_set_member_photo(uuid, text);
create or replace function public.admin_set_member_photo(p_member_id uuid, p_photo_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception 'not authorized';
  end if;

  update public.members
  set
    photo_url = p_photo_url,
    photo_status = case when p_photo_url is null then null else 'matched' end,
    reviewed_at = case when p_photo_url is null then reviewed_at else now() end
  where id = p_member_id;
end;
$$;

grant execute on function public.admin_set_member_photo(uuid, text) to authenticated;
