-- =============================================================
-- 부서 대시보드 참여 멤버 팝업 — 얼굴·이름 목록 RPC
--  - department_members RLS 가 "자기 행 또는 admin/office/pastor" 라서
--    일반 부서원은 클라이언트 직접 조회로 명단을 볼 수 없음 → SECURITY DEFINER
--  - 이름·사진: members (app_user_id 매칭) 우선, profiles(name/avatar_url) 폴백
--  - 접근: 해당 부서 approved 멤버 본인 또는 admin/office/pastor
-- =============================================================
DROP FUNCTION IF EXISTS public.list_dept_member_faces(uuid);
CREATE OR REPLACE FUNCTION public.list_dept_member_faces(p_dept_id uuid)
RETURNS TABLE (
  user_id uuid,
  name text,
  photo_url text,
  member_role text,
  grade smallint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    dm.user_id,
    COALESCE(m.name, p.name) AS name,
    COALESCE(m.photo_url, p.avatar_url) AS photo_url,
    dm.member_role,
    dm.grade
  FROM public.department_members dm
  LEFT JOIN public.profiles p ON p.id = dm.user_id
  LEFT JOIN LATERAL (
    SELECT mm.name, mm.photo_url
    FROM public.members mm
    WHERE mm.app_user_id = dm.user_id
    LIMIT 1
  ) m ON true
  WHERE dm.department_id = p_dept_id
    AND dm.status = 'approved'
    AND (
      EXISTS (
        SELECT 1 FROM public.department_members me
        WHERE me.department_id = p_dept_id
          AND me.user_id = auth.uid()
          AND me.status = 'approved'
      )
      OR public.get_user_role() IN ('admin', 'office', 'pastor')
    )
  ORDER BY dm.grade, COALESCE(m.name, p.name);
$$;
GRANT EXECUTE ON FUNCTION public.list_dept_member_faces(uuid) TO authenticated;
