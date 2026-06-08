-- Backfill existing one-line addresses into base/detail fields and expose them in signup RPCs.
-- Base address is the searchable road/lot address. Detail is user-entered unit information.

CREATE OR REPLACE FUNCTION public.split_korean_address(p_address text)
RETURNS TABLE (
  address_base text,
  address_detail text
)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH source AS (
    SELECT NULLIF(trim(COALESCE(p_address, '')), '') AS full_address
  ),
  road_split AS (
    SELECT
      full_address,
      regexp_match(full_address, '^(.*(?:로|길)\s+[0-9]+(?:-[0-9]+)?)(?:\s+(.+))?$') AS road_match
    FROM source
  ),
  first_pass AS (
    SELECT
      full_address,
      NULLIF(trim(COALESCE(road_match[1], full_address)), '') AS base_part,
      NULLIF(trim(road_match[2]), '') AS rest_part
    FROM road_split
  ),
  detail_pass AS (
    SELECT
      base_part,
      COALESCE(
        (regexp_match(rest_part, '([0-9A-Za-z가-힣-]+동\s*[0-9A-Za-z-]+호.*)$'))[1],
        rest_part
      ) AS detail_part
    FROM first_pass
  )
  SELECT base_part, NULLIF(trim(detail_part), '')
  FROM detail_pass;
$$;

WITH split AS (
  SELECT h.id, s.address_base, s.address_detail
  FROM public.households h
  CROSS JOIN LATERAL public.split_korean_address(h.address) s
  WHERE h.address IS NOT NULL
    AND (h.address_detail IS NULL OR h.address_base = h.address)
)
UPDATE public.households h
SET address_base = split.address_base,
    address_detail = split.address_detail
FROM split
WHERE h.id = split.id;

WITH split AS (
  SELECT m.id, s.address_base, s.address_detail
  FROM public.members m
  CROSS JOIN LATERAL public.split_korean_address(m.address) s
  WHERE m.address IS NOT NULL
    AND (m.address_detail IS NULL OR m.address_base = m.address)
)
UPDATE public.members m
SET address_base = split.address_base,
    address_detail = split.address_detail
FROM split
WHERE m.id = split.id;

DROP FUNCTION IF EXISTS public.find_member_for_signup(text, text);
CREATE OR REPLACE FUNCTION public.find_member_for_signup(
  p_name text,
  p_phone text
)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  family_church text,
  sub_role text,
  spouse_name text,
  household_id uuid,
  pasture_name text,
  grassland_name text,
  plain_name text,
  address text,
  has_account boolean,
  photo_url text,
  birth_date date,
  gender text,
  pasture_id uuid,
  grassland_id uuid,
  plain_id uuid,
  address_base text,
  address_detail text,
  address_zonecode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.name,
    m.phone,
    m.family_church,
    m.sub_role,
    m.spouse_name,
    m.household_id,
    p.name as pasture_name,
    g.name as grassland_name,
    COALESCE(pl.display_name, pl.name) as plain_name,
    COALESCE(h.address, m.address) as address,
    (m.app_user_id is not null) as has_account,
    m.photo_url,
    m.birth_date,
    m.gender,
    p.id as pasture_id,
    g.id as grassland_id,
    pl.id as plain_id,
    COALESCE(h.address_base, m.address_base, split.address_base) as address_base,
    COALESCE(h.address_detail, m.address_detail, split.address_detail) as address_detail,
    COALESCE(h.address_zonecode, m.address_zonecode) as address_zonecode
  FROM public.members m
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN LATERAL public.split_korean_address(COALESCE(h.address, m.address)) split ON true
  LEFT JOIN public.directory_pastures p ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g ON p.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE m.status = 'active'
    AND m.name = p_name
    AND (
      m.phone = p_phone
      OR regexp_replace(coalesce(m.phone, ''), '\D', '', 'g')
         = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
    )
  LIMIT 5;
