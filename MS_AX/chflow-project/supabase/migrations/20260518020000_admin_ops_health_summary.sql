create or replace function public.admin_ops_health_summary()
returns table (
  checked_at timestamptz,
  members_total bigint,
  active_members bigint,
  not_verified_members bigint,
  members_with_review_flags bigint,
  total_review_flags bigint,
  duplicate_legacy_members bigint,
  duplicate_name_birth_members bigint,
  codex_temp_profiles bigint,
  ops_temp_members bigint,
  pdf_needs_check bigint,
  pdf_needs_household bigint,
  pdf_no_photo bigint,
  pdf_spouse_mismatch bigint,
  pdf_bad_phone bigint,
  pdf_orphan_child bigint,
  pdf_duplicate_name_birth bigint,
  pdf_duplicate_legacy bigint,
  mdb_needs_check bigint,
  mdb_needs_household bigint,
  mdb_no_photo bigint,
  mdb_spouse_mismatch bigint,
  mdb_bad_phone bigint,
  mdb_orphan_child bigint,
  mdb_duplicate_name_birth bigint,
  mdb_duplicate_legacy bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with flag_rows as (
    select m.id, f.flag
    from public.members m
    cross join lateral unnest(public.admin_review_member_flags(m.id)) as f(flag)
  )
  select
    now() as checked_at,
    (select count(*) from public.members) as members_total,
    (select count(*) from public.members where status = 'active') as active_members,
    (select count(*) from public.members where coalesce(review_status, '') <> 'verified') as not_verified_members,
    (select count(distinct id) from flag_rows) as members_with_review_flags,
    (select count(*) from flag_rows) as total_review_flags,
    (
      select count(*)
      from public.members m
      where m.legacy_kyoin_id is not null
        and exists (
          select 1
          from public.members d
          where d.id <> m.id
            and d.legacy_kyoin_id = m.legacy_kyoin_id
        )
    ) as duplicate_legacy_members,
    (
      select count(*)
      from public.members m
      where m.birth_date is not null
        and exists (
          select 1
          from public.members d
          where d.id <> m.id
            and d.name = m.name
            and d.birth_date = m.birth_date
        )
    ) as duplicate_name_birth_members,
    (select count(*) from public.profiles where username like 'codex%') as codex_temp_profiles,
    (select count(*) from public.members where name like '운영점검_%') as ops_temp_members,
    (select count(*) from public.admin_review_pdf_members('needs_check')) as pdf_needs_check,
    (select count(*) from public.admin_review_pdf_members('needs_household')) as pdf_needs_household,
    (select count(*) from public.admin_review_pdf_members('no_photo')) as pdf_no_photo,
    (select count(*) from public.admin_review_pdf_members('spouse_mismatch')) as pdf_spouse_mismatch,
    (select count(*) from public.admin_review_pdf_members('bad_phone')) as pdf_bad_phone,
    (select count(*) from public.admin_review_pdf_members('orphan_child')) as pdf_orphan_child,
    (select count(*) from public.admin_review_pdf_members('duplicate_name_birth')) as pdf_duplicate_name_birth,
    (select count(*) from public.admin_review_pdf_members('duplicate_legacy')) as pdf_duplicate_legacy,
    (select count(*) from public.admin_review_mdb_members('needs_check')) as mdb_needs_check,
    (select count(*) from public.admin_review_mdb_members('needs_household')) as mdb_needs_household,
    (select count(*) from public.admin_review_mdb_members('no_photo')) as mdb_no_photo,
    (select count(*) from public.admin_review_mdb_members('spouse_mismatch')) as mdb_spouse_mismatch,
    (select count(*) from public.admin_review_mdb_members('bad_phone')) as mdb_bad_phone,
    (select count(*) from public.admin_review_mdb_members('orphan_child')) as mdb_orphan_child,
    (select count(*) from public.admin_review_mdb_members('duplicate_name_birth')) as mdb_duplicate_name_birth,
    (select count(*) from public.admin_review_mdb_members('duplicate_legacy')) as mdb_duplicate_legacy
  where public.get_user_role() = 'admin';
$$;

grant execute on function public.admin_ops_health_summary() to authenticated;

notify pgrst, 'reload schema';
