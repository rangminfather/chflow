-- =============================================================
-- 성도요람 검색 결과에서도 수동 자녀 서열을 우선 적용한다.
-- 기존에는 is_child 다음에 gender를 정렬해, 남자 자녀가 첫째 지정값보다
-- 먼저 표시될 수 있었다. 자녀는 child_order → 생년월일 → 성별 → 이름 순이다.
-- =============================================================

CREATE OR REPLACE FUNCTION public.directory_search_members(
  p_query     text default null,
  p_plain     text default null,
  p_grassland text default null,
  p_pasture   text default null,
  p_offset    int  default 0,
  p_limit     int  default 30
)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  home_phone text,
  gender text,
  family_church text,
  sub_role text,
  spouse_name text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  is_child boolean,
  photo_url text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
#variable_conflict use_column
BEGIN
  IF public.search_request_is_anonymous() THEN
    RAISE EXCEPTION '로그인이 필요합니다' USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH input AS (
    SELECT
      nullif(trim(p_query), '') AS query_text,
      nullif(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), '') AS query_digits,
      public.hangul_search_regex(p_query) AS query_regex
  ),
  scoped AS (
    SELECT
      m.id,
      m.name,
      m.phone,
      m.home_phone,
      m.gender,
      m.family_church,
      m.sub_role,
      m.spouse_name,
      p.name AS pasture_name,
      g.name AS grassland_name,
      pl.name AS plain_name,
      m.is_child,
      m.photo_url,
      m.household_id,
      m.child_order,
      m.birth_date,
      h.home_phone AS household_home_phone,
      CASE
        WHEN i.query_text IS NULL THEN 0
        WHEN lower(m.name) = lower(i.query_text) THEN 0
        WHEN m.name ilike i.query_text || '%' THEN 1
        WHEN i.query_regex IS NOT NULL AND m.name ~* ('^' || i.query_regex) THEN 1
        WHEN m.name ilike '%' || i.query_text || '%' THEN 2
        WHEN i.query_regex IS NOT NULL AND m.name ~* i.query_regex THEN 2
        WHEN coalesce(m.spouse_name, '') ilike '%' || i.query_text || '%' THEN 3
        WHEN i.query_regex IS NOT NULL AND coalesce(m.spouse_name, '') ~* i.query_regex THEN 3
        ELSE 4
      END AS match_order
    FROM public.members m
    LEFT JOIN public.households h ON h.id = m.household_id
    LEFT JOIN public.directory_pastures p ON p.id = h.pasture_id
    LEFT JOIN public.grasslands g ON g.id = p.grassland_id
    LEFT JOIN public.plains pl ON pl.id = g.plain_id
    CROSS JOIN input i
    WHERE m.status = 'active'
      AND (nullif(p_plain, '') IS NULL OR pl.name = p_plain)
      AND (nullif(p_grassland, '') IS NULL OR g.name = p_grassland)
      AND (nullif(p_pasture, '') IS NULL OR p.name = p_pasture)
  ),
  direct_matches AS (
    SELECT s.*
    FROM scoped s
    CROSS JOIN input i
    WHERE i.query_text IS NULL
      OR s.name ilike '%' || i.query_text || '%'
      OR coalesce(s.spouse_name, '') ilike '%' || i.query_text || '%'
      OR (
        i.query_regex IS NOT NULL
        AND (
          s.name ~* i.query_regex
          OR coalesce(s.spouse_name, '') ~* i.query_regex
        )
      )
      OR (
        i.query_digits IS NOT NULL
        AND (
          regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') LIKE '%' || i.query_digits || '%'
          OR regexp_replace(coalesce(s.home_phone, ''), '\D', '', 'g') LIKE '%' || i.query_digits || '%'
          OR regexp_replace(coalesce(s.household_home_phone, ''), '\D', '', 'g') LIKE '%' || i.query_digits || '%'
        )
      )
  ),
  related_ids AS (
    SELECT dm.id
    FROM direct_matches dm

    UNION

    SELECT s.id
    FROM scoped s
    JOIN direct_matches dm ON dm.household_id IS NOT NULL AND s.household_id = dm.household_id

    UNION

    SELECT r.subject_id
    FROM public.member_relations r
    JOIN direct_matches dm ON dm.id = r.relative_id
    WHERE r.kind <> 'spouse'
  ),
  filtered AS (
    SELECT
      s.id,
      s.name,
      s.phone,
      s.home_phone,
      s.gender,
      s.family_church,
      s.sub_role,
      s.spouse_name,
      s.pasture_name,
      s.grassland_name,
      s.plain_name,
      s.is_child,
      s.photo_url,
      s.child_order,
      s.birth_date,
      CASE WHEN dm.id IS NOT NULL THEN s.match_order ELSE 4 END AS match_order
    FROM scoped s
    LEFT JOIN direct_matches dm ON dm.id = s.id
    CROSS JOIN input i
    WHERE (i.query_text IS NULL AND dm.id IS NOT NULL)
       OR (i.query_text IS NOT NULL AND s.id IN (SELECT related_ids.id FROM related_ids))
  )
  SELECT
    f.id,
    f.name,
    f.phone,
    f.home_phone,
    f.gender,
    f.family_church,
    f.sub_role,
    f.spouse_name,
    f.pasture_name,
    f.grassland_name,
    f.plain_name,
    f.is_child,
    f.photo_url,
    (SELECT count(*) FROM filtered)::bigint AS total_count
  FROM filtered f
  ORDER BY
    f.match_order,
    coalesce(f.is_child, false),
    CASE WHEN coalesce(f.is_child, false) THEN f.child_order END NULLS LAST,
    CASE WHEN coalesce(f.is_child, false) THEN f.birth_date END NULLS LAST,
    CASE f.gender WHEN 'M' THEN 0 WHEN 'F' THEN 1 ELSE 2 END,
    f.name,
    f.id
  OFFSET greatest(coalesce(p_offset, 0), 0)
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 100);
END;
$fn$;

REVOKE ALL ON FUNCTION public.directory_search_members(text, text, text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.directory_search_members(text, text, text, text, int, int) TO authenticated, service_role, postgres;

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'directory_search_members'
    AND pg_get_function_identity_arguments(p.oid) = 'p_query text, p_plain text, p_grassland text, p_pasture text, p_offset integer, p_limit integer';

  IF v_definition IS NULL
     OR v_definition NOT LIKE '%f.child_order%'
     OR has_function_privilege('anon', 'public.directory_search_members(text,text,text,text,integer,integer)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'directory_search_members 자녀 순서 또는 실행 권한 검증 실패';
  END IF;
END
$$;
