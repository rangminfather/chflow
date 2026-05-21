-- Admin member read RPCs are callable by authenticated users so that app
-- admins can use them through PostgREST. Keep the execute grant, but enforce
-- the admin/office/pastor role inside each SECURITY DEFINER function.

create or replace function public.admin_search_members(
  p_query text default null,
  p_plain text default null,
  p_grassland text default null,
  p_pasture text default null,
  p_limit int default 100
)
returns table (
  id uuid,
  name text,
  phone text,
  family_church text,
  sub_role text,
  spouse_name text,
  address text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  guard_status text,
  has_account boolean,
  source_page int
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
    h.address,
    p.name as pasture_name,
    g.name as grassland_name,
    pl.name as plain_name,
    m.guard_status,
    (m.app_user_id is not null) as has_account,
    m.source_page
  from public.members m
  left join public.households h on h.id = m.household_id
  left join public.directory_pastures p on p.id = h.pasture_id
  left join public.grasslands g on g.id = p.grassland_id
  left join public.plains pl on pl.id = g.plain_id
  where coalesce(public.get_user_role(), '') in ('admin', 'office', 'pastor')
    and (p_query is null or m.name ilike '%' || p_query || '%' or m.phone ilike '%' || p_query || '%')
    and (p_plain is null or pl.name = p_plain)
    and (p_grassland is null or g.name = p_grassland)
    and (p_pasture is null or p.name = p_pasture)
  order by pl.order_no nulls last, g.order_no nulls last, p.order_no nulls last, h.order_no nulls last, m.name
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

grant execute on function public.admin_search_members(text, text, text, text, int) to authenticated;

drop function if exists public.admin_search_members_paged(text, text, text, text, int, int, boolean, boolean);
drop function if exists public.admin_search_members_paged(text, text, text, text, int, int, boolean, boolean, text);

create or replace function public.admin_search_members_paged(
  p_query         text    default null,
  p_plain         text    default null,
  p_grassland     text    default null,
  p_pasture       text    default null,
  p_offset        int     default 0,
  p_limit         int     default 50,
  p_show_children boolean default true,
  p_show_parents  boolean default true,
  p_member_status text    default 'active'
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
  status text,
  has_account boolean,
  is_child boolean,
  source_page int,
  photo_url text,
  household_id uuid,
  pasture_id uuid,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then
    raise exception '권한이 없습니다';
  end if;

  return query
  with filtered as (
    select
      m.id,
      m.name,
      m.phone,
      m.home_phone,
      m.gender,
      m.family_church,
      m.sub_role,
      m.spouse_name,
      h.address,
      p.name as pasture_name,
      g.name as grassland_name,
      pl.name as plain_name,
      m.guard_status,
      m.status,
      (m.app_user_id is not null) as has_account,
      m.is_child,
      m.source_page,
      m.photo_url,
      m.household_id,
      h.pasture_id,
      pl.order_no as pl_order,
      g.order_no as g_order,
      p.order_no as p_order,
      h.order_no as h_order
    from public.members m
    left join public.households h on h.id = m.household_id
    left join public.directory_pastures p on p.id = h.pasture_id
    left join public.grasslands g on g.id = p.grassland_id
    left join public.plains pl on pl.id = g.plain_id
    where (
        p_member_status is null
        or p_member_status = 'all'
        or m.status = p_member_status
      )
      and (
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
            and r.kind in ('parent', 'grandparent', 'great_grandparent')
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
            and r.kind in ('parent', 'grandparent', 'great_grandparent')
            and sh.pasture_id = h.pasture_id
        )
      )
  )
  select
    f.id,
    f.name,
    f.phone,
    f.home_phone,
    f.gender,
    f.family_church,
    f.sub_role,
    f.spouse_name,
    f.address,
    f.pasture_name,
    f.grassland_name,
    f.plain_name,
    f.guard_status,
    f.status,
    f.has_account,
    f.is_child,
    f.source_page,
    f.photo_url,
    f.household_id,
    f.pasture_id,
    (select count(*) from filtered)::bigint as total_count
  from filtered f
  order by f.pl_order nulls last, f.g_order nulls last, f.p_order nulls last, f.h_order nulls last, f.name
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 50), 1), 500);
end;
$$;

grant execute on function public.admin_search_members_paged(text, text, text, text, int, int, boolean, boolean, text) to authenticated;

drop function if exists public.admin_member_profile(uuid);

create or replace function public.admin_member_profile(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then
    raise exception '권한이 없습니다';
  end if;

  return (
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
          'id', mm.id,
          'name', mm.name,
          'phone', mm.phone,
          'home_phone', mm.home_phone,
          'family_church', mm.family_church,
          'sub_role', mm.sub_role,
          'is_child', mm.is_child,
          'photo_url', mm.photo_url,
          'gender', mm.gender
        ) order by mm.is_child, mm.name)
        from public.members mm
        where mm.household_id = m.household_id
          and mm.id <> m.id
      ),
      'relations', (
        select jsonb_agg(jsonb_build_object(
          'kind', r.kind,
          'role', r.role,
          'relative_id', r.relative_id,
          'name', rm.name,
          'phone', rm.phone,
          'home_phone', rm.home_phone,
          'photo_url', rm.photo_url,
          'pasture_name', rp.name,
          'plain_name', rpl.name,
          'direction', 'ancestor'
        ))
        from public.member_relations r
        join public.members rm on rm.id = r.relative_id
        left join public.households rh on rh.id = rm.household_id
        left join public.directory_pastures rp on rp.id = rh.pasture_id
        left join public.grasslands rg on rg.id = rp.grassland_id
        left join public.plains rpl on rpl.id = rg.plain_id
        where r.subject_id = p_member_id
      ),
      'descendants', (
        select jsonb_agg(jsonb_build_object(
          'kind', r.kind,
          'role', r.role,
          'relative_id', r.subject_id,
          'name', sm.name,
          'phone', sm.phone,
          'home_phone', sm.home_phone,
          'photo_url', sm.photo_url,
          'pasture_name', sp.name,
          'plain_name', spl.name,
          'direction', 'descendant'
        ))
        from public.member_relations r
        join public.members sm on sm.id = r.subject_id
        left join public.households sh on sh.id = sm.household_id
        left join public.directory_pastures sp on sp.id = sh.pasture_id
        left join public.grasslands sg on sg.id = sp.grassland_id
        left join public.plains spl on spl.id = sg.plain_id
        where r.relative_id = p_member_id
          and r.kind <> 'spouse'
      )
    )
    from public.members m
    left join public.households h on h.id = m.household_id
    left join public.directory_pastures p on p.id = h.pasture_id
    left join public.grasslands g on g.id = p.grassland_id
    left join public.plains pl on pl.id = g.plain_id
    where m.id = p_member_id
  );
end;
$$;

grant execute on function public.admin_member_profile(uuid) to authenticated;
