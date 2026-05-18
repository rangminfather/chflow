-- Parent/child display in admin review must not treat sibling edges as
-- parent/child evidence. member_relations stores sibling separately.

create or replace function public.admin_review_member_flags(p_member_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select array_remove(array[
    case
      when m.source_page is not null
       and coalesce(m.is_child, false) = false
       and m.photo_url is null
       and coalesce(m.photo_status, '') <> 'no_photo_in_pdf'
      then 'no_photo'
    end,
    case
      when m.phone is not null
       and m.phone <> ''
       and m.phone !~ '^01[016789]-?[0-9]{3,4}-?[0-9]{4}$'
      then 'bad_phone'
    end,
    case
      when nullif(m.spouse_name, '') is not null
       and not exists (
         select 1
         from public.members ms
         where ms.id <> m.id
           and ms.name = m.spouse_name
           and nullif(ms.spouse_name, '') = m.name
       )
      then 'spouse_mismatch'
    end,
    case
      when m.is_child
       and not exists (
         select 1
         from public.member_relations r
         where r.subject_id = m.id
           and r.kind in ('parent', 'grandparent', 'great_grandparent')
       )
      then 'orphan_child'
    end,
    case
      when m.source_page is null
       and m.legacy_kyoin_id is not null
       and m.household_id is null
      then 'needs_household'
    end,
    case
      when m.source_page is null
       and m.legacy_kyoin_id is null
       and m.household_id is null
      then 'no_household'
    end,
    case
      when m.source_page is null
       and m.legacy_kyoin_id is null
      then 'no_page'
    end,
    case
      when m.birth_date is not null
       and exists (
         select 1
         from public.members d
         where d.id <> m.id
           and d.name = m.name
           and d.birth_date = m.birth_date
       )
      then 'duplicate_name_birth'
    end,
    case
      when m.legacy_kyoin_id is not null
       and exists (
         select 1
         from public.members d
         where d.id <> m.id
           and d.legacy_kyoin_id = m.legacy_kyoin_id
       )
      then 'duplicate_legacy'
    end
  ], null)
  from public.members m
  where m.id = p_member_id;
$$;

grant execute on function public.admin_review_member_flags(uuid) to authenticated;

drop function if exists public.admin_review_pasture_members(uuid);
create or replace function public.admin_review_pasture_members(p_pasture_id uuid)
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
        and cr.kind in ('parent', 'grandparent', 'great_grandparent')
    ) as child_names,
    (
      select array_agg(pm.name order by pm.name)
      from public.member_relations pr
      join public.members pm on pm.id = pr.relative_id
      where pr.subject_id = m.id
        and pr.kind in ('parent', 'grandparent', 'great_grandparent')
    ) as parent_names
  from public.members m
  left join public.households h on h.id = m.household_id
  left join public.profiles rp on rp.id = m.reviewed_by
  where h.pasture_id = p_pasture_id
  order by h.order_no nulls last, m.is_child, m.name;
end;
$$;

grant execute on function public.admin_review_pasture_members(uuid) to authenticated;

drop function if exists public.admin_review_mdb_members(text);
create or replace function public.admin_review_mdb_members(p_filter text default null)
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
          and cr.kind in ('parent', 'grandparent', 'great_grandparent')
      ) as child_names,
      (
        select array_agg(pm.name order by pm.name)
        from public.member_relations pr
        join public.members pm on pm.id = pr.relative_id
        where pr.subject_id = m.id
          and pr.kind in ('parent', 'grandparent', 'great_grandparent')
      ) as parent_names
    from public.members m
    left join public.households h on h.id = m.household_id
    left join public.profiles rp on rp.id = m.reviewed_by
    where m.legacy_kyoin_id is not null
      and m.source_page is null
  ) x
  where
    p_filter is null
    or p_filter = ''
    or (p_filter in ('unreviewed', 'verified', 'needs_check') and x.review_status = p_filter)
    or (p_filter not in ('unreviewed', 'verified', 'needs_check') and p_filter = any(x.flags))
  order by x.name, x.birth_date nulls last;
end;
$$;

grant execute on function public.admin_review_mdb_members(text) to authenticated;

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
          and cr.kind in ('parent', 'grandparent', 'great_grandparent')
      ) as child_names,
      (
        select array_agg(pm.name order by pm.name)
        from public.member_relations pr
        join public.members pm on pm.id = pr.relative_id
        where pr.subject_id = m.id
          and pr.kind in ('parent', 'grandparent', 'great_grandparent')
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
