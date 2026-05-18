-- Separate current operational members from legacy/reference records.
-- Current operational membership is defined by the church directory PDF:
-- a member must have source_page and belong to a directory pasture.
-- Legacy MDB/manual records are kept for reference but hidden from default
-- operational member searches by setting members.status = 'inactive'.

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
      m.status,
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
    guard_status, status, has_account, is_child, source_page, photo_url,
    household_id, pasture_id,
    (select count(*) from filtered)::bigint as total_count
  from filtered
  order by pl_order nulls last, g_order nulls last, p_order nulls last, h_order nulls last, name
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.admin_search_members_paged(text, text, text, text, int, int, boolean, boolean, text) to authenticated;

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
  has_account boolean
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
    (m.app_user_id is not null) as has_account
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
  where m.status = 'active'
    and m.name = p_name
  order by match_score desc, m.is_child asc, m.name
  limit p_limit;
$$;

grant execute on function public.search_member_candidates(text, text, int) to anon, authenticated;

with classified as (
  select
    m.id,
    case
      when m.source_page is not null and h.pasture_id is not null then 'current_directory'
      when m.source_page is null and m.legacy_kyoin_id is null and h.pasture_id is not null then 'manual_current'
      else 'legacy_reference'
    end as operational_bucket
  from public.members m
  left join public.households h on h.id = m.household_id
)
update public.members m
set
  status = case
    when c.operational_bucket in ('current_directory', 'manual_current') then 'active'
    else 'inactive'
  end,
  notes = case
    when c.operational_bucket = 'legacy_reference'
     and coalesce(m.notes, '') not like '%2026-05-18 operational separation%'
    then concat_ws(E'\n', nullif(m.notes, ''), '[2026-05-18 operational separation] Not listed in the church directory PDF pasture roster; kept as MDB/manual reference.')
    else m.notes
  end
from classified c
where m.id = c.id
  and (
    m.status is distinct from case
      when c.operational_bucket in ('current_directory', 'manual_current') then 'active'
      else 'inactive'
    end
    or (
      c.operational_bucket = 'legacy_reference'
      and coalesce(m.notes, '') not like '%2026-05-18 operational separation%'
    )
  );

notify pgrst, 'reload schema';
