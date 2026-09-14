-- 요람검색: 생년월일은 관리자 / 본인 / 같은 가족(household) / 직계관계(member_relations)만 볼 수 있게 제한.
-- 그 외 일반 열람자에게는 null로 내려간다 (자녀 수정 등 본인·가족 업무는 계속 가능해야 하므로 전면 비공개는 아님).

create or replace function public.can_view_member_birth_date(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.get_user_role() = 'admin'
    or exists (
      select 1
      from public.members viewer
      where viewer.app_user_id = auth.uid()
        and (
          viewer.id = p_member_id
          or (
            viewer.household_id is not null
            and viewer.household_id = (select household_id from public.members where id = p_member_id)
          )
          or exists (
            select 1
            from public.member_relations r
            where (r.subject_id = viewer.id and r.relative_id = p_member_id)
               or (r.subject_id = p_member_id and r.relative_id = viewer.id)
          )
        )
    );
$$;

revoke execute on function public.can_view_member_birth_date(uuid) from public, anon;
grant execute on function public.can_view_member_birth_date(uuid) to authenticated;

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
      'birth_date', case when public.can_view_member_birth_date(m.id) then m.birth_date else null end,
      'family_church', m.family_church,
      'sub_role', m.sub_role,
      'spouse_name', m.spouse_name,
      'is_child', m.is_child,
      'photo_url', m.photo_url,
      'address', h.address,
      'household_home_phone', h.home_phone,
      'pasture_name', p.name,
      'grassland_name', g.name,
      'plain_name', pl.name,
      'has_app_account', coalesce(m.app_user_id is not null or pr.id is not null, false),
      'app_user_id', coalesce(m.app_user_id, pr.id),
      'app_status', pr.status,
      'app_username', case
        when public.get_user_role() in ('admin', 'office', 'pastor') then pr.username
        else null
      end
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
        hm.child_order nulls last,
        hm.birth_date nulls last,
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
        'has_account', (sm.app_user_id is not null),
        'photo_url', sm.photo_url,
        'birth_date', case when public.can_view_member_birth_date(m.id) then sm.birth_date else null end,
        'child_order', sm.child_order,
        'pasture_name', sp.name,
        'grassland_name', sg.name,
        'plain_name', spl.name,
        'direction', 'descendant'
      ) order by
        case r.kind when 'parent' then 0 when 'grandparent' then 1 when 'great_grandparent' then 2 else 3 end,
        case when r.kind = 'parent' then sm.child_order end nulls last,
        sm.birth_date nulls last,
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
    and m.status = 'active';
$$;

revoke execute on function public.directory_member_profile(uuid) from public, anon;
grant execute on function public.directory_member_profile(uuid) to authenticated;
grant execute on function public.directory_member_profile(uuid) to service_role;
