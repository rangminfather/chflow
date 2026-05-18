drop function if exists public.admin_search_members_paged(text, text, text, text, int, int, boolean, boolean);

create or replace function public.admin_search_members_paged(
  p_query         text    default null,
  p_plain         text    default null,
  p_grassland     text    default null,
  p_pasture       text    default null,
  p_offset        int     default 0,
  p_limit         int     default 50,
  p_show_children boolean default true,
  p_show_parents  boolean default true
)
returns table (
  id uuid,
  name text,
  phone text,
  home_phone text,
  gender text,
  family_church text,
  sub_role text,
  spouse_name text,
  address text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  guard_status text,
  has_account boolean,
  is_child boolean,
  source_page int,
  photo_url text,
  household_id uuid,
  pasture_id uuid,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with filtered as (
    select
      m.id, m.name, m.phone, m.home_phone, m.gender, m.family_church, m.sub_role, m.spouse_name,
      h.address,
      p.name  as pasture_name,
      g.name  as grassland_name,
      pl.name as plain_name,
      m.guard_status,
      (m.app_user_id is not null) as has_account,
      m.is_child,
      m.source_page,
      m.photo_url,
      m.household_id,
      h.pasture_id,
      pl.order_no as pl_order,
      g.order_no  as g_order,
      p.order_no  as p_order,
      h.order_no  as h_order
    from public.members m
    left join public.households h          on m.household_id = h.id
    left join public.directory_pastures p  on h.pasture_id = p.id
    left join public.grasslands g          on p.grassland_id = g.id
    left join public.plains pl             on g.plain_id = pl.id
    where
      (
        p_query is null
        or m.name ilike '%' || p_query || '%'
        or m.phone ilike '%' || p_query || '%'
        or m.home_phone ilike '%' || p_query || '%'
        or h.home_phone ilike '%' || p_query || '%'
      )
      and (p_plain is null or pl.name = p_plain)
      and (p_grassland is null or g.name = p_grassland)
      and (p_pasture is null or p.name = p_pasture)
      and (
        p_show_children
        or not exists (
          select 1
          from public.member_relations r
          join public.members rm on rm.id = r.relative_id
          join public.households rh on rh.id = rm.household_id
          where r.subject_id = m.id
            and r.kind in ('parent','grandparent','great_grandparent')
            and rh.pasture_id = h.pasture_id
        )
      )
      and (
        p_show_parents
        or not exists (
          select 1
          from public.member_relations r
          join public.members sm on sm.id = r.subject_id
          join public.households sh on sh.id = sm.household_id
          where r.relative_id = m.id
            and r.kind in ('parent','grandparent','great_grandparent')
            and sh.pasture_id = h.pasture_id
        )
      )
  )
  select
    id, name, phone, home_phone, gender, family_church, sub_role, spouse_name,
    address, pasture_name, grassland_name, plain_name,
    guard_status, has_account, is_child, source_page, photo_url,
    household_id, pasture_id,
    (select count(*) from filtered)::bigint as total_count
  from filtered
  order by pl_order nulls last, g_order nulls last, p_order nulls last, h_order nulls last, name
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.admin_search_members_paged(text, text, text, text, int, int, boolean, boolean) to authenticated;

drop function if exists public.admin_update_member(uuid, text, text, text, text, text, text, boolean, uuid, uuid, boolean, text, uuid[]);

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
  p_home_phone       text default null
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
    is_child      = coalesce(p_is_child, is_child)
  where id = p_member_id;
end;
$$;

grant execute on function public.admin_update_member(uuid, text, text, text, text, text, text, boolean, uuid, uuid, boolean, text, uuid[], text) to authenticated;

drop function if exists public.admin_member_profile(uuid);

create or replace function public.admin_member_profile(p_member_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'member', to_jsonb(m) || jsonb_build_object(
      'address', h.address,
      'household_home_phone', h.home_phone,
      'pasture_name', p.name,
      'grassland_name', g.name,
      'plain_name', pl.name
    ),
    'household_members', (
      select jsonb_agg(jsonb_build_object(
        'id', mm.id, 'name', mm.name, 'phone', mm.phone, 'home_phone', mm.home_phone,
        'family_church', mm.family_church, 'sub_role', mm.sub_role,
        'is_child', mm.is_child, 'photo_url', mm.photo_url, 'gender', mm.gender
      ) order by mm.is_child, mm.name)
      from public.members mm where mm.household_id = m.household_id and mm.id <> m.id
    ),
    'relations', (
      select jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'role', r.role,
        'relative_id', r.relative_id,
        'name', rm.name, 'phone', rm.phone, 'home_phone', rm.home_phone,
        'photo_url', rm.photo_url,
        'pasture_name', rp.name,
        'plain_name', rpl.name,
        'direction', 'ancestor'
      ))
      from public.member_relations r
      join public.members rm on rm.id = r.relative_id
      left join public.households rh on rm.household_id = rh.id
      left join public.directory_pastures rp on rh.pasture_id = rp.id
      left join public.grasslands rg on rp.grassland_id = rg.id
      left join public.plains rpl on rg.plain_id = rpl.id
      where r.subject_id = p_member_id
    ),
    'descendants', (
      select jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'role', r.role,
        'relative_id', r.subject_id,
        'name', sm.name, 'phone', sm.phone, 'home_phone', sm.home_phone,
        'photo_url', sm.photo_url,
        'pasture_name', sp.name,
        'plain_name', spl.name,
        'direction', 'descendant'
      ))
      from public.member_relations r
      join public.members sm on sm.id = r.subject_id
      left join public.households sh on sm.household_id = sh.id
      left join public.directory_pastures sp on sh.pasture_id = sp.id
      left join public.grasslands sg on sp.grassland_id = sg.id
      left join public.plains spl on sg.plain_id = spl.id
      where r.relative_id = p_member_id and r.kind <> 'spouse'
    )
  )
  from public.members m
  left join public.households h on m.household_id = h.id
  left join public.directory_pastures p on h.pasture_id = p.id
  left join public.grasslands g on p.grassland_id = g.id
  left join public.plains pl on g.plain_id = pl.id
  where m.id = p_member_id;
