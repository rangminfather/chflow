-- =============================================================
-- 사용자 정보 확장 RPC: profile + members 정보 결합
-- =============================================================

DROP FUNCTION IF EXISTS public.get_my_full_info();
CREATE OR REPLACE FUNCTION public.get_my_full_info()
RETURNS TABLE (
  -- profile 정보
  id uuid,
  username text,
  name text,
  phone text,
  role text,
  sub_role text,
  status text,
  -- members 연결 정보
  member_id uuid,
  family_church text,
  spouse_name text,
  -- 가정교회 정보
  household_id uuid,
  address text,
  pasture_id uuid,
  pasture_name text,
  grassland_id uuid,
  grassland_name text,
  plain_id uuid,
  plain_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.username,
    p.name,
    p.phone,
    p.role,
    p.sub_role,
    p.status,
    m.id AS member_id,
    m.family_church,
    m.spouse_name,
    m.household_id,
    h.address,
    pa.id AS pasture_id,
    pa.name AS pasture_name,
    g.id AS grassland_id,
    g.name AS grassland_name,
    pl.id AS plain_id,
    pl.name AS plain_name
  FROM public.profiles p
  LEFT JOIN public.members m ON m.app_user_id = p.id
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures pa ON h.pasture_id = pa.id
  LEFT JOIN public.grasslands g ON pa.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE p.id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_full_info() TO authenticated;
