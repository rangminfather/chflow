-- search_member_candidates 확장: 회원의 household_id, pasture_id 반환
-- 사용처: 회원 추가 시 자녀로 등록할 때 부모 후보를 검색하고
--         그 부모의 household_id를 받아 자녀를 같은 가족에 합류시키기 위함.

DROP FUNCTION IF EXISTS public.search_member_candidates(text, text, int);
CREATE OR REPLACE FUNCTION public.search_member_candidates(
  p_name  text,
  p_phone text DEFAULT NULL,
  p_limit int  DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  gender text,
  family_church text,
  sub_role text,
  address text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  is_child boolean,
  household_id uuid,
  pasture_id uuid,
  match_score int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id, m.name, m.phone, m.gender, m.family_church, m.sub_role,
    h.address,
    p.name  AS pasture_name,
    g.name  AS grassland_name,
    pl.name AS plain_name,
    m.is_child,
    m.household_id,
    h.pasture_id,
    CASE
      WHEN p_phone IS NOT NULL AND regexp_replace(coalesce(m.phone,''), '\D','','g')
           = regexp_replace(p_phone, '\D','','g') THEN 100
      WHEN p_phone IS NOT NULL AND right(regexp_replace(coalesce(m.phone,''), '\D','','g'), 4)
           = right(regexp_replace(p_phone, '\D','','g'), 4) THEN 80
      WHEN m.name = p_name THEN 50
      ELSE 10
    END AS match_score
  FROM public.members m
  LEFT JOIN public.households h          ON m.household_id = h.id
  LEFT JOIN public.directory_pastures p  ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g          ON p.grassland_id = g.id
  LEFT JOIN public.plains pl             ON g.plain_id = pl.id
  WHERE m.name = p_name
  ORDER BY match_score DESC, m.is_child ASC, m.name
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_member_candidates(text, text, int) TO anon, authenticated;
