-- Restore app-account fields accidentally omitted when the member card RPC was
-- redefined for child management. Keep app_user_id links intact; profile data is
-- supplementary because historic links can exist without a profile row.
CREATE OR REPLACE FUNCTION public.admin_member_profile(p_member_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'member', to_jsonb(m) || jsonb_build_object(
      'address', h.address,
      'home_phone', h.home_phone,
      'pasture_name', p.name,
      'grassland_name', g.name,
      'plain_name', pl.name,
      'has_app_account', coalesce(m.app_user_id IS NOT NULL OR pr.id IS NOT NULL, false),
      'app_user_id', coalesce(m.app_user_id, pr.id),
      'app_status', pr.status,
      'app_username', pr.username
    ),
    'household_members', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', mm.id, 'name', mm.name, 'phone', mm.phone,
        'family_church', mm.family_church, 'sub_role', mm.sub_role,
        'is_child', mm.is_child, 'photo_url', mm.photo_url, 'gender', mm.gender
      ) ORDER BY mm.is_child, mm.name)
      FROM public.members mm WHERE mm.household_id = m.household_id AND mm.id <> m.id
    ),
    'relations', (
      SELECT jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'role', r.role,
        'relative_id', r.relative_id,
        'name', rm.name, 'phone', rm.phone,
        'photo_url', rm.photo_url,
        'pasture_name', rp.name,
        'plain_name', rpl.name,
        'direction', 'ancestor'
      ))
      FROM public.member_relations r
      JOIN public.members rm ON rm.id = r.relative_id
      LEFT JOIN public.households rh ON rm.household_id = rh.id
      LEFT JOIN public.directory_pastures rp ON rh.pasture_id = rp.id
      LEFT JOIN public.grasslands rg ON rp.grassland_id = rg.id
      LEFT JOIN public.plains rpl ON rg.plain_id = rpl.id
      WHERE r.subject_id = p_member_id
    ),
    'descendants', (
      SELECT jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'role', r.role,
        'relative_id', r.subject_id,
        'name', sm.name, 'phone', sm.phone,
        'photo_url', sm.photo_url,
        'pasture_name', sp.name,
        'plain_name', spl.name,
        'direction', 'descendant',
        'is_child', sm.is_child,
        'has_account', (sm.app_user_id IS NOT NULL)
      ))
      FROM public.member_relations r
      JOIN public.members sm ON sm.id = r.subject_id
      LEFT JOIN public.households sh ON sm.household_id = sh.id
      LEFT JOIN public.directory_pastures sp ON sh.pasture_id = sp.id
      LEFT JOIN public.grasslands sg ON sp.grassland_id = sg.id
      LEFT JOIN public.plains spl ON sg.plain_id = spl.id
      WHERE r.relative_id = p_member_id AND r.kind <> 'spouse'
    )
  )
  FROM public.members m
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures p ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g ON p.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  LEFT JOIN LATERAL (
    SELECT p0.id, p0.status, p0.username
    FROM public.profiles p0
    WHERE p0.id = m.app_user_id OR p0.member_id = m.id
    ORDER BY
      CASE WHEN p0.id = m.app_user_id THEN 0 ELSE 1 END,
      CASE p0.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
      p0.created_at DESC NULLS LAST
    LIMIT 1
  ) pr ON true
  WHERE m.id = p_member_id;
$$;

GRANT EXECUTE ON FUNCTION public.admin_member_profile(uuid) TO authenticated;
