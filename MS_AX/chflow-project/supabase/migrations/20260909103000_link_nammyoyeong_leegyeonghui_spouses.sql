begin;

do $$
declare
  v_nammyoyeong_id uuid := 'd657d4c9-ff99-42f4-8b89-bcf015790126';
  v_leegyeonghui_id uuid := '8dd23158-a73f-450e-9169-577c70000f64';
begin
  if not exists (
    select 1
    from public.members
    where id = v_nammyoyeong_id
      and name = '남묘영'
      and gender = 'M'
      and spouse_name = '이경희'
      and status = 'active'
  ) or not exists (
    select 1
    from public.members
    where id = v_leegyeonghui_id
      and name = '이경희'
      and gender = 'F'
      and spouse_name = '남묘영'
      and status = 'active'
  ) then
    raise exception '남묘영·이경희 부부 레코드가 예상과 다릅니다.';
  end if;

  update public.members
  set spouse_id = v_leegyeonghui_id
  where id = v_nammyoyeong_id;

  update public.members
  set spouse_id = v_nammyoyeong_id
  where id = v_leegyeonghui_id;

  insert into public.member_relations (subject_id, relative_id, kind, role)
  values
    (v_nammyoyeong_id, v_leegyeonghui_id, 'spouse', 'wife'),
    (v_leegyeonghui_id, v_nammyoyeong_id, 'spouse', 'husband')
  on conflict (subject_id, relative_id, kind)
  do update set role = excluded.role;
end;
$$;

commit;
