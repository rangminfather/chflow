-- Follow-up cleanup:
-- - MDB-only unreviewed rows with no serious risk are considered reviewed.
--   `needs_household` remains as an operational assignment flag.
-- - MDB-only child rows can receive parent links from the same MDB family number
--   when the child is young and one or two plausible adult parents are present.

drop function if exists public.admin_review_safe_auto_cleanup_v2(boolean);
create or replace function public.admin_review_safe_auto_cleanup_v2(p_apply boolean default false)
returns table (
  action text,
  affected_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mdb_low_risk_verified int := 0;
  v_mdb_child_parent_links int := 0;
  v_mdb_child_verified int := 0;
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception 'permission denied';
  end if;

  create temporary table if not exists tmp_review_mdb_parent_links (
    child_id uuid not null,
    parent_id uuid not null,
    role text,
    primary key (child_id, parent_id)
  ) on commit drop;
  truncate tmp_review_mdb_parent_links;

  insert into tmp_review_mdb_parent_links(child_id, parent_id, role)
  with candidates as (
    select
      c.id as child_id,
      p.id as parent_id,
      case when p.gender = 'M' then 'father'
           when p.gender = 'F' then 'mother'
           else null end as role,
      count(*) over (partition by c.id) as parent_count
    from public.members c
    join public.members p
      on p.legacy_family_num = c.legacy_family_num
     and p.id <> c.id
     and coalesce(p.is_child, false) = false
    where c.source_page is null
      and c.legacy_kyoin_id is not null
      and c.legacy_family_num is not null
      and coalesce(c.is_child, false) = true
      and c.birth_date >= date '2006-01-01'
      and 'orphan_child' = any(public.admin_review_member_flags(c.id))
      and not exists (
        select 1
        from public.member_relations r
        where r.subject_id = c.id
          and r.kind <> 'spouse'
      )
      and (
        p.birth_date is null
        or p.birth_date <= (c.birth_date - interval '15 years')::date
      )
  )
  select child_id, parent_id, role
  from candidates
  where parent_count between 1 and 2;

  select count(*)::int into v_mdb_child_parent_links
  from tmp_review_mdb_parent_links;

  if p_apply then
    insert into public.member_relations(subject_id, relative_id, kind, role, created_by)
    select child_id, parent_id, 'parent', role, auth.uid()
    from tmp_review_mdb_parent_links
    on conflict (subject_id, relative_id, kind)
    do update set role = coalesce(excluded.role, public.member_relations.role);

    update public.members m
       set review_status = 'verified',
           review_note = concat_ws('; ', nullif(m.review_note, ''), '자동정리: MDB 가족번호 기준 부모관계 연결 후 확인'),
           reviewed_at = now(),
           reviewed_by = auth.uid()
     where m.id in (select distinct child_id from tmp_review_mdb_parent_links)
       and m.review_status = 'needs_check'
       and not (
         'bad_phone' = any(public.admin_review_member_flags(m.id))
         or 'spouse_mismatch' = any(public.admin_review_member_flags(m.id))
         or 'orphan_child' = any(public.admin_review_member_flags(m.id))
         or 'duplicate_name_birth' = any(public.admin_review_member_flags(m.id))
         or 'duplicate_legacy' = any(public.admin_review_member_flags(m.id))
       );
    get diagnostics v_mdb_child_verified = row_count;

    update public.members m
       set review_status = 'verified',
           review_note = concat_ws('; ', nullif(m.review_note, ''), '자동정리: MDB 기록 기준 확인, 목장배정은 별도 정리'),
           reviewed_at = now(),
           reviewed_by = auth.uid()
     where m.source_page is null
       and m.legacy_kyoin_id is not null
       and m.review_status = 'unreviewed'
       and not (
         'bad_phone' = any(public.admin_review_member_flags(m.id))
         or 'spouse_mismatch' = any(public.admin_review_member_flags(m.id))
         or 'orphan_child' = any(public.admin_review_member_flags(m.id))
         or 'duplicate_name_birth' = any(public.admin_review_member_flags(m.id))
         or 'duplicate_legacy' = any(public.admin_review_member_flags(m.id))
       );
    get diagnostics v_mdb_low_risk_verified = row_count;
  else
    select count(*)::int into v_mdb_child_verified
    from public.members m
    where m.id in (select distinct child_id from tmp_review_mdb_parent_links)
      and m.review_status = 'needs_check'
      and not (
        'bad_phone' = any(public.admin_review_member_flags(m.id))
        or 'spouse_mismatch' = any(public.admin_review_member_flags(m.id))
        or 'duplicate_name_birth' = any(public.admin_review_member_flags(m.id))
        or 'duplicate_legacy' = any(public.admin_review_member_flags(m.id))
      );

    select count(*)::int into v_mdb_low_risk_verified
    from public.members m
    where m.source_page is null
      and m.legacy_kyoin_id is not null
      and m.review_status = 'unreviewed'
      and not (
        'bad_phone' = any(public.admin_review_member_flags(m.id))
        or 'spouse_mismatch' = any(public.admin_review_member_flags(m.id))
        or 'orphan_child' = any(public.admin_review_member_flags(m.id))
        or 'duplicate_name_birth' = any(public.admin_review_member_flags(m.id))
        or 'duplicate_legacy' = any(public.admin_review_member_flags(m.id))
      );
  end if;

  return query values
    ('mdb_child_parent_links'::text, v_mdb_child_parent_links),
    ('mdb_child_verified'::text, v_mdb_child_verified),
    ('mdb_low_risk_verified'::text, v_mdb_low_risk_verified);
end;
$$;

grant execute on function public.admin_review_safe_auto_cleanup_v2(boolean) to authenticated;

notify pgrst, 'reload schema';
