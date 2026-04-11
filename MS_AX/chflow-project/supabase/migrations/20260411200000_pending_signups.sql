-- =============================================================
-- 관리자: 가입 대기자 조회 RPC
-- =============================================================

DROP FUNCTION IF EXISTS public.admin_list_pending_signups();
CREATE OR REPLACE FUNCTION public.admin_list_pending_signups()
RETURNS TABLE (
  id uuid,
  username text,
  name text,
  phone text,
  role text,
  sub_role text,
  status text,
  created_at timestamptz,
  matched_member_id uuid,
  matched_member_name text,
  matched_pasture text,
  matched_plain text
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
    p.created_at,
    m.id AS matched_member_id,
    m.name AS matched_member_name,
    pa.name AS matched_pasture,
    pl.name AS matched_plain
  FROM public.profiles p
  LEFT JOIN public.members m ON m.app_user_id = p.id
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures pa ON h.pasture_id = pa.id
  LEFT JOIN public.grasslands g ON pa.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE p.status = 'pending'
  ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_pending_signups() TO authenticated;


-- =============================================================
-- 관리자: 거절 시 사용자 삭제 옵션
-- =============================================================
DROP FUNCTION IF EXISTS public.admin_reject_signup(uuid, boolean);
CREATE OR REPLACE FUNCTION public.admin_reject_signup(
  p_user_id uuid,
  p_delete boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF p_delete THEN
    -- members 연결 해제
    UPDATE public.members
    SET app_user_id = NULL, guard_status = '비회원'
    WHERE app_user_id = p_user_id;
    -- profile 삭제 (auth.users는 별도 처리 필요)
    DELETE FROM public.profiles WHERE id = p_user_id;
  ELSE
    -- 상태만 'rejected'로
    UPDATE public.profiles
    SET status = 'rejected',
        approved_at = now(),
        approved_by = auth.uid()
    WHERE id = p_user_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reject_signup(uuid, boolean) TO authenticated;
