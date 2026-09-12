-- 회원 관리에서 앱 가입 여부로 직접 목록을 필터링한다.
drop function if exists public.admin_search_members_paged(text, text, text, text, integer, integer, boolean, boolean, text, text);

create function public.admin_search_members_paged(
  p_query          text default null,
  p_plain          text default null,
  p_grassland      text default null,
  p_pasture        text default null,
  p_offset         int default 0,
  p_limit          int default 50,
  p_show_children  boolean default true,
  p_show_parents   boolean default true,
  p_member_status  text default 'active',
  p_account_state  text default 'active',
  p_app_membership text default 'all'
)
returns table (
  id uuid, name text, phone text, home_phone text, gender text, family_church text,
  sub_role text, spouse_name text, address text, pasture_name text, grassland_name text,
  plain_name text, guard_status text, status text, account_state text, withdrawn_at timestamptz,
  has_account boolean, is_child boolean, source_page int, photo_url text, household_id uuid,
  pasture_id uuid, total_count bigint
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_regex text := public.hangul_search_regex(p_query);
begin
  if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then
    raise exception '권한이 없습니다';
  end if;
  if coalesce(p_app_membership, 'all') not in ('all', 'joined', 'not_joined') then
    raise exception '앱 가입 필터 값이 올바르지 않습니다';
  end if;

  return query
  with filtered as (
    select
      m.id, m.name, m.phone, m.home_phone, m.gender, m.family_church,
      m.sub_role, m.spouse_name, h.address, p.name as pasture_name,
      g.name as grassland_name, pl.name as plain_name, m.guard_status,
      m.status, m.account_state, m.withdrawn_at,
      (m.app_user_id is not null) as has_account, m.is_child, m.source_page,
      m.photo_url, m.household_id, h.pasture_id,
      pl.order_no as pl_order, g.order_no as g_order,
      p.order_no as p_order, h.order_no as h_order
    from public.members m
    left join public.households h on h.id = m.household_id
    left join public.directory_pastures p on p.id = h.pasture_id
    left join public.grasslands g on g.id = p.grassland_id
    left join public.plains pl on pl.id = g.plain_id
    where (p_member_status is null or p_member_status = 'all'
      or p_account_state = 'withdrawn' or m.status = p_member_status)
      and (coalesce(p_account_state, 'active') = 'all'
        or m.account_state = coalesce(p_account_state, 'active'))
      and (coalesce(p_app_membership, 'all') = 'all'
        or (p_app_membership = 'joined' and m.app_user_id is not null)
        or (p_app_membership = 'not_joined' and m.app_user_id is null))
      and (
        p_query is null
        or m.name ilike '%' || p_query || '%'
        or m.phone ilike '%' || p_query || '%'
        or m.home_phone ilike '%' || p_query || '%'
        or h.home_phone ilike '%' || p_query || '%'
        or (v_regex is not null and m.name ~* v_regex)
      )
      and (p_plain is null or pl.name = p_plain)
      and (p_grassland is null or g.name = p_grassland)
      and (p_pasture is null or p.name = p_pasture)
      and (
        p_show_children or not exists (
          select 1 from public.member_relations r
          join public.members rm on rm.id = r.relative_id
          join public.households rh on rh.id = rm.household_id
          where r.subject_id = m.id
            and r.kind in ('parent', 'grandparent', 'great_grandparent')
            and rh.pasture_id = h.pasture_id
        )
      )
      and (
        p_show_parents or not exists (
          select 1 from public.member_relations r
          join public.members sm on sm.id = r.subject_id
          join public.households sh on sh.id = sm.household_id
          where r.relative_id = m.id
            and r.kind in ('parent', 'grandparent', 'great_grandparent')
            and sh.pasture_id = h.pasture_id
        )
      )
  )
  select f.id, f.name, f.phone, f.home_phone, f.gender, f.family_church,
    f.sub_role, f.spouse_name, f.address, f.pasture_name, f.grassland_name,
    f.plain_name, f.guard_status, f.status, f.account_state, f.withdrawn_at,
    f.has_account, f.is_child, f.source_page, f.photo_url, f.household_id,
    f.pasture_id, (select count(*) from filtered)::bigint
  from filtered f
  order by f.pl_order nulls last, f.g_order nulls last, f.p_order nulls last,
    f.h_order nulls last, f.name
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 50), 1), 500);
end;
$$;

grant execute on function public.admin_search_members_paged(text, text, text, text, integer, integer, boolean, boolean, text, text, text) to authenticated;
