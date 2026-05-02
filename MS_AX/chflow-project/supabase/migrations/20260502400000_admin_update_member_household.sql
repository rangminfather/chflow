-- =============================================================
-- admin_update_member 확장: 목장(household) 이동 지원
--   - p_household_id: 기존 가족(household)으로 합류
--   - p_split_pasture_id: 새 household 만들어 해당 목장으로 분리
--   - 둘 다 NULL이면 household 변경 없음
--   - 둘 다 NOT NULL이면 에러
--   - 이동 후 기존 household가 빈 가족이 되면 자동 삭제
--
-- admin_search_members_paged: household_id, pasture_id 컬럼 추가 (UI 초기값용)
-- (v2의 목장-스코프 부모/자녀 필터 그대로 유지)
-- =============================================================

-- 검색 RPC: household_id, pasture_id 노출 (v2 필터 유지)
DROP FUNCTION IF EXISTS public.admin_search_members_paged(text, text, text, text, int, int, boolean, boolean);

CREATE OR REPLACE FUNCTION public.admin_search_members_paged(
  p_query         text    DEFAULT NULL,
  p_plain         text    DEFAULT NULL,
  p_grassland     text    DEFAULT NULL,
  p_pasture       text    DEFAULT NULL,
  p_offset        int     DEFAULT 0,
  p_limit         int     DEFAULT 50,
  p_show_children boolean DEFAULT true,
  p_show_parents  boolean DEFAULT true
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
  household_id uuid,
  pasture_id uuid,
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
      m.household_id,
      h.pasture_id,
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
      -- 자녀보기 해제: 같은 목장 안에 '내 부모/조부모'가 있는 회원은 숨김
      AND (
        p_show_children
        OR NOT EXISTS (
          SELECT 1
          FROM public.member_relations r
          JOIN public.members      rm ON rm.id = r.relative_id
          JOIN public.households   rh ON rh.id = rm.household_id
          WHERE r.subject_id = m.id
            AND r.kind IN ('parent','grandparent','great_grandparent')
            AND rh.pasture_id = h.pasture_id
        )
      )
      -- 부모보기 해제: 같은 목장 안에 '내 자녀/자손'이 있는 회원은 숨김
      AND (
        p_show_parents
        OR NOT EXISTS (
          SELECT 1
          FROM public.member_relations r
          JOIN public.members      sm ON sm.id = r.subject_id
          JOIN public.households   sh ON sh.id = sm.household_id
          WHERE r.relative_id = m.id
            AND r.kind IN ('parent','grandparent','great_grandparent')
            AND sh.pasture_id = h.pasture_id
        )
      )
  )
  SELECT
    id, name, phone, gender, family_church, sub_role, spouse_name,
    address, pasture_name, grassland_name, plain_name,
    guard_status, has_account, is_child, source_page, photo_url,
    household_id, pasture_id,
    (SELECT COUNT(*) FROM filtered)::bigint AS total_count
  FROM filtered
  ORDER BY pl_order NULLS LAST, g_order NULLS LAST, p_order NULLS LAST, h_order NULLS LAST, name
  OFFSET p_offset
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.admin_search_members_paged(text, text, text, text, int, int, boolean, boolean) TO authenticated;


-- 수정 RPC: household 이동 지원
DROP FUNCTION IF EXISTS public.admin_update_member(uuid, text, text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.admin_update_member(uuid, text, text, text, text, text, text, boolean, uuid, uuid);
CREATE OR REPLACE FUNCTION public.admin_update_member(
  p_member_id        uuid,
  p_name             text DEFAULT NULL,
  p_phone            text DEFAULT NULL,
  p_family_church    text DEFAULT NULL,
  p_sub_role         text DEFAULT NULL,
  p_spouse_name      text DEFAULT NULL,
  p_gender           text DEFAULT NULL,
  p_is_child         boolean DEFAULT NULL,
  p_household_id     uuid DEFAULT NULL,   -- 기존 가족으로 합류
  p_split_pasture_id uuid DEFAULT NULL    -- 새 household 만들어 이 목장으로 이동
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old_hh    uuid;
  v_new_hh    uuid;
  v_remaining int;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF p_household_id IS NOT NULL AND p_split_pasture_id IS NOT NULL THEN
    RAISE EXCEPTION '기존 가족 합류와 신규 가족 분리는 동시에 지정할 수 없습니다';
  END IF;

  -- household 이동 처리
  IF p_household_id IS NOT NULL OR p_split_pasture_id IS NOT NULL THEN
    SELECT household_id INTO v_old_hh FROM public.members WHERE id = p_member_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '해당 회원을 찾을 수 없습니다';
    END IF;

    IF p_household_id IS NOT NULL THEN
      v_new_hh := p_household_id;
      PERFORM 1 FROM public.households WHERE id = v_new_hh;
      IF NOT FOUND THEN
        RAISE EXCEPTION '대상 가족(household)을 찾을 수 없습니다';
      END IF;
    ELSE
      INSERT INTO public.households (pasture_id, address, home_phone, order_no)
      VALUES (p_split_pasture_id, '', '', 0)
      RETURNING id INTO v_new_hh;
    END IF;

    IF v_old_hh IS DISTINCT FROM v_new_hh THEN
      UPDATE public.members SET household_id = v_new_hh WHERE id = p_member_id;

      -- 기존 가족 비었으면 정리
      IF v_old_hh IS NOT NULL THEN
        SELECT COUNT(*) INTO v_remaining FROM public.members WHERE household_id = v_old_hh;
        IF v_remaining = 0 THEN
          DELETE FROM public.households WHERE id = v_old_hh;
        END IF;
      END IF;
    END IF;
  END IF;

  -- 기본 필드 업데이트
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
GRANT EXECUTE ON FUNCTION public.admin_update_member(uuid, text, text, text, text, text, text, boolean, uuid, uuid) TO authenticated;
