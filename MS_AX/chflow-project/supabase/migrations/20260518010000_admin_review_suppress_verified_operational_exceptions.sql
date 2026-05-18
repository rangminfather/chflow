-- Verified operational exceptions should not remain as raw review flags.
-- Examples:
-- - education-roster children whose parents are not registered in members/MDB
-- - manually added active members with no PDF/MDB source but a valid household

update public.members
set
  review_status = 'verified',
  review_note = coalesce(nullif(review_note, ''), 'Verified manual member without PDF/MDB source; household exists'),
  reviewed_at = coalesce(reviewed_at, now())
where id = '10fee249-430e-45db-ae47-1a775cbae2f8'
  and name = '정순남'
  and coalesce(review_status, '') <> 'verified';

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
       and not (
         coalesce(m.review_status, '') = 'verified'
         and coalesce(m.review_note, '') like '%諛곗슦???숇챸?댁씤%'
       )
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
       and coalesce(m.review_status, '') <> 'verified'
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
       and coalesce(m.review_status, '') <> 'verified'
      then 'needs_household'
    end,
    case
      when m.source_page is null
       and m.legacy_kyoin_id is null
       and m.household_id is null
       and coalesce(m.review_status, '') <> 'verified'
      then 'no_household'
    end,
    case
      when m.source_page is null
       and m.legacy_kyoin_id is null
       and coalesce(m.review_status, '') <> 'verified'
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

notify pgrst, 'reload schema';
