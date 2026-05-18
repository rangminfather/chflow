drop function if exists public.admin_review_pdf_members(text);
create or replace function public.admin_review_pdf_members(p_filter text default null)
returns table (
  id uuid,
  name text,
  phone text,
  gender text,
  is_child boolean,
  sub_role text,
  family_church text,
  spouse_name text,
  birth_date date,
  address text,
  household_id uuid,
  household_order int,
  photo_url text,
  photo_status text,
  source_page int,
  photo_page int,
  review_status text,
  review_note text,
  reviewed_at timestamptz,
  reviewer_name text,
  flags text[],
  child_names text[],
  parent_names text[]
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception 'permission denied';
  end if;

  return query
  select *
  from (
    select
      m.id, m.name, m.phone, m.gender, m.is_child, m.sub_role,
      m.family_church, m.spouse_name, m.birth_date, coalesce(m.address, h.address) as address,
      h.id as household_id,
      h.order_no as household_order,
      m.photo_url, m.photo_status, m.source_page, m.photo_page,
      m.review_status, m.review_note, m.reviewed_at,
      rp.name as reviewer_name,
      public.admin_review_member_flags(m.id) as flags,
      (
        select array_agg(cm.name order by cm.name)
        from public.member_relations cr
        join public.members cm on cm.id = cr.subject_id
        where cr.relative_id = m.id
          and cr.kind <> 'spouse'
      ) as child_names,
      (
        select array_agg(pm.name order by pm.name)
        from public.member_relations pr
        join public.members pm on pm.id = pr.relative_id
        where pr.subject_id = m.id
          and pr.kind <> 'spouse'
      ) as parent_names
    from public.members m
    left join public.households h on h.id = m.household_id
    left join public.profiles rp on rp.id = m.reviewed_by
    where m.source_page is not null
  ) x
  where
    p_filter is null
    or p_filter = ''
    or (p_filter in ('unreviewed', 'verified', 'needs_check') and x.review_status = p_filter)
    or (p_filter not in ('unreviewed', 'verified', 'needs_check') and p_filter = any(x.flags))
  order by x.source_page nulls last, x.household_order nulls last, x.name;
end;
$$;

grant execute on function public.admin_review_pdf_members(text) to authenticated;

notify pgrst, 'reload schema';
