-- =============================================================
-- admin_get_household_members
--   회원 수정 모달에서 같은 household 의 다른 멤버 목록을 가져오기 위한 RPC.
--   주소 변경 시 어떤 가족을 함께 옮길지 체크박스로 선택하기 위해 사용됨.
-- =============================================================

DROP FUNCTION IF EXISTS public.admin_get_household_members(uuid);
CREATE OR REPLACE FUNCTION public.admin_get_household_members(
  p_household_id uuid
)
RETURNS TABLE (
  id            uuid,
  name          text,
  gender        text,
  family_church text,
  is_child      boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF p_household_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT m.id, m.name, m.gender, m.family_church, m.is_child
    FROM public.members m
    WHERE m.household_id = p_household_id
    ORDER BY
      CASE m.family_church
        WHEN '목자' THEN 1 WHEN '목녀' THEN 2 WHEN '목부' THEN 3 ELSE 4
      END,
      m.is_child ASC,
      m.name ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_household_members(uuid) TO authenticated;
