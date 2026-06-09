-- admin_approve_dept_join 에 p_grade 파라미터 추가
-- 기존엔 grade 필드를 업데이트하지 않아 등급 미저장 버그

DROP FUNCTION IF EXISTS public.admin_approve_dept_join(uuid, boolean);
DROP FUNCTION IF EXISTS public.admin_approve_dept_join(uuid, boolean, smallint);

CREATE OR REPLACE FUNCTION public.admin_approve_dept_join(
  p_join_id  uuid,
  p_approved boolean,
  p_grade    smallint DEFAULT 3
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id       uuid;
  v_dept_id       uuid;
  v_dept_name     text;
  v_dept_category text;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  SELECT dm.user_id, dm.department_id, d.name, d.category
  INTO v_user_id, v_dept_id, v_dept_name, v_dept_category
  FROM public.department_members dm
  JOIN public.departments d ON dm.department_id = d.id
  WHERE dm.id = p_join_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '신청을 찾을 수 없습니다';
  END IF;

  IF p_approved THEN
    UPDATE public.department_members
    SET status = 'approved', grade = p_grade, approved_at = now(), approved_by = auth.uid()
    WHERE id = p_join_id;
  ELSE
    UPDATE public.department_members
    SET status = 'rejected', approved_at = now(), approved_by = auth.uid()
    WHERE id = p_join_id;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
  VALUES (
    v_user_id,
    CASE WHEN p_approved THEN 'dept_join_approved' ELSE 'dept_join_rejected' END,
    CASE WHEN p_approved THEN '✅ 부서 가입 승인' ELSE '❌ 부서 가입 거절' END,
    CASE WHEN p_approved
         THEN v_dept_category || ' ' || v_dept_name || ' 가입이 승인되었습니다!'
         ELSE v_dept_category || ' ' || v_dept_name || ' 가입이 거절되었습니다' END,
    CASE WHEN p_approved THEN '/departments/d/' || v_dept_id::text ELSE '/home' END,
    auth.uid()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_approve_dept_join(uuid, boolean, smallint) TO authenticated;
