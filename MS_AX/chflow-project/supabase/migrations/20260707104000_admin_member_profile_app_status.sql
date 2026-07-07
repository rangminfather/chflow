-- Show app account state on the shared admin member card.

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
        'plain_name', pl.name,
        'has_app_account', coalesce(m.app_user_id is not null or pr.id is not null, false),
        'app_user_id', coalesce(m.app_user_id, pr.id),
        'app_status', pr.status,
        'app_username', pr.username
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
    left join lateral (
      select p0.id, p0.status, p0.username
      from public.profiles p0
      where p0.id = m.app_user_id
         or p0.member_id = m.id
      order by
        case when p0.id = m.app_user_id then 0 else 1 end,
        case p0.status when 'active' then 0 when 'pending' then 1 else 2 end,
        p0.created_at desc nulls last
      limit 1
    ) pr on true
    where m.id = p_member_id
  );
end;
$$;

grant execute on function public.admin_member_profile(uuid) to authenticated;
