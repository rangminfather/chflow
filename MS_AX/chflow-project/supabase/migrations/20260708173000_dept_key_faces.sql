-- =============================================================
-- 부서 가입 화면 카드 — 주요 인원(대표/부장/총무/담임) 얼굴 RPC
--  - 기존 클라이언트 직접 조회는 profiles.user_id/photo_url (미존재 컬럼) 참조 +
--    department_members RLS(자기 행만)로 일반 사용자에게 동작한 적 없음 → RPC 교체
--  - 이름·사진: members(app_user_id 매칭) 우선, profiles(name/avatar_url) 폴백
--  - 접근: 로그인 사용자 전체 (가입 전 탐색 화면이 원래 노출 대상)
-- =============================================================
DROP FUNCTION IF EXISTS public.list_dept_key_faces(text);
CREATE OR REPLACE FUNCTION public.list_dept_key_faces(p_category text)
RETURNS TABLE (
  department_id uuid,
  member_role text,
  grade smallint,
  name text,
  photo_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    dm.department_id,
    dm.member_role,
    dm.grade,
    COALESCE(m.name, p.name) AS name,
    COALESCE(m.photo_url, p.avatar_url) AS photo_url
  FROM public.department_members dm
  JOIN public.departments d ON d.id = dm.department_id
  LEFT JOIN public.profiles p ON p.id = dm.user_id
  LEFT JOIN LATERAL (
    SELECT mm.name, mm.photo_url
    FROM public.members mm
    WHERE mm.app_user_id = dm.user_id
    LIMIT 1
  ) m ON true
  WHERE d.category = p_category
    AND d.is_active = true
    AND dm.status = 'approved'
    AND dm.member_role IN ('leader', '교육사', '부장', '총무', 'teacher')
    AND auth.uid() IS NOT NULL
  ORDER BY dm.department_id, dm.grade;
$$;
GRANT EXECUTE ON FUNCTION public.list_dept_key_faces(text) TO authenticated;
