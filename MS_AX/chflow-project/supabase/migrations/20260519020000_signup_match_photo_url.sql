drop function if exists public.find_member_for_signup(text, text);

create or replace function public.find_member_for_signup(
  p_name text,
  p_phone text
)
returns table (
  id uuid,
  name text,
  phone text,
  family_church text,
  sub_role text,
  spouse_name text,
  household_id uuid,
  pasture_name text,
  grassland_name text,
  plain_name text,
  address text,
  has_account boolean,
  photo_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.name,
    m.phone,
    m.family_church,
    m.sub_role,
    m.spouse_name,
    m.household_id,
    p.name as pasture_name,
    g.name as grassland_name,
    pl.name as plain_name,
    h.address,
    (m.app_user_id is not null) as has_account,
    m.photo_url
  from public.members m
  left join public.households h on m.household_id = h.id
  left join public.directory_pastures p on h.pasture_id = p.id
  left join public.grasslands g on p.grassland_id = g.id
  left join public.plains pl on g.plain_id = pl.id
  where m.status = 'active'
    and m.name = p_name
    and (
      m.phone = p_phone
      or replace(replace(m.phone, '-', ''), ' ', '') = replace(replace(p_phone, '-', ''), ' ', '')
    )
  limit 5;
$$;

grant execute on function public.find_member_for_signup(text, text) to anon, authenticated;

drop function if exists public.find_child_for_signup(text, text, text);

create or replace function public.find_child_for_signup(
  p_child_name text,
  p_parent_name text,
  p_parent_phone text
)
returns table (
  id uuid,
  name text,
  phone text,
  family_church text,
  sub_role text,
  spouse_name text,
  household_id uuid,
  pasture_name text,
  grassland_name text,
  plain_name text,
  address text,
  has_account boolean,
  parent_id uuid,
  parent_name text,
  parent_phone text,
  photo_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parent_hh uuid;
  v_parent_id uuid;
  v_parent_name text;
  v_parent_phone text;
begin
  select m.id, m.household_id, m.name, m.phone
    into v_parent_id, v_parent_hh, v_parent_name, v_parent_phone
  from public.members m
  where m.name = p_parent_name
    and regexp_replace(coalesce(m.phone, ''), '\D', '', 'g')
        = regexp_replace(p_parent_phone, '\D', '', 'g')
    and m.is_child = false
  limit 1;

  if v_parent_hh is null then
    return;
  end if;

  return query
  select
    m.id,
    m.name,
    m.phone,
    m.family_church,
    m.sub_role,
    m.spouse_name,
    m.household_id,
    p.name as pasture_name,
    g.name as grassland_name,
    pl.name as plain_name,
    h.address,
    (m.app_user_id is not null) as has_account,
    v_parent_id as parent_id,
    v_parent_name as parent_name,
    v_parent_phone as parent_phone,
    m.photo_url
  from public.members m
  left join public.households h on m.household_id = h.id
  left join public.directory_pastures p on h.pasture_id = p.id
  left join public.grasslands g on p.grassland_id = g.id
  left join public.plains pl on g.plain_id = pl.id
  where m.household_id = v_parent_hh
    and m.name = p_child_name
    and m.is_child = true
  limit 5;
end;
$$;

grant execute on function public.find_child_for_signup(text, text, text) to anon, authenticated;