$$;
GRANT EXECUTE ON FUNCTION public.find_member_for_signup(text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.find_child_for_signup(text, text, text);
CREATE OR REPLACE FUNCTION public.find_child_for_signup(
  p_child_name text,
  p_parent_name text,
  p_parent_phone text
)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  family_church text,
  sub_role text,
  spouse_name text,
  household_id uuid,
  pasture_name text,
  grassland_name text,
  plain_name text,
  address text,
  has_account boolean,
  parent_id uuid,
  parent_name text,
  parent_phone text,
  photo_url text,
  birth_date date,
  gender text,
  pasture_id uuid,
  grassland_id uuid,
  plain_id uuid,
  address_base text,
  address_detail text,
  address_zonecode text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_hh uuid;
  v_parent_id uuid;
  v_parent_name text;
  v_parent_phone text;
BEGIN
  SELECT m.id, m.household_id, m.name, m.phone
    INTO v_parent_id, v_parent_hh, v_parent_name, v_parent_phone
  FROM public.members m
  WHERE m.name = p_parent_name
    AND regexp_replace(coalesce(m.phone, ''), '\D', '', 'g')
        = regexp_replace(coalesce(p_parent_phone, ''), '\D', '', 'g')
    AND coalesce(m.is_child, false) = false
  LIMIT 1;

  IF v_parent_hh IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.phone,
    m.family_church,
    m.sub_role,
    m.spouse_name,
    m.household_id,
    p.name as pasture_name,
    g.name as grassland_name,
    COALESCE(pl.display_name, pl.name) as plain_name,
    COALESCE(h.address, m.address) as address,
    (m.app_user_id is not null) as has_account,
    v_parent_id as parent_id,
    v_parent_name as parent_name,
    v_parent_phone as parent_phone,
    m.photo_url,
    m.birth_date,
    m.gender,
    p.id as pasture_id,
    g.id as grassland_id,
    pl.id as plain_id,
    COALESCE(h.address_base, m.address_base, split.address_base) as address_base,
    COALESCE(h.address_detail, m.address_detail, split.address_detail) as address_detail,
    COALESCE(h.address_zonecode, m.address_zonecode) as address_zonecode
  FROM public.members m
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN LATERAL public.split_korean_address(COALESCE(h.address, m.address)) split ON true
  LEFT JOIN public.directory_pastures p ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g ON p.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE m.household_id = v_parent_hh
    AND m.name = p_child_name
    AND coalesce(m.is_child, false) = true
  LIMIT 5;
END;
$$;
GRANT EXECUTE ON FUNCTION public.find_child_for_signup(text, text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.find_parent_for_child_signup(text, text);
CREATE OR REPLACE FUNCTION public.find_parent_for_child_signup(
  p_parent_name text,
  p_parent_phone text
)
RETURNS TABLE (
  parent_id uuid,
  parent_name text,
  parent_phone text,
  household_id uuid,
  pasture_name text,
  grassland_name text,
  plain_name text,
  address text,
  pasture_id uuid,
  grassland_id uuid,
  plain_id uuid,
  address_base text,
  address_detail text,
  address_zonecode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.name,
    m.phone,
    m.household_id,
    p.name as pasture_name,
    g.name as grassland_name,
    COALESCE(pl.display_name, pl.name) as plain_name,
    h.address,
    p.id as pasture_id,
    g.id as grassland_id,
    pl.id as plain_id,
    COALESCE(h.address_base, split.address_base) as address_base,
    COALESCE(h.address_detail, split.address_detail) as address_detail,
    h.address_zonecode as address_zonecode
  FROM public.members m
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN LATERAL public.split_korean_address(h.address) split ON true
  LEFT JOIN public.directory_pastures p ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g ON p.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE m.name = p_parent_name
    AND regexp_replace(coalesce(m.phone, ''), '\D', '', 'g')
        = regexp_replace(coalesce(p_parent_phone, ''), '\D', '', 'g')
    AND coalesce(m.is_child, false) = false
  LIMIT 5;
$$;
GRANT EXECUTE ON FUNCTION public.find_parent_for_child_signup(text, text) TO anon, authenticated;
