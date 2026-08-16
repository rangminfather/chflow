-- /directory 화면(directory_member_profile)의 descendants 에 has_account 추가.
-- MemberCardModal 전용이 아니라 실제 성도 요람(/directory)에서 자녀 등록/수정/삭제를
-- 쓰기 위해 필요 (member_delete_child가 앱 계정 연결 여부로 삭제 가능 여부를 UI에서 미리 판단).

CREATE OR REPLACE FUNCTION public.directory_member_profile(p_member_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'member', jsonb_build_object(
      'id', m.id,
      'name', m.name,
      'phone', m.phone,
      'home_phone', m.home_phone,
      'gender', m.gender,
      'birth_date', m.birth_date,
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
      'app_username', pr.username
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
        'has_account', (sm.app_user_id is not null),
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

GRANT EXECUTE ON FUNCTION public.directory_member_profile(uuid) TO authenticated;
