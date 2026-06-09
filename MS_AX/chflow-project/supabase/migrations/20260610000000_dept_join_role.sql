-- =============================================================
-- 부서 가입 역할 선택 + 임원진 승인 RPC
-- =============================================================

-- 1. request_department_join: p_role 파라미터 추가 (teacher | 학부모)
DROP FUNCTION IF EXISTS public.request_department_join(uuid);
DROP FUNCTION IF EXISTS public.request_department_join(uuid, text);
CREATE OR REPLACE FUNCTION public.request_department_join(
  p_dept_id uuid,
  p_role    text DEFAULT 'member'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id       uuid;
  v_existing_status text;
  v_join_id       uuid;
  v_dept_name     text;
  v_dept_category text;
  v_user_name     text;
  v_notif_id      uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;

  SELECT status INTO v_existing_status
  FROM public.department_members
  WHERE department_id = p_dept_id AND user_id = v_user_id;

  IF v_existing_status = 'approved' THEN
    RAISE EXCEPTION '이미 가입된 부서입니다';
  ELSIF v_existing_status = 'pending' THEN
    RAISE EXCEPTION '이미 가입 신청 중입니다';
  ELSIF v_existing_status = 'rejected' THEN
    UPDATE public.department_members
    SET status = 'pending', member_role = p_role,
        requested_at = now(), approved_at = NULL, approved_by = NULL
    WHERE department_id = p_dept_id AND user_id = v_user_id
    RETURNING id INTO v_join_id;
  ELSE
    INSERT INTO public.department_members (department_id, user_id, status, member_role)
    VALUES (p_dept_id, v_user_id, 'pending', p_role)
    RETURNING id INTO v_join_id;
  END IF;

  SELECT name, category INTO v_dept_name, v_dept_category
  FROM public.departments WHERE id = p_dept_id;

  SELECT name INTO v_user_name
  FROM public.profiles WHERE id = v_user_id;

  -- 시스템 관리자 알림
  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
  SELECT
    id, 'dept_join_request', '🏢 부서 가입 신청',
    v_user_name || '님이 ' || v_dept_category || ' / ' || v_dept_name || ' 가입을 신청했습니다 (' || p_role || ')',
    '/admin/dept-pending', v_user_id
  FROM public.profiles
  WHERE role IN ('admin', 'office', 'pastor') AND status = 'active';

  -- 해당 부서 임원진(grade 0~2) 알림 — 시스템 관리자 중복 제외
  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
  SELECT
    dm2.user_id, 'dept_join_request', '📥 부서 가입 신청',
    v_user_name || '님이 ' || v_dept_name || ' 가입을 신청했습니다 (' || p_role || ')',
    '/departments/d/' || p_dept_id || '/dept-approval', v_user_id
  FROM public.department_members dm2
  JOIN public.profiles p2 ON p2.id = dm2.user_id
  WHERE dm2.department_id = p_dept_id
    AND dm2.status = 'approved'
    AND dm2.grade <= 2
    AND dm2.user_id != v_user_id
    AND p2.role NOT IN ('admin', 'office', 'pastor');

  RETURN v_join_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_department_join(uuid, text) TO authenticated;


-- 2. list_dept_pending_for_leader: grade 0~2 임원진이 자기 부서 대기자 조회
DROP FUNCTION IF EXISTS public.list_dept_pending_for_leader(uuid);
CREATE OR REPLACE FUNCTION public.list_dept_pending_for_leader(p_dept_id uuid)
RETURNS TABLE(
  id             uuid,
  department_id  uuid,
  user_id        uuid,
  user_name      text,
  user_phone     text,
  user_role      text,
  user_sub_role  text,
  requested_role text,
  category       text,
  dept_name      text,
  dept_icon      text,
  requested_at   timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_grade smallint;
BEGIN
  v_grade := public.get_user_grade(p_dept_id);
  IF v_grade > 2 THEN
    RAISE EXCEPTION '권한 없음 (임원진 grade 0~2만 가능)';
  END IF;

  RETURN QUERY
  SELECT
    dm.id,
    dm.department_id,
    dm.user_id,
    p.name::text          AS user_name,
    p.phone::text         AS user_phone,
    p.role::text          AS user_role,
    p.sub_role::text      AS user_sub_role,
    dm.member_role::text  AS requested_role,
    d.category::text      AS category,
    d.name::text          AS dept_name,
    d.icon::text          AS dept_icon,
    dm.requested_at
  FROM public.department_members dm
  JOIN public.profiles p ON p.id = dm.user_id
  JOIN public.departments d ON d.id = dm.department_id
  WHERE dm.department_id = p_dept_id
    AND dm.status = 'pending'
  ORDER BY dm.requested_at;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_dept_pending_for_leader(uuid) TO authenticated;


-- 3. dept_leader_approve_join: grade 0~2 임원진 승인/거절
DROP FUNCTION IF EXISTS public.dept_leader_approve_join(uuid, boolean, smallint);
CREATE OR REPLACE FUNCTION public.dept_leader_approve_join(
  p_join_id  uuid,
  p_approved boolean,
  p_grade    smallint DEFAULT 3
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dept_id        uuid;
  v_member_user_id uuid;
  v_dept_name      text;
  v_approver_grade smallint;
BEGIN
  SELECT dm.department_id, dm.user_id, d.name
  INTO v_dept_id, v_member_user_id, v_dept_name
  FROM public.department_members dm
  JOIN public.departments d ON d.id = dm.department_id
  WHERE dm.id = p_join_id;

  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION '신청을 찾을 수 없습니다';
  END IF;

  v_approver_grade := public.get_user_grade(v_dept_id);
  IF v_approver_grade > 2 THEN
    RAISE EXCEPTION '권한 없음 (임원진 grade 0~2만 승인 가능)';
  END IF;

  IF p_approved THEN
    UPDATE public.department_members
    SET status = 'approved', approved_at = now(), approved_by = auth.uid(), grade = p_grade
    WHERE id = p_join_id;

    INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
    VALUES (
      v_member_user_id, 'dept_approved', '✅ 부서 가입 승인',
      v_dept_name || ' 가입이 승인되었습니다',
      '/home', auth.uid()
    );
  ELSE
    UPDATE public.department_members
    SET status = 'rejected', approved_at = now(), approved_by = auth.uid()
    WHERE id = p_join_id;

    INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
    VALUES (
      v_member_user_id, 'dept_rejected', '❌ 부서 가입 거절',
      v_dept_name || ' 가입 신청이 거절되었습니다',
      '/home', auth.uid()
    );
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dept_leader_approve_join(uuid, boolean, smallint) TO authenticated;
