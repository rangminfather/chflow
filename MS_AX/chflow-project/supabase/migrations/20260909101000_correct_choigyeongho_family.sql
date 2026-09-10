begin;

do $$
declare
  v_choigyeongho_id uuid := '436bc993-7389-4f63-85eb-65bb6442c5f0';
  v_jeonghyeon_id uuid := 'ae6ef837-1944-4f93-acc4-cb132b3263bc';
  v_choigohun_id uuid := 'adeb5bc7-328b-41d8-9065-6dbd4bb92ca3';
  v_choijihyeon_id uuid := '67a5c350-059e-4314-81f0-a857fd4af6a4';
  v_household_id uuid := '3565ad23-7a3c-4992-8438-cbe634677ac7';
begin
  if not exists (
    select 1
    from public.members
    where id = v_choigyeongho_id
      and name = '최경호'
      and household_id = v_household_id
      and status = 'active'
  ) or not exists (
    select 1
    from public.members
    where id = v_jeonghyeon_id
      and name = '정현'
      and household_id = v_household_id
      and status = 'active'
  ) then
    raise exception '최경호·정현 부부 레코드가 예상과 다릅니다.';
  end if;

  if not exists (
    select 1
    from public.members
    where id = v_choigohun_id
      and name in ('고준', '최고훈')
      and household_id = v_household_id
      and status = 'active'
      and is_child is true
  ) or not exists (
    select 1
    from public.members
    where id = v_choijihyeon_id
      and name in ('지현', '최지현')
      and household_id = v_household_id
      and status = 'active'
      and is_child is true
  ) then
    raise exception '최고훈·최지현 자녀 레코드가 예상과 다릅니다.';
  end if;

  update public.members
  set sub_role = '시무장로',
      spouse_name = '정현'
  where id = v_choigyeongho_id;

  update public.members
  set sub_role = '시무권사',
      spouse_name = '최경호',
      gender = 'F'
  where id = v_jeonghyeon_id;

  update public.members
  set name = '최고훈',
      gender = 'M'
  where id = v_choigohun_id;

  update public.members
  set name = '최지현',
      gender = 'F'
  where id = v_choijihyeon_id;
end;
$$;

commit;
