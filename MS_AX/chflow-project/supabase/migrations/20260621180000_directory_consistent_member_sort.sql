-- Keep directory ordering consistent across search results and profile lists.
-- Priority: search relevance, adult before child, male before female, then name.

create or replace function public.directory_search_members(
  p_query     text default null,
  p_plain     text default null,
  p_grassland text default null,
  p_pasture   text default null,
  p_offset    int  default 0,
  p_limit     int  default 30
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
  pasture_name text,
  grassland_name text,
  plain_name text,
  is_child boolean,
  photo_url text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select
      nullif(trim(p_query), '') as query_text,
      nullif(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), '') as query_digits
  ),
  filtered as (
    select
      m.id,
      m.name,
      m.phone,
      m.home_phone,
      m.gender,
      m.family_church,
      m.sub_role,
      m.spouse_name,
      p.name as pasture_name,
      g.name as grassland_name,
      pl.name as plain_name,
      m.is_child,
      m.photo_url,
      case
        when i.query_text is null then 0
        when lower(m.name) = lower(i.query_text) then 0
        when m.name ilike i.query_text || '%' then 1
        when m.name ilike '%' || i.query_text || '%' then 2
        else 3
      end as match_order
    from public.members m
    left join public.households h on h.id = m.household_id
    left join public.directory_pastures p on p.id = h.pasture_id
    left join public.grasslands g on g.id = p.grassland_id
    left join public.plains pl on pl.id = g.plain_id
    cross join input i
    where m.status = 'active'
      and (
        i.query_text is null
        or m.name ilike '%' || i.query_text || '%'
        or coalesce(m.spouse_name, '') ilike '%' || i.query_text || '%'
        or coalesce(p.name, '') ilike '%' || i.query_text || '%'
        or coalesce(g.name, '') ilike '%' || i.query_text || '%'
        or coalesce(pl.name, '') ilike '%' || i.query_text || '%'
        or (
          i.query_digits is not null
          and (
            regexp_replace(coalesce(m.phone, ''), '\D', '', 'g') like '%' || i.query_digits || '%'
            or regexp_replace(coalesce(m.home_phone, ''), '\D', '', 'g') like '%' || i.query_digits || '%'
            or regexp_replace(coalesce(h.home_phone, ''), '\D', '', 'g') like '%' || i.query_digits || '%'
          )
        )
      )
      and (nullif(p_plain, '') is null or pl.name = p_plain)
      and (nullif(p_grassland, '') is null or g.name = p_grassland)
      and (nullif(p_pasture, '') is null or p.name = p_pasture)
  )
  select
    id,
    name,
    phone,
    home_phone,
    gender,
    family_church,
    sub_role,
    spouse_name,
    pasture_name,
    grassland_name,
    plain_name,
    is_child,
    photo_url,
    (select count(*) from filtered)::bigint as total_count
  from filtered
  order by
    match_order,
    coalesce(is_child, false),
    case gender when 'M' then 0 when 'F' then 1 else 2 end,
    name,
    id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

grant execute on function public.directory_search_members(text, text, text, text, int, int) to authenticated;

create or replace function public.directory_member_profile(p_member_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'member', jsonb_build_object(
      'id', m.id,
      'name', m.name,
      'phone', m.phone,
      'home_phone', m.home_phone,
      'gender', m.gender,
      'family_church', m.family_church,
      'sub_role', m.sub_role,
      'spouse_name', m.spouse_name,
      'is_child', m.is_child,
      'photo_url', m.photo_url,
      'address', h.address,
      'household_home_phone', h.home_phone,
      'pasture_name', p.name,
      'grassland_name', g.name,
      'plain_name', pl.name
    ),
    'household_members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', hm.id,
        'name', hm.name,
        'phone', hm.phone,
        'home_phone', hm.home_phone,
        'gender', hm.gender,
        'family_church', hm.family_church,
        'sub_role', hm.sub_role,
        'spouse_name', hm.spouse_name,
        'is_child', hm.is_child,
        'photo_url', hm.photo_url
      ) order by
        coalesce(hm.is_child, false),
        case hm.gender when 'M' then 0 when 'F' then 1 else 2 end,
        hm.name,
        hm.id), '[]'::jsonb)
      from public.members hm
      where hm.status = 'active'
        and hm.household_id = m.household_id
        and hm.id <> m.id
    ),
    'relations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', r.kind,
        'role', r.role,
        'relative_id', rm.id,
        'name', rm.name,
        'phone', rm.phone,
        'home_phone', rm.home_phone,
        'gender', rm.gender,
        'is_child', rm.is_child,
        'photo_url', rm.photo_url,
        'pasture_name', rp.name,
        'grassland_name', rg.name,
        'plain_name', rpl.name,
        'direction', 'ancestor'
      ) order by
        coalesce(rm.is_child, false),
        case rm.gender when 'M' then 0 when 'F' then 1 else 2 end,
        rm.name,
        rm.id), '[]'::jsonb)
      from public.member_relations r
      join public.members rm on rm.id = r.relative_id and rm.status = 'active'
      left join public.households rh on rh.id = rm.household_id
      left join public.directory_pastures rp on rp.id = rh.pasture_id
      left join public.grasslands rg on rg.id = rp.grassland_id
      left join public.plains rpl on rpl.id = rg.plain_id
      where r.subject_id = m.id
    ),
    'descendants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', r.kind,
        'role', r.role,
        'relative_id', sm.id,
        'name', sm.name,
        'phone', sm.phone,
        'home_phone', sm.home_phone,
        'gender', sm.gender,
        'is_child', sm.is_child,
        'photo_url', sm.photo_url,
        'pasture_name', sp.name,
        'grassland_name', sg.name,
        'plain_name', spl.name,
        'direction', 'descendant'
      ) order by
        coalesce(sm.is_child, false),
        case sm.gender when 'M' then 0 when 'F' then 1 else 2 end,
        sm.name,
        sm.id), '[]'::jsonb)
      from public.member_relations r
      join public.members sm on sm.id = r.subject_id and sm.status = 'active'
      left join public.households sh on sh.id = sm.household_id
      left join public.directory_pastures sp on sp.id = sh.pasture_id
      left join public.grasslands sg on sg.id = sp.grassland_id
      left join public.plains spl on spl.id = sg.plain_id
      where r.relative_id = m.id
        and r.kind <> 'spouse'
    )
  )
  from public.members m
  left join public.households h on h.id = m.household_id
  left join public.directory_pastures p on p.id = h.pasture_id
  left join public.grasslands g on g.id = p.grassland_id
  left join public.plains pl on pl.id = g.plain_id
  where m.id = p_member_id
    and m.status = 'active';
$$;

grant execute on function public.directory_member_profile(uuid) to authenticated;
