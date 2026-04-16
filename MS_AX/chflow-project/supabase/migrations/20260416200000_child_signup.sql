-- 자녀 가입용 RPC: 부모 이름+전화로 household 좁힌 뒤 자녀 이름 매칭
DROP FUNCTION IF EXISTS public.find_child_for_signup(text, text, text);
CREATE OR REPLACE FUNCTION public.find_child_for_signup(
  p_child_name   text,
  p_parent_name  text,
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
  parent_phone text
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
        = regexp_replace(p_parent_phone, '\D', '', 'g')
    AND m.is_child = false
  LIMIT 1;

  IF v_parent_hh IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id, m.name, m.phone,
    m.family_church, m.sub_role, m.spouse_name,
    m.household_id,
    p.name  AS pasture_name,
    g.name  AS grassland_name,
    pl.name AS plain_name,
    h.address,
    (m.app_user_id IS NOT NULL) AS has_account,
    v_parent_id   AS parent_id,
    v_parent_name AS parent_name,
    v_parent_phone AS parent_phone
  FROM public.members m
  LEFT JOIN public.households h          ON m.household_id = h.id
  LEFT JOIN public.directory_pastures p  ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g          ON p.grassland_id = g.id
  LEFT JOIN public.plains pl             ON g.plain_id = pl.id
  WHERE m.household_id = v_parent_hh
    AND m.name = p_child_name
    AND m.is_child = true
  LIMIT 5;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_child_for_signup(text, text, text) TO anon, authenticated;
