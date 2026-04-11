-- =============================================================
-- 사역/부서 관리 확장: 회원 목록/탈퇴/임명
-- =============================================================

-- 1. 부서 회원 목록 조회 (관리자용 - 전체 부서별)
DROP FUNCTION IF EXISTS public.admin_list_dept_members(uuid);
CREATE OR REPLACE FUNCTION public.admin_list_dept_members(p_dept_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_name text,
  user_phone text,
  user_sub_role text,
  user_avatar_url text,
  member_role text,
  status text,
  joined_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    dm.id,
    dm.user_id,
    p.name,
    p.phone,
    p.sub_role,
    p.avatar_url,
    dm.member_role,
    dm.status,
    dm.approved_at
  FROM public.department_members dm
  JOIN public.profiles p ON dm.user_id = p.id
  WHERE dm.department_id = p_dept_id
    AND dm.status = 'approved'
  ORDER BY
    CASE dm.member_role
      WHEN '부장' THEN 1
      WHEN '부부장' THEN 2
      WHEN '총무' THEN 3
      WHEN '서기' THEN 4
      WHEN '부총무' THEN 5
      WHEN '부서기' THEN 6
      WHEN '교사' THEN 7
      ELSE 99
    END,
    p.name;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_dept_members(uuid) TO authenticated;


-- 2. 부서 회원 탈퇴 (관리자가 강제 탈퇴)
DROP FUNCTION IF EXISTS public.admin_remove_dept_member(uuid);
CREATE OR REPLACE FUNCTION public.admin_remove_dept_member(p_join_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_dept_id uuid;
  v_dept_name text;
  v_dept_category text;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  -- 정보 조회
  SELECT dm.user_id, dm.department_id, d.name, d.category
  INTO v_user_id, v_dept_id, v_dept_name, v_dept_category
  FROM public.department_members dm
  JOIN public.departments d ON dm.department_id = d.id
  WHERE dm.id = p_join_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '회원을 찾을 수 없습니다';
  END IF;

  -- 삭제
  DELETE FROM public.department_members WHERE id = p_join_id;

  -- 신청자에게 알림
  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
  VALUES (
    v_user_id,
    'dept_removed',
    '🚪 부서 탈퇴 처리',
    v_dept_category || ' ' || v_dept_name || '에서 탈퇴 처리되었습니다',
    '/home',
    auth.uid()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_remove_dept_member(uuid) TO authenticated;


-- 3. 부서 회원 직책 임명 (member_role 변경)
DROP FUNCTION IF EXISTS public.admin_set_dept_member_role(uuid, text);
CREATE OR REPLACE FUNCTION public.admin_set_dept_member_role(
  p_join_id uuid,
  p_role text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_dept_name text;
  v_dept_category text;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  -- 정보 조회
  SELECT dm.user_id, d.name, d.category
  INTO v_user_id, v_dept_name, v_dept_category
  FROM public.department_members dm
  JOIN public.departments d ON dm.department_id = d.id
  WHERE dm.id = p_join_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '회원을 찾을 수 없습니다';
  END IF;

  -- 직책 업데이트
  UPDATE public.department_members
  SET member_role = p_role
  WHERE id = p_join_id;

  -- 신청자에게 알림
  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
  VALUES (
    v_user_id,
    'dept_role_assigned',
    '🎖️ 직책 임명',
    v_dept_category || ' ' || v_dept_name || '의 ' || p_role || '(으)로 임명되었습니다',
    '/home',
    auth.uid()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_dept_member_role(uuid, text) TO authenticated;


-- 4. 모든 부서 트리 (관리자 사이드바용)
DROP FUNCTION IF EXISTS public.admin_list_all_departments();
CREATE OR REPLACE FUNCTION public.admin_list_all_departments()
RETURNS TABLE (
  id uuid,
  category text,
  name text,
  icon text,
  member_count bigint,
  pending_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    d.id,
    d.category,
    d.name,
    d.icon,
    (SELECT COUNT(*) FROM public.department_members dm WHERE dm.department_id = d.id AND dm.status = 'approved') AS member_count,
    (SELECT COUNT(*) FROM public.department_members dm WHERE dm.department_id = d.id AND dm.status = 'pending') AS pending_count
  FROM public.departments d
  WHERE d.is_active = true
  ORDER BY d.category, d.order_no, d.name;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_all_departments() TO authenticated;
