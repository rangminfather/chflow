begin;

do $$
declare
  v_leegiheon_id uuid := '94eab1d7-05c8-4e5c-8a5a-0f257e728c32';
  v_kwongilja_id uuid := 'd8af8b4c-9a65-4865-a2c6-19c225582108';
  v_leehyeonjeong_id uuid := '525d0a7f-aa6a-4f3d-871c-f788b3ccbe75';
  v_leeboram_id uuid := '25a598f2-9c99-4b0a-9728-4d3667db09d5';
  v_leesangjeong_id uuid := '6884665d-5f5f-4f62-8123-27b5d8a47437';
  v_kimgapsim_id uuid := '86636519-633e-423f-8722-6ac30ca02474';
  v_leegahyeon_id uuid := 'f8110fe8-99cf-4eb9-85f8-03afc4afd147';
begin
  if not exists (
    select 1
    from public.members
    where id = v_leegiheon_id
      and name in ('이기현', '이기헌')
      and household_id = '0e9f52e8-505e-4b5e-a3c8-3b55d7cfecac'::uuid
      and status = 'active'
  ) then
    raise exception '이기헌 가족의 현재 세대주 레코드가 예상과 다릅니다.';
  end if;

  if not exists (
    select 1
    from public.members
    where id = v_kwongilja_id
      and name = '권길자'
      and household_id = '0e9f52e8-505e-4b5e-a3c8-3b55d7cfecac'::uuid
      and status = 'active'
  ) then
    raise exception '권길자 레코드가 예상과 다릅니다.';
  end if;

  if not exists (
    select 1
    from public.members
    where id = v_leehyeonjeong_id
      and name in ('현정', '이현정')
      and household_id = '0e9f52e8-505e-4b5e-a3c8-3b55d7cfecac'::uuid
      and is_child is true
  ) or not exists (
    select 1
    from public.members
    where id = v_leeboram_id
      and name in ('보람', '이보람')
      and household_id = '0e9f52e8-505e-4b5e-a3c8-3b55d7cfecac'::uuid
      and is_child is true
  ) then
    raise exception '이현정·이보람 자녀 레코드가 예상과 다릅니다.';
  end if;

  if not exists (
    select 1 from public.members
    where id = v_leesangjeong_id and name = '이상정' and status = 'active'
  ) or not exists (
    select 1 from public.members
    where id = v_kimgapsim_id and name = '김갑심' and status = 'active'
  ) or not exists (
    select 1 from public.members
    where id = v_leegahyeon_id and name = '이가현' and status = 'active'
  ) then
    raise exception '이상정·김갑심·이가현 레코드가 예상과 다릅니다.';
  end if;

  update public.members
  set name = '이기헌',
      gender = 'M',
      spouse_name = '권길자'
  where id = v_leegiheon_id;

  update public.members
  set spouse_name = '이기헌'
  where id = v_kwongilja_id;

  update public.members
  set name = '이현정',
      gender = 'F'
  where id = v_leehyeonjeong_id;

  update public.members
  set name = '이보람',
      gender = 'F'
  where id = v_leeboram_id;

  -- These imported rows incorrectly joined the two unrelated families and
  -- caused the Lee Gi-heon household to appear in Kim Gap-sim searches.
  delete from public.member_relations
  where id in (
    'af947ee4-4201-4c45-9514-8c627033b15e'::uuid,
    '261c20a8-8a28-4a84-afca-32ff69a98c1b'::uuid,
    'e80dbdca-19dd-4498-9d49-cfdf43a414da'::uuid,
    '82ca7271-fa42-4fa8-ad92-63b6d4e917be'::uuid,
    '48b8eda2-6b9d-4015-8316-8f6279796a94'::uuid,
    '77a90c39-836d-4e5b-ab9d-5756584a2b24'::uuid
  );

  update public.member_relations
  set role = 'father'
  where subject_id in (v_leehyeonjeong_id, v_leeboram_id)
    and relative_id = v_leegiheon_id
    and kind = 'parent';

  update public.member_relations
  set role = 'mother'
  where subject_id in (v_leehyeonjeong_id, v_leeboram_id)
    and relative_id = v_kwongilja_id
    and kind = 'parent';

  insert into public.member_relations (subject_id, relative_id, kind, role)
  values
    (v_leegahyeon_id, v_leesangjeong_id, 'parent', 'father'),
    (v_leegahyeon_id, v_kimgapsim_id, 'parent', 'mother')
  on conflict (subject_id, relative_id, kind)
  do update set role = excluded.role;
end;
$$;

commit;
