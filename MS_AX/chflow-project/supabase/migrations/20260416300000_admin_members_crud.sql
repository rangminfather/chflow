-- =============================================================
-- 관리자 회원 CRUD + 페이지네이션
-- =============================================================

-- 1) 페이지네이션 지원 검색
DROP FUNCTION IF EXISTS public.admin_search_members_paged(text, text, text, text, int, int);
CREATE OR REPLACE FUNCTION public.admin_search_members_paged(
  p_query     text DEFAULT NULL,
  p_plain     text DEFAULT NULL,
  p_grassland text DEFAULT NULL,
  p_pasture   text DEFAULT NULL,
  p_offset    int  DEFAULT 0,
  p_limit     int  DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  gender text,
  family_church text,
  sub_role text,
  spouse_name text,
  address text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  guard_status text,
  has_account boolean,
  is_child boolean,
  source_page int,
  photo_url text,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      m.id, m.name, m.phone, m.gender, m.family_church, m.sub_role, m.spouse_name,
      h.address,
      p.name  AS pasture_name,
      g.name  AS grassland_name,
      pl.name AS plain_name,
      m.guard_status,
      (m.app_user_id IS NOT NULL) AS has_account,
      m.is_child,
      m.source_page,
      m.photo_url,
      pl.order_no AS pl_order,
      g.order_no  AS g_order,
      p.order_no  AS p_order,
      h.order_no  AS h_order
    FROM public.members m
    LEFT JOIN public.households h          ON m.household_id = h.id
    LEFT JOIN public.directory_pastures p  ON h.pasture_id = p.id
    LEFT JOIN public.grasslands g          ON p.grassland_id = g.id
    LEFT JOIN public.plains pl             ON g.plain_id = pl.id
    WHERE
      (p_query IS NULL OR m.name ILIKE '%' || p_query || '%' OR m.phone ILIKE '%' || p_query || '%')
      AND (p_plain IS NULL OR pl.name = p_plain)
      AND (p_grassland IS NULL OR g.name = p_grassland)
      AND (p_pasture IS NULL OR p.name = p_pasture)
  )
  SELECT
    id, name, phone, gender, family_church, sub_role, spouse_name,
    address, pasture_name, grassland_name, plain_name,
    guard_status, has_account, is_child, source_page, photo_url,
    (SELECT COUNT(*) FROM filtered)::bigint AS total_count
  FROM filtered
  ORDER BY pl_order NULLS LAST, g_order NULLS LAST, p_order NULLS LAST, h_order NULLS LAST, name
  OFFSET p_offset
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.admin_search_members_paged(text, text, text, text, int, int) TO authenticated;


