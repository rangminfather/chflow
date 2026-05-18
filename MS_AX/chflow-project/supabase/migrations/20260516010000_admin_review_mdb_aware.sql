-- MDB merge changed the review baseline:
-- - source_page-backed members are PDF review targets.
-- - legacy_kyoin_id-backed members without source_page are MDB-only identity records.
-- Do not flag MDB-only records as missing PDF page/photo.

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
      when m.spouse_name is not null
       and m.spouse_name <> ''
       and m.household_id is not null
       and not exists (
         select 1
         from public.members ms
         where ms.household_id = m.household_id
           and ms.id <> m.id
           and ms.name = m.spouse_name
       )
      then 'spouse_mismatch'
    end,
    case
      when m.is_child
       and not exists (
         select 1
         from public.member_relations r
         where r.subject_id = m.id
           and r.kind <> 'spouse'
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

drop function if exists public.admin_review_summary();
create or replace function public.admin_review_summary()
returns table (
  total int,
  verified int,
  needs_check int,
  unreviewed int,
  flagged int
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception 'permission denied';
  end if;

  return query
  select
    count(*)::int,
    count(*) filter (where m.review_status = 'verified')::int,
    count(*) filter (where m.review_status = 'needs_check')::int,
    count(*) filter (where m.review_status = 'unreviewed')::int,
    count(*) filter (where cardinality(public.admin_review_member_flags(m.id)) > 0)::int
  from public.members m;
end;
$$;

grant execute on function public.admin_review_summary() to authenticated;

drop function if exists public.admin_review_auto_classify(boolean);
create or replace function public.admin_review_auto_classify(p_apply boolean default false)
returns table (
  action text,
  affected_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pdf_verified int := 0;
  v_mdb_verified int := 0;
  v_needs_check int := 0;
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception 'permission denied';
  end if;

  if p_apply then
    update public.members m
       set review_status = 'needs_check',
           review_note = concat_ws('; ', nullif(m.review_note, ''), '자동검수: 중복/관계/번호 확인 필요'),
           reviewed_at = now(),
           reviewed_by = auth.uid()
     where m.review_status = 'unreviewed'
       and (
         'duplicate_name_birth' = any(public.admin_review_member_flags(m.id))
         or 'duplicate_legacy' = any(public.admin_review_member_flags(m.id))
         or 'bad_phone' = any(public.admin_review_member_flags(m.id))
         or 'spouse_mismatch' = any(public.admin_review_member_flags(m.id))
         or 'orphan_child' = any(public.admin_review_member_flags(m.id))
       );
    get diagnostics v_needs_check = row_count;

    update public.members m
       set review_status = 'verified',
           review_note = concat_ws('; ', nullif(m.review_note, ''), '자동검수: PDF 기준 기본정보 이상 없음'),
           reviewed_at = now(),
           reviewed_by = auth.uid()
     where m.review_status = 'unreviewed'
       and m.source_page is not null
       and m.household_id is not null
       and not (
         'bad_phone' = any(public.admin_review_member_flags(m.id))
         or 'spouse_mismatch' = any(public.admin_review_member_flags(m.id))
         or 'orphan_child' = any(public.admin_review_member_flags(m.id))
         or 'duplicate_name_birth' = any(public.admin_review_member_flags(m.id))
         or 'duplicate_legacy' = any(public.admin_review_member_flags(m.id))
       );
    get diagnostics v_pdf_verified = row_count;

    update public.members m
       set review_status = 'verified',
           review_note = concat_ws('; ', nullif(m.review_note, ''), '자동검수: MDB 교인번호/생년월일/주소/가족번호 기준 확인'),
           reviewed_at = now(),
           reviewed_by = auth.uid()
     where m.review_status = 'unreviewed'
       and m.legacy_kyoin_id is not null
       and m.source_page is null
       and m.birth_date is not null
       and m.address is not null
       and m.legacy_family_num is not null
       and not (
         'duplicate_name_birth' = any(public.admin_review_member_flags(m.id))
         or 'duplicate_legacy' = any(public.admin_review_member_flags(m.id))
       );
    get diagnostics v_mdb_verified = row_count;
  else
    select count(*)::int into v_needs_check
    from public.members m
    where m.review_status = 'unreviewed'
      and (
        'duplicate_name_birth' = any(public.admin_review_member_flags(m.id))
        or 'duplicate_legacy' = any(public.admin_review_member_flags(m.id))
        or 'bad_phone' = any(public.admin_review_member_flags(m.id))
        or 'spouse_mismatch' = any(public.admin_review_member_flags(m.id))
        or 'orphan_child' = any(public.admin_review_member_flags(m.id))
      );

    select count(*)::int into v_pdf_verified
    from public.members m
    where m.review_status = 'unreviewed'
      and m.source_page is not null
      and m.household_id is not null
      and not (
        'bad_phone' = any(public.admin_review_member_flags(m.id))
        or 'spouse_mismatch' = any(public.admin_review_member_flags(m.id))
        or 'orphan_child' = any(public.admin_review_member_flags(m.id))
        or 'duplicate_name_birth' = any(public.admin_review_member_flags(m.id))
        or 'duplicate_legacy' = any(public.admin_review_member_flags(m.id))
      );

    select count(*)::int into v_mdb_verified
    from public.members m
    where m.review_status = 'unreviewed'
      and m.legacy_kyoin_id is not null
      and m.source_page is null
      and m.birth_date is not null
      and m.address is not null
      and m.legacy_family_num is not null
      and not (
        'duplicate_name_birth' = any(public.admin_review_member_flags(m.id))
        or 'duplicate_legacy' = any(public.admin_review_member_flags(m.id))
      );
  end if;

  return query values
    ('needs_check'::text, v_needs_check),
    ('pdf_verified'::text, v_pdf_verified),
    ('mdb_verified'::text, v_mdb_verified);
end;
$$;

grant execute on function public.admin_review_auto_classify(boolean) to authenticated;

notify pgrst, 'reload schema';
