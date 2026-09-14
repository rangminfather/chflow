-- 요람검색 "관리자 빠른 수정"에서 생년월일도 수정할 수 있도록 admin_update_member에 p_birth_date 추가.
-- 자녀는 이미 member_update_child로 생년월일 수정 가능 — 성인 회원(빠른 수정)에는 없었던 필드를 보강.

drop function if exists public.admin_update_member(uuid, text, text, text, text, text, text, boolean, uuid, uuid, boolean, text, uuid[], text);

create or replace function public.admin_update_member(
  p_member_id        uuid,
  p_name             text default null,
  p_phone            text default null,
  p_family_church    text default null,
  p_sub_role         text default null,
  p_spouse_name      text default null,
  p_gender           text default null,
  p_is_child         boolean default null,
  p_household_id     uuid default null,
  p_split_pasture_id uuid default null,
  p_clear_household  boolean default false,
  p_address          text default null,
  p_move_member_ids  uuid[] default null,
  p_home_phone       text default null,
  p_birth_date       date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_hh          uuid;
  v_old_pasture     uuid;
  v_old_address     text;
  v_new_hh          uuid;
  v_remaining       int;
  v_household_count int;
  v_move_count      int;
  v_invalid_count   int;
  v_target_pasture  uuid;
  v_target_address  text;
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception '권한이 없습니다';
  end if;

  if (p_household_id is not null)::int + (p_split_pasture_id is not null)::int + (p_clear_household is true)::int > 1 then
    raise exception '가족 합류 / 신규 가족 분리 / 소속 비우기 중 하나만 지정할 수 있습니다';
  end if;

  if p_move_member_ids is not null and (p_household_id is not null or p_clear_household is true) then
    raise exception '가족 합류 / 소속 비우기는 가족 단위 이동과 같이 사용할 수 없습니다';
  end if;

  if p_household_id is not null or p_clear_household is true then
    select household_id into v_old_hh from public.members where id = p_member_id;
    if not found then
      raise exception '해당 회원을 찾을 수 없습니다';
    end if;

    if p_clear_household is true then
      v_new_hh := null;
    else
      v_new_hh := p_household_id;
      perform 1 from public.households where id = v_new_hh;
      if not found then
        raise exception '대상 가족을 찾을 수 없습니다';
      end if;
    end if;

    if v_old_hh is distinct from v_new_hh then
      update public.members set household_id = v_new_hh where id = p_member_id;

      if v_old_hh is not null then
        select count(*) into v_remaining from public.members where household_id = v_old_hh;
        if v_remaining = 0 then
          delete from public.households where id = v_old_hh;
        end if;
      end if;
    end if;

  elsif p_move_member_ids is not null then
    if array_length(p_move_member_ids, 1) is null then
      raise exception '이동 대상 회원이 비어 있습니다';
    end if;

    if not (p_member_id = any(p_move_member_ids)) then
      raise exception '이동 대상에 본인이 포함되어야 합니다';
    end if;

    select household_id into v_old_hh from public.members where id = p_member_id;
    if not found then
      raise exception '해당 회원을 찾을 수 없습니다';
    end if;
    if v_old_hh is null then
      raise exception '소속 가족이 없는 회원은 가족 단위 이동을 할 수 없습니다';
    end if;

    select count(*) into v_invalid_count
    from public.members
    where id = any(p_move_member_ids)
      and (household_id is distinct from v_old_hh);
    if v_invalid_count > 0 then
      raise exception '이동 대상은 모두 같은 가족이어야 합니다';
    end if;

    select pasture_id, address into v_old_pasture, v_old_address
    from public.households where id = v_old_hh;

    v_target_pasture := coalesce(p_split_pasture_id, v_old_pasture);
    v_target_address := coalesce(p_address, v_old_address);

    select count(*) into v_household_count from public.members where household_id = v_old_hh;
    v_move_count := array_length(p_move_member_ids, 1);

    if v_household_count = v_move_count then
      update public.households
        set pasture_id = v_target_pasture,
            address    = v_target_address
        where id = v_old_hh;
    else
      insert into public.households (pasture_id, address, home_phone, order_no)
      values (v_target_pasture, v_target_address, '', 0)
      returning id into v_new_hh;

      update public.members set household_id = v_new_hh
        where id = any(p_move_member_ids);

      select count(*) into v_remaining from public.members where household_id = v_old_hh;
      if v_remaining = 0 then
        delete from public.households where id = v_old_hh;
      end if;
    end if;

  elsif p_split_pasture_id is not null then
    select household_id into v_old_hh from public.members where id = p_member_id;
    if not found then
      raise exception '해당 회원을 찾을 수 없습니다';
    end if;

    insert into public.households (pasture_id, address, home_phone, order_no)
    values (p_split_pasture_id, coalesce(p_address, ''), '', 0)
    returning id into v_new_hh;

    if v_old_hh is distinct from v_new_hh then
      update public.members set household_id = v_new_hh where id = p_member_id;

      if v_old_hh is not null then
        select count(*) into v_remaining from public.members where household_id = v_old_hh;
        if v_remaining = 0 then
          delete from public.households where id = v_old_hh;
        end if;
      end if;
    end if;
  end if;

  update public.members set
    name          = coalesce(p_name, name),
    phone         = coalesce(p_phone, phone),
    home_phone    = coalesce(p_home_phone, home_phone),
    family_church = coalesce(p_family_church, family_church),
    sub_role      = coalesce(p_sub_role, sub_role),
    spouse_name   = coalesce(p_spouse_name, spouse_name),
    gender        = coalesce(p_gender, gender),
    is_child      = coalesce(p_is_child, is_child),
    birth_date    = coalesce(p_birth_date, birth_date)
  where id = p_member_id;
end;
$$;

grant execute on function public.admin_update_member(uuid, text, text, text, text, text, text, boolean, uuid, uuid, boolean, text, uuid[], text, date) to authenticated;
