-- =============================================================
-- admin_search_members_paged: 자녀보기/부모보기 필터 추가
--   p_show_children=false → is_child=true 회원 숨김 (자녀·손자)
--   p_show_parents =false → is_child=false 회원 숨김 (성인)
-- =============================================================

DROP FUNCTION IF EXISTS public.admin_search_members_paged(text, text, text, text, int, int);
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
      AND (p_show_children OR m.is_child = false)
      AND (p_show_parents  OR m.is_child = true)
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

GRANT EXECUTE ON FUNCTION public.admin_search_members_paged(text, text, text, text, int, int, boolean, boolean) TO authenticated;