$$;

grant execute on function public.admin_member_profile(uuid) to authenticated;

drop function if exists public.search_member_candidates(text, text, int);

create or replace function public.search_member_candidates(
  p_name  text,
  p_phone text default null,
  p_limit int  default 10
)
returns table (
  id uuid,
  name text,
  phone text,
  home_phone text,
  gender text,
  family_church text,
  sub_role text,
  address text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  is_child boolean,
  household_id uuid,
  pasture_id uuid,
  match_score int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id, m.name, m.phone, m.home_phone, m.gender, m.family_church, m.sub_role,
    h.address,
    p.name  as pasture_name,
    g.name  as grassland_name,
    pl.name as plain_name,
    m.is_child,
    m.household_id,
    h.pasture_id,
    case
      when p_phone is not null and (
        regexp_replace(coalesce(m.phone,''), '\D','','g') = regexp_replace(p_phone, '\D','','g')
        or regexp_replace(coalesce(m.home_phone,''), '\D','','g') = regexp_replace(p_phone, '\D','','g')
        or regexp_replace(coalesce(h.home_phone,''), '\D','','g') = regexp_replace(p_phone, '\D','','g')
      ) then 100
      when p_phone is not null and (
        right(regexp_replace(coalesce(m.phone,''), '\D','','g'), 4) = right(regexp_replace(p_phone, '\D','','g'), 4)
        or right(regexp_replace(coalesce(m.home_phone,''), '\D','','g'), 4) = right(regexp_replace(p_phone, '\D','','g'), 4)
        or right(regexp_replace(coalesce(h.home_phone,''), '\D','','g'), 4) = right(regexp_replace(p_phone, '\D','','g'), 4)
      ) then 80
      when m.name = p_name then 50
      else 10
    end as match_score
  from public.members m
  left join public.households h          on m.household_id = h.id
  left join public.directory_pastures p  on h.pasture_id = p.id
  left join public.grasslands g          on p.grassland_id = g.id
  left join public.plains pl             on g.plain_id = pl.id
  where m.name = p_name
  order by match_score desc, m.is_child asc, m.name
  limit p_limit;
$$;

grant execute on function public.search_member_candidates(text, text, int) to anon, authenticated;

notify pgrst, 'reload schema';
