-- =============================================================
-- 성도요람 자녀 서열 지정
-- - 부모 본인 또는 관리자가 자녀 순서를 위/아래로 조정
-- - 수동 순서가 없으면 생년월일(빠른 날짜 우선)로 자동 정렬
-- =============================================================

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS child_order integer
  CHECK (child_order IS NULL OR child_order > 0);

CREATE INDEX IF NOT EXISTS idx_members_child_order
  ON public.members (child_order)
  WHERE child_order IS NOT NULL;


DROP FUNCTION IF EXISTS public.member_reorder_children(uuid, uuid[]);
CREATE OR REPLACE FUNCTION public.member_reorder_children(
  p_parent_id uuid,
  p_child_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_ids uuid[];
  v_child_id uuid;
  v_order integer := 0;
BEGIN
  IF NOT public.can_manage_member_children(p_parent_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  SELECT coalesce(array_agg(r.subject_id ORDER BY r.subject_id), ARRAY[]::uuid[])
    INTO v_expected_ids
  FROM public.member_relations r
  JOIN public.members c ON c.id = r.subject_id
  WHERE r.relative_id = p_parent_id
    AND r.kind = 'parent'
    AND c.status = 'active';

  IF coalesce(array_length(p_child_ids, 1), 0) <> coalesce(array_length(v_expected_ids, 1), 0)
     OR (SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(p_child_ids) x) <> v_expected_ids
  THEN
    RAISE EXCEPTION '자녀 목록이 현재 가족 관계와 일치하지 않습니다';
  END IF;

  FOREACH v_child_id IN ARRAY p_child_ids LOOP
    v_order := v_order + 1;
    UPDATE public.members
    SET child_order = v_order
    WHERE id = v_child_id;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.member_reorder_children(uuid, uuid[]) TO authenticated;


-- 관리자 회원 카드용 상세. 직접 자녀는 수동 순서 → 생년월일 순으로 정렬한다.
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
      'plain_name', pl.name
    ),
    'household_members', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', mm.id, 'name', mm.name, 'phone', mm.phone,
        'family_church', mm.family_church, 'sub_role', mm.sub_role,
        'is_child', mm.is_child, 'photo_url', mm.photo_url, 'gender', mm.gender
      ) ORDER BY mm.is_child, mm.child_order NULLS LAST, mm.birth_date NULLS LAST, mm.name)
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
        'has_account', (sm.app_user_id IS NOT NULL),
        'birth_date', sm.birth_date,
        'child_order', sm.child_order
      ) ORDER BY
        CASE r.kind WHEN 'parent' THEN 0 WHEN 'grandparent' THEN 1 WHEN 'great_grandparent' THEN 2 ELSE 3 END,
        CASE WHEN r.kind = 'parent' THEN sm.child_order END NULLS LAST,
        sm.birth_date NULLS LAST,
        sm.name,
        sm.id)
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
  WHERE m.id = p_member_id;
$$;
GRANT EXECUTE ON FUNCTION public.admin_member_profile(uuid) TO authenticated;


-- 일반 성도요람 상세에도 같은 정렬 기준과 자녀 순서 정보를 제공한다.
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
        'birth_date', sm.birth_date,
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

GRANT EXECUTE ON FUNCTION public.directory_member_profile(uuid) TO authenticated;
