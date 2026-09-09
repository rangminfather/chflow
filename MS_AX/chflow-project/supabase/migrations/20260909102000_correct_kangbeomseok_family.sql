begin;

do $$
declare
  v_kangdaegyu_id uuid := 'bd3e78f6-2884-4f93-95fa-7d090175e430';
  v_leenamseon_id uuid := '5e7f4fd1-9905-440d-ae6b-08f044c6a1d4';
  v_kangjinhee_id uuid := '96cf076d-ebab-4578-b587-1af72aa1026c';
  v_kangjiwoon_id uuid := 'ee4680d5-2e33-42be-aa06-fa3587cca60d';
  v_kangbeomseok_id uuid := '7e42acd4-4af3-401e-ac9c-7d158f39b38e';
  v_duplicate_beomseok_id uuid := '9e1f62fa-bb6c-427b-a773-8888a5193f85';
  v_parent_household_id uuid := 'baa5398f-156c-4094-85f7-a2a3362858e6';
begin
  if not exists (
    select 1
    from public.members
    where id = v_kangdaegyu_id
      and name = '강대규'
      and household_id = v_parent_household_id
      and status = 'active'
  ) or not exists (
    select 1
    from public.members
    where id = v_leenamseon_id
      and name = '이남선'
      and sub_role = '은퇴권사'
      and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = '01030695451'
      and household_id = v_parent_household_id
      and status = 'active'
  ) then
    raise exception '강대규·이남선 부모 레코드가 예상과 다릅니다.';
  end if;

  if not exists (
    select 1
    from public.members
    where id = v_kangjinhee_id
      and name in ('진희', '강진희')
      and household_id = v_parent_household_id
      and status = 'active'
      and is_child is true
  ) or not exists (
    select 1
    from public.members
    where id = v_kangjiwoon_id
      and name in ('지운', '강지운')
      and household_id = v_parent_household_id
      and status = 'active'
      and is_child is true
  ) then
    raise exception '강진희·강지운 자녀 레코드가 예상과 다릅니다.';
  end if;

  if not exists (
    select 1
    from public.members
    where id = v_kangbeomseok_id
      and name = '강범석'
      and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = '01044145451'
      and status = 'active'
  ) then
    raise exception '강범석 회원 레코드가 예상과 다릅니다.';
  end if;

  update public.members
  set name = '강진희',
      gender = 'F',
      child_order = 1
  where id = v_kangjinhee_id;

  update public.members
  set name = '강지운',
      gender = 'F',
      child_order = 2
  where id = v_kangjiwoon_id;

  update public.members
  set gender = 'M',
      child_order = 3
  where id = v_kangbeomseok_id;

  delete from public.member_relations
  where subject_id = v_duplicate_beomseok_id
    and relative_id in (v_kangdaegyu_id, v_leenamseon_id)
    and kind = 'parent';

  update public.members
  set status = 'inactive',
      household_id = null,
      child_order = null
  where id = v_duplicate_beomseok_id
    and name = '범석';

  insert into public.member_relations (subject_id, relative_id, kind, role)
  values
    (v_kangbeomseok_id, v_kangdaegyu_id, 'parent', 'father'),
    (v_kangbeomseok_id, v_leenamseon_id, 'parent', 'mother')
  on conflict (subject_id, relative_id, kind)
  do update set role = excluded.role;
end;
$$;

commit;
