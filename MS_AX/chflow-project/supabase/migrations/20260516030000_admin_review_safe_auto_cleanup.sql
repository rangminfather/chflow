-- Conservative cleanup after MDB import:
-- 1) Attach MDB-only members to an existing household when the MDB family number
--    maps to exactly one existing household.
-- 2) Add parent relations for PDF-backed child rows when the child is in a
--    household with one or two clear adult household members.

drop function if exists public.admin_review_safe_auto_cleanup(boolean);
create or replace function public.admin_review_safe_auto_cleanup(p_apply boolean default false)
returns table (
  action text,
  affected_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mdb_household_members int := 0;
  v_pdf_child_parent_links int := 0;
  v_pdf_child_verified int := 0;
  v_mdb_verified int := 0;
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception 'permission denied';
  end if;

  create temporary table if not exists tmp_review_mdb_household_attach (
    member_id uuid primary key,
    target_household_id uuid not null
  ) on commit drop;
  truncate tmp_review_mdb_household_attach;

  insert into tmp_review_mdb_household_attach(member_id, target_household_id)
  with household_candidates as (
    select
      target.id as member_id,
      (array_agg(distinct peer.household_id))[1] as target_household_id,
      count(distinct peer.household_id) as household_count
    from public.members target
    join public.members peer
      on peer.legacy_family_num = target.legacy_family_num
     and peer.household_id is not null
    where target.source_page is null
      and target.legacy_kyoin_id is not null
      and target.legacy_family_num is not null
      and target.household_id is null
      and not (
        'duplicate_name_birth' = any(public.admin_review_member_flags(target.id))
        or 'duplicate_legacy' = any(public.admin_review_member_flags(target.id))
      )
    group by target.id
  )
  select member_id, target_household_id
  from household_candidates
  where household_count = 1;

  select count(*)::int into v_mdb_household_members
  from tmp_review_mdb_household_attach;

  create temporary table if not exists tmp_review_pdf_parent_links (
    child_id uuid not null,
    parent_id uuid not null,
    role text,
    primary key (child_id, parent_id)
  ) on commit drop;
  truncate tmp_review_pdf_parent_links;

  insert into tmp_review_pdf_parent_links(child_id, parent_id, role)
  with child_candidates as (
    select
      c.id as child_id,
      p.id as parent_id,
      case when p.gender = 'M' then 'father'
           when p.gender = 'F' then 'mother'
           else null end as role,
      count(*) over (partition by c.id) as parent_count
    from public.members c
    join public.members p
      on p.household_id = c.household_id
     and p.id <> c.id
     and coalesce(p.is_child, false) = false
    where c.source_page is not null
      and c.household_id is not null
      and coalesce(c.is_child, false) = true
      and 'orphan_child' = any(public.admin_review_member_flags(c.id))
      and not exists (
        select 1
        from public.member_relations r
        where r.subject_id = c.id
          and r.kind <> 'spouse'
      )
  )
  select child_id, parent_id, role
  from child_candidates
  where parent_count between 1 and 2;

  select count(*)::int into v_pdf_child_parent_links
  from tmp_review_pdf_parent_links;

  if p_apply then
    update public.members m
       set household_id = t.target_household_id,
           review_note = concat_ws('; ', nullif(m.review_note, ''), '자동정리: MDB 가족번호 기준 기존 가구 연결')
      from tmp_review_mdb_household_attach t
     where m.id = t.member_id;

    insert into public.member_relations(subject_id, relative_id, kind, role, created_by)
    select child_id, parent_id, 'parent', role, auth.uid()
    from tmp_review_pdf_parent_links
    on conflict (subject_id, relative_id, kind)
    do update set role = coalesce(excluded.role, public.member_relations.role);

    update public.members m
       set review_status = 'verified',
           review_note = concat_ws('; ', nullif(m.review_note, ''), '자동정리: 같은 가구 부모관계 연결 후 확인'),
           reviewed_at = now(),
           reviewed_by = auth.uid()
     where m.id in (select distinct child_id from tmp_review_pdf_parent_links)
       and m.review_status = 'needs_check'
       and not (
         'bad_phone' = any(public.admin_review_member_flags(m.id))
         or 'spouse_mismatch' = any(public.admin_review_member_flags(m.id))
         or 'orphan_child' = any(public.admin_review_member_flags(m.id))
         or 'duplicate_name_birth' = any(public.admin_review_member_flags(m.id))
         or 'duplicate_legacy' = any(public.admin_review_member_flags(m.id))
       )
       and (
         m.review_note is null
         or m.review_note = ''
         or m.review_note like '자동검수:%'
       );
    get diagnostics v_pdf_child_verified = row_count;

    update public.members m
       set review_status = 'verified',
           review_note = concat_ws('; ', nullif(m.review_note, ''), '자동정리: 가족번호 기반 가구 연결 후 확인'),
           reviewed_at = now(),
           reviewed_by = auth.uid()
     where m.id in (select member_id from tmp_review_mdb_household_attach)
       and m.review_status = 'unreviewed'
       and m.birth_date is not null
       and m.address is not null
       and not (
         'bad_phone' = any(public.admin_review_member_flags(m.id))
         or 'spouse_mismatch' = any(public.admin_review_member_flags(m.id))
         or 'orphan_child' = any(public.admin_review_member_flags(m.id))
         or 'duplicate_name_birth' = any(public.admin_review_member_flags(m.id))
         or 'duplicate_legacy' = any(public.admin_review_member_flags(m.id))
       );
    get diagnostics v_mdb_verified = row_count;
  else
    select count(*)::int into v_pdf_child_verified
    from public.members m
    where m.id in (select distinct child_id from tmp_review_pdf_parent_links)
      and m.review_status = 'needs_check'
      and (
        m.review_note is null
        or m.review_note = ''
        or m.review_note like '자동검수:%'
      );

    select count(*)::int into v_mdb_verified
    from public.members m
    where m.id in (select member_id from tmp_review_mdb_household_attach)
      and m.review_status = 'unreviewed'
      and m.birth_date is not null
      and m.address is not null;
  end if;

  return query values
    ('mdb_household_members'::text, v_mdb_household_members),
    ('pdf_child_parent_links'::text, v_pdf_child_parent_links),
    ('pdf_child_verified'::text, v_pdf_child_verified),
    ('mdb_verified'::text, v_mdb_verified);
end;
$$;

grant execute on function public.admin_review_safe_auto_cleanup(boolean) to authenticated;

notify pgrst, 'reload schema';
