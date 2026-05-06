-- 데이터 검수용 RPC: 목장 단위 검수 페이지 (/admin/review)

-- =============================================================
-- 1. 검수 진행률을 포함한 평원/초원/목장 트리
-- =============================================================
DROP FUNCTION IF EXISTS public.admin_review_pasture_tree();
CREATE OR REPLACE FUNCTION public.admin_review_pasture_tree()
RETURNS TABLE (
  plain_id uuid, plain_name text, plain_order int,
  grassland_id uuid, grassland_name text, grassland_order int,
  pasture_id uuid, pasture_name text, pasture_order int,
  total_count int,
  verified_count int,
  needs_check_count int,
  unreviewed_count int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  RETURN QUERY
  SELECT
    pl.id, pl.name, pl.order_no,
    g.id, g.name, g.order_no,
    p.id, p.name, p.order_no,
    COUNT(m.id)::int AS total_count,
    COUNT(m.id) FILTER (WHERE m.review_status = 'verified')::int AS verified_count,
    COUNT(m.id) FILTER (WHERE m.review_status = 'needs_check')::int AS needs_check_count,
    COUNT(m.id) FILTER (WHERE m.review_status = 'unreviewed')::int AS unreviewed_count
  FROM public.plains pl
  LEFT JOIN public.grasslands g ON g.plain_id = pl.id
  LEFT JOIN public.directory_pastures p ON p.grassland_id = g.id
  LEFT JOIN public.households h ON h.pasture_id = p.id
  LEFT JOIN public.members m ON m.household_id = h.id
  GROUP BY pl.id, pl.name, pl.order_no, g.id, g.name, g.order_no, p.id, p.name, p.order_no
  ORDER BY pl.order_no, g.order_no, p.order_no;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_review_pasture_tree() TO authenticated;

-- =============================================================
-- 2. 특정 목장의 검수용 회원 리스트 (의심플래그 포함)
-- =============================================================
DROP FUNCTION IF EXISTS public.admin_review_pasture_members(uuid);
CREATE OR REPLACE FUNCTION public.admin_review_pasture_members(p_pasture_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  gender text,
  is_child boolean,
  sub_role text,
  family_church text,
  spouse_name text,
  birth_date date,
  address text,
  household_id uuid,
  household_order int,
  photo_url text,
  photo_status text,
  source_page int,
  photo_page int,
  review_status text,
  review_note text,
  reviewed_at timestamptz,
  reviewer_name text,
  flags text[],
  child_names text[],
  parent_names text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  RETURN QUERY
  SELECT
    m.id, m.name, m.phone, m.gender, m.is_child, m.sub_role,
    m.family_church, m.spouse_name, m.birth_date, h.address,
    h.id AS household_id,
    h.order_no AS household_order,
    m.photo_url, m.photo_status, m.source_page, m.photo_page,
    m.review_status, m.review_note, m.reviewed_at,
    rp.name AS reviewer_name,
    -- flags: 의심 사유 배열
    ARRAY_REMOVE(ARRAY[
      CASE WHEN m.photo_url IS NULL AND m.photo_status <> 'no_photo_in_pdf' THEN 'no_photo' END,
      CASE WHEN m.phone IS NOT NULL AND m.phone <> ''
                AND m.phone !~ '^01[016789]-?[0-9]{3,4}-?[0-9]{4}$' THEN 'bad_phone' END,
      CASE WHEN m.spouse_name IS NOT NULL AND m.spouse_name <> ''
                AND NOT EXISTS (
                  SELECT 1 FROM public.members ms
                  WHERE ms.household_id = m.household_id AND ms.id <> m.id AND ms.name = m.spouse_name
                ) THEN 'spouse_mismatch' END,
      CASE WHEN m.is_child AND NOT EXISTS (
                  SELECT 1 FROM public.member_relations r
                  WHERE r.subject_id = m.id AND r.kind <> 'spouse'
                ) THEN 'orphan_child' END,
      CASE WHEN m.household_id IS NULL THEN 'no_household' END,
      CASE WHEN m.source_page IS NULL THEN 'no_page' END
    ], NULL) AS flags,
    -- 같은 가구의 자녀 이름 배열 (관계 기반, 다른 목장도 포함)
    (SELECT ARRAY_AGG(cm.name ORDER BY cm.name)
       FROM public.member_relations cr
       JOIN public.members cm ON cm.id = cr.subject_id
      WHERE cr.relative_id = m.id AND cr.kind <> 'spouse') AS child_names,
    (SELECT ARRAY_AGG(pm.name ORDER BY pm.name)
       FROM public.member_relations pr
       JOIN public.members pm ON pm.id = pr.relative_id
      WHERE pr.subject_id = m.id AND pr.kind <> 'spouse') AS parent_names
  FROM public.members m
  LEFT JOIN public.households h ON h.id = m.household_id
  LEFT JOIN public.profiles rp ON rp.id = m.reviewed_by
  WHERE h.pasture_id = p_pasture_id
  ORDER BY h.order_no NULLS LAST, m.is_child, m.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_review_pasture_members(uuid) TO authenticated;

-- =============================================================
-- 3. 검수 상태 변경
-- =============================================================
DROP FUNCTION IF EXISTS public.admin_review_set_status(uuid, text, text);
CREATE OR REPLACE FUNCTION public.admin_review_set_status(
  p_member_id uuid,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  IF p_status NOT IN ('unreviewed', 'verified', 'needs_check') THEN
    RAISE EXCEPTION '잘못된 검수 상태: %', p_status;
  END IF;
  UPDATE public.members
     SET review_status = p_status,
         review_note   = p_note,
         reviewed_at   = CASE WHEN p_status = 'unreviewed' THEN NULL ELSE NOW() END,
         reviewed_by   = CASE WHEN p_status = 'unreviewed' THEN NULL ELSE auth.uid() END
   WHERE id = p_member_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_review_set_status(uuid, text, text) TO authenticated;

-- =============================================================
-- 4. 전체 요약 (대시보드 헤더용)
-- =============================================================
DROP FUNCTION IF EXISTS public.admin_review_summary();
CREATE OR REPLACE FUNCTION public.admin_review_summary()
RETURNS TABLE (
  total int,
  verified int,
  needs_check int,
  unreviewed int,
  flagged int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  RETURN QUERY
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE m.review_status = 'verified')::int,
    COUNT(*) FILTER (WHERE m.review_status = 'needs_check')::int,
    COUNT(*) FILTER (WHERE m.review_status = 'unreviewed')::int,
    COUNT(*) FILTER (WHERE
      m.photo_url IS NULL AND m.photo_status <> 'no_photo_in_pdf'
      OR (m.phone IS NOT NULL AND m.phone <> '' AND m.phone !~ '^01[016789]-?[0-9]{3,4}-?[0-9]{4}$')
      OR m.household_id IS NULL
    )::int
  FROM public.members m;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_review_summary() TO authenticated;
