-- =============================================================
-- 성도 카드 모달에서 자녀 등록/수정/삭제 (관리자 + 본인만)
-- 자기 자신의 카드에서만 자녀를 관리할 수 있고, 그 외엔 관리자만 가능.
-- 향후 교역자/행정관리원 등 역할 확대 예정 — 현재는 admin만 blanket 허용.
-- =============================================================

DROP FUNCTION IF EXISTS public.can_manage_member_children(uuid);
CREATE OR REPLACE FUNCTION public.can_manage_member_children(p_parent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.members
      WHERE id = p_parent_id AND app_user_id = auth.uid()
    );
$$;
GRANT EXECUTE ON FUNCTION public.can_manage_member_children(uuid) TO authenticated;


-- 자녀 신규 등록 — 부모의 household/가정교회 승계 + 부모 관계 자동 연결
DROP FUNCTION IF EXISTS public.member_add_child(uuid, text, text, date);
CREATE OR REPLACE FUNCTION public.member_add_child(
  p_parent_id  uuid,
  p_name       text,
  p_gender     text DEFAULT NULL,
  p_birth_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child_id      uuid;
  v_household_id  uuid;
  v_family_church text;
  v_parent_gender text;
  v_role          text;
BEGIN
  IF NOT public.can_manage_member_children(p_parent_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION '이름은 필수입니다';
  END IF;

  SELECT household_id, family_church, gender
    INTO v_household_id, v_family_church, v_parent_gender
  FROM public.members WHERE id = p_parent_id;

  IF v_household_id IS NULL THEN
    RAISE EXCEPTION '부모의 가족(household) 정보가 없어 자녀를 추가할 수 없습니다';
  END IF;

  INSERT INTO public.members (name, household_id, family_church, is_child, gender, birth_date, guard_status, phone)
  VALUES (trim(p_name), v_household_id, v_family_church, true, p_gender, p_birth_date, '비회원', '')
  RETURNING id INTO v_child_id;

  v_role := CASE v_parent_gender WHEN 'M' THEN 'father' WHEN 'F' THEN 'mother' ELSE NULL END;

  INSERT INTO public.member_relations (subject_id, relative_id, kind, role, created_by)
  VALUES (v_child_id, p_parent_id, 'parent', v_role, auth.uid());

  RETURN v_child_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.member_add_child(uuid, text, text, date) TO authenticated;


-- 자녀 정보 수정 — 이름/성별/생년월일만. 직분·가정교회 등 관리자 전용 필드는 admin_update_member 사용.
DROP FUNCTION IF EXISTS public.member_update_child(uuid, text, text, date);
CREATE OR REPLACE FUNCTION public.member_update_child(
  p_child_id   uuid,
  p_name       text DEFAULT NULL,
  p_gender     text DEFAULT NULL,
  p_birth_date date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_child  boolean;
  v_parent_id uuid;
BEGIN
  SELECT is_child INTO v_is_child FROM public.members WHERE id = p_child_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '해당 자녀를 찾을 수 없습니다';
  END IF;
  IF NOT v_is_child THEN
    RAISE EXCEPTION '자녀로 등록된 회원만 이 기능으로 수정할 수 있습니다';
  END IF;

  SELECT r.relative_id INTO v_parent_id
  FROM public.member_relations r
  WHERE r.subject_id = p_child_id AND r.kind = 'parent'
  LIMIT 1;

  IF v_parent_id IS NULL OR NOT public.can_manage_member_children(v_parent_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  UPDATE public.members SET
    name       = COALESCE(NULLIF(trim(p_name), ''), name),
    gender     = COALESCE(p_gender, gender),
    birth_date = COALESCE(p_birth_date, birth_date)
  WHERE id = p_child_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.member_update_child(uuid, text, text, date) TO authenticated;


-- 자녀 삭제 — 앱 계정과 연결된 자녀는 삭제 불가 (admin_delete_member와 동일 원칙)
DROP FUNCTION IF EXISTS public.member_delete_child(uuid);
CREATE OR REPLACE FUNCTION public.member_delete_child(p_child_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_child    boolean;
  v_has_account boolean;
  v_hh          uuid;
  v_parent_id   uuid;
  v_remaining   int;
BEGIN
  SELECT is_child, (app_user_id IS NOT NULL), household_id
    INTO v_is_child, v_has_account, v_hh
  FROM public.members WHERE id = p_child_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '해당 자녀를 찾을 수 없습니다';
  END IF;
  IF NOT v_is_child THEN
    RAISE EXCEPTION '자녀로 등록된 회원만 이 기능으로 삭제할 수 있습니다';
  END IF;
  IF v_has_account THEN
    RAISE EXCEPTION '앱 계정과 연결된 자녀는 삭제할 수 없습니다. 관리자 회원관리에서 처리하세요.';
  END IF;

  SELECT r.relative_id INTO v_parent_id
  FROM public.member_relations r
  WHERE r.subject_id = p_child_id AND r.kind = 'parent'
  LIMIT 1;

  IF v_parent_id IS NULL OR NOT public.can_manage_member_children(v_parent_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  DELETE FROM public.members WHERE id = p_child_id;

  IF v_hh IS NOT NULL THEN
    SELECT COUNT(*) INTO v_remaining FROM public.members WHERE household_id = v_hh;
    IF v_remaining = 0 THEN
      DELETE FROM public.households WHERE id = v_hh;
    END IF;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.member_delete_child(uuid) TO authenticated;


-- admin_member_profile: descendants 에 is_child / has_account 추가 (자녀 관리 UI 권한·표시 분기용)
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
  WHERE m.id = p_member_id;
$$;
GRANT EXECUTE ON FUNCTION public.admin_member_profile(uuid) TO authenticated;