-- 2) 평원 → 초원 → 목장 드롭다운용 조회
DROP FUNCTION IF EXISTS public.directory_tree();
CREATE OR REPLACE FUNCTION public.directory_tree()
RETURNS TABLE (
  plain_id uuid, plain_name text, plain_order int,
  grassland_id uuid, grassland_name text,
  pasture_id uuid, pasture_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    pl.id, pl.name, pl.order_no,
    g.id,  g.name,
    p.id,  p.name
  FROM public.plains pl
  LEFT JOIN public.grasslands g          ON g.plain_id = pl.id
  LEFT JOIN public.directory_pastures p  ON p.grassland_id = g.id
  ORDER BY pl.order_no, g.order_no, p.order_no;
$$;
GRANT EXECUTE ON FUNCTION public.directory_tree() TO authenticated;


-- 3) 한 목장의 가족 목록 (회원 추가 모달에서 기존 가족 선택용)
DROP FUNCTION IF EXISTS public.households_by_pasture(uuid);
CREATE OR REPLACE FUNCTION public.households_by_pasture(p_pasture_id uuid)
RETURNS TABLE (
  id uuid, address text, home_phone text, order_no int,
  members_summary text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    h.id, h.address, h.home_phone, h.order_no,
    (SELECT string_agg(m.name, ', ' ORDER BY m.is_child, m.name)
       FROM public.members m WHERE m.household_id = h.id) AS members_summary
  FROM public.households h
  WHERE h.pasture_id = p_pasture_id
  ORDER BY h.order_no, h.address;
$$;
GRANT EXECUTE ON FUNCTION public.households_by_pasture(uuid) TO authenticated;


-- 4) 회원 추가
DROP FUNCTION IF EXISTS public.admin_create_member(text, text, text, text, text, uuid, uuid, text, boolean, date, text);
CREATE OR REPLACE FUNCTION public.admin_create_member(
  p_name          text,
  p_phone         text DEFAULT '',
  p_family_church text DEFAULT '목원',
  p_sub_role      text DEFAULT '',
  p_spouse_name   text DEFAULT '',
  p_household_id  uuid DEFAULT NULL,   -- 지정하면 기존 가족에 합류
  p_pasture_id    uuid DEFAULT NULL,   -- household_id 없을 때, 신규 가족을 이 목장에
  p_gender        text DEFAULT NULL,
  p_is_child      boolean DEFAULT false,
  p_birth_date    date DEFAULT NULL,
  p_address       text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
  v_hh_id     uuid := p_household_id;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION '이름은 필수입니다';
  END IF;

  -- household 결정
  IF v_hh_id IS NULL THEN
    IF p_pasture_id IS NULL THEN
      RAISE EXCEPTION '가족(household) 또는 목장(pasture)을 지정해야 합니다';
    END IF;
    INSERT INTO public.households (pasture_id, address, home_phone, order_no)
    VALUES (p_pasture_id, coalesce(p_address, ''), '', 0)
    RETURNING id INTO v_hh_id;
  END IF;

  INSERT INTO public.members (
    name, phone, birth_date, household_id,
    family_church, sub_role, spouse_name, gender, is_child,
    guard_status
  )
  VALUES (
    trim(p_name), coalesce(p_phone, ''), p_birth_date, v_hh_id,
    coalesce(p_family_church, '목원'), coalesce(p_sub_role, ''),
    coalesce(p_spouse_name, ''), p_gender, coalesce(p_is_child, false),
    '비회원'
  )
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_create_member(text, text, text, text, text, uuid, uuid, text, boolean, date, text) TO authenticated;


-- 5) 회원 삭제 (app_user_id 연결된 계정은 거부)
DROP FUNCTION IF EXISTS public.admin_delete_member(uuid);
CREATE OR REPLACE FUNCTION public.admin_delete_member(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_has_account boolean;
  v_hh          uuid;
  v_remaining   int;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  SELECT (app_user_id IS NOT NULL), household_id
    INTO v_has_account, v_hh
  FROM public.members WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '해당 회원을 찾을 수 없습니다';
  END IF;
  IF v_has_account THEN
    RAISE EXCEPTION '앱 계정과 연결된 회원은 삭제할 수 없습니다. 먼저 계정 연결을 해제하세요.';
  END IF;

  DELETE FROM public.members WHERE id = p_member_id;

  -- 가족 구성원 0명이면 household도 정리
  IF v_hh IS NOT NULL THEN
    SELECT COUNT(*) INTO v_remaining FROM public.members WHERE household_id = v_hh;
    IF v_remaining = 0 THEN
      DELETE FROM public.households WHERE id = v_hh;
    END IF;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_delete_member(uuid) TO authenticated;


-- 6) 수정 함수 확장 (gender, is_child, photo_url 지원)
DROP FUNCTION IF EXISTS public.admin_update_member(uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.admin_update_member(uuid, text, text, text, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.admin_update_member(
  p_member_id     uuid,
  p_name          text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_family_church text DEFAULT NULL,
  p_sub_role      text DEFAULT NULL,
  p_spouse_name   text DEFAULT NULL,
  p_gender        text DEFAULT NULL,
  p_is_child      boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  UPDATE public.members SET
    name          = COALESCE(p_name, name),
    phone         = COALESCE(p_phone, phone),
    family_church = COALESCE(p_family_church, family_church),
    sub_role      = COALESCE(p_sub_role, sub_role),
    spouse_name   = COALESCE(p_spouse_name, spouse_name),
    gender        = COALESCE(p_gender, gender),
    is_child      = COALESCE(p_is_child, is_child)
  WHERE id = p_member_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_update_member(uuid, text, text, text, text, text, text, boolean) TO authenticated;
