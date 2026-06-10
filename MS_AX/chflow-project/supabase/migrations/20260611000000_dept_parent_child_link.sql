-- =============================================================
-- 학부모 자녀 다중 연결 + 자녀 졸업/이동 시 자동 탈퇴
--
-- 핵심 설계:
--   dept_parent_children : (dept, parent_user, student) 연결 N개
--   자녀 1명 졸업 → 링크만 제거, 다른 자녀 남아있으면 membership 유지
--   마지막 자녀까지 사라지면 department_members 자동 삭제
-- =============================================================

-- ─────────────────────────────────────────
-- 1. 학부모-자녀 연결 테이블
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dept_parent_children (
  department_id   uuid NOT NULL REFERENCES public.departments(id)   ON DELETE CASCADE,
  parent_user_id  uuid NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.edu_students(id)  ON DELETE CASCADE,
  created_at      timestamptz DEFAULT now(),
  PRIMARY KEY (department_id, parent_user_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_dpc_dept_parent ON public.dept_parent_children(department_id, parent_user_id);
CREATE INDEX IF NOT EXISTS idx_dpc_student     ON public.dept_parent_children(student_id);

ALTER TABLE public.dept_parent_children ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dpc_auth_select" ON public.dept_parent_children;
CREATE POLICY "dpc_auth_select" ON public.dept_parent_children
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "dpc_admin_write" ON public.dept_parent_children;
CREATE POLICY "dpc_admin_write" ON public.dept_parent_children
  FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin','office','pastor'))
  WITH CHECK (public.get_user_role() IN ('admin','office','pastor'));


-- ─────────────────────────────────────────
-- 2. 자녀 목록 조회 RPC (부서 가입 시 학부모 역할 확인용)
--    인증된 사용자라면 누구나 호출 가능 (가입 신청 전 조회 필요)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.dept_list_children(uuid);
CREATE OR REPLACE FUNCTION public.dept_list_children(p_dept_id uuid)
RETURNS TABLE (
  id           uuid,
  student_no   int,
  name         text,
  grade        text,
  teacher_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.student_no, s.name, s.grade, t.name AS teacher_name
  FROM public.edu_students s
  LEFT JOIN public.edu_teachers t ON s.teacher_id = t.id
  WHERE s.department_id = p_dept_id AND s.is_active = true
  ORDER BY s.grade, s.order_no, s.student_no, s.name;
$$;
GRANT EXECUTE ON FUNCTION public.dept_list_children(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 3. request_department_join — 자녀 배열 파라미터 추가
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.request_department_join(uuid, text);
DROP FUNCTION IF EXISTS public.request_department_join(uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.request_department_join(
  p_dept_id           uuid,
  p_role              text    DEFAULT 'member',
  p_child_student_ids uuid[]  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id         uuid;
  v_existing_status text;
  v_join_id         uuid;
  v_dept_name       text;
  v_dept_category   text;
  v_user_name       text;
  v_sid             uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;

  -- 학부모는 자녀 1명 이상 필수
  IF p_role = '학부모' AND (p_child_student_ids IS NULL OR array_length(p_child_student_ids, 1) = 0) THEN
    RAISE EXCEPTION '학부모로 가입 시 자녀를 1명 이상 지정해야 합니다';
  END IF;

  -- 지정 자녀가 모두 해당 부서에 활성 상태인지 검증
  IF p_child_student_ids IS NOT NULL THEN
    FOREACH v_sid IN ARRAY p_child_student_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.edu_students
        WHERE id = v_sid AND department_id = p_dept_id AND is_active = true
      ) THEN
        RAISE EXCEPTION '지정한 자녀가 이 부서에 없거나 비활성입니다';
      END IF;
    END LOOP;
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

  -- 자녀 링크 갱신 (기존 삭제 후 재삽입)
  IF p_child_student_ids IS NOT NULL AND array_length(p_child_student_ids, 1) > 0 THEN
    DELETE FROM public.dept_parent_children
    WHERE department_id = p_dept_id AND parent_user_id = v_user_id;

    FOREACH v_sid IN ARRAY p_child_student_ids LOOP
      INSERT INTO public.dept_parent_children (department_id, parent_user_id, student_id)
      VALUES (p_dept_id, v_user_id, v_sid)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  SELECT name, category INTO v_dept_name, v_dept_category
  FROM public.departments WHERE id = p_dept_id;

  SELECT name INTO v_user_name
  FROM public.profiles WHERE id = v_user_id;

  -- 시스템 관리자 알림
  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
  SELECT id, 'dept_join_request', '🏢 부서 가입 신청',
    v_user_name || '님이 ' || v_dept_category || ' / ' || v_dept_name || ' 가입을 신청했습니다 (' || p_role || ')',
    '/admin/dept-pending', v_user_id
  FROM public.profiles WHERE role IN ('admin', 'office', 'pastor') AND status = 'active';

  -- 부서 임원진(grade 0~2) 알림
  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
  SELECT dm2.user_id, 'dept_join_request', '📥 부서 가입 신청',
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
GRANT EXECUTE ON FUNCTION public.request_department_join(uuid, text, uuid[]) TO authenticated;


-- ─────────────────────────────────────────
-- 4. list_dept_pending_for_leader — 자녀 정보(여러 명) 포함
-- ─────────────────────────────────────────
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
  requested_at   timestamptz,
  children_desc  text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_grade smallint;
BEGIN
  v_grade := public.get_user_grade(p_dept_id);
  IF v_grade > 2 THEN RAISE EXCEPTION '권한 없음 (임원진 grade 0~2만 가능)'; END IF;

  RETURN QUERY
  SELECT
    dm.id, dm.department_id, dm.user_id,
    p.name::text      AS user_name,
    p.phone::text     AS user_phone,
    p.role::text      AS user_role,
    p.sub_role::text  AS user_sub_role,
    dm.member_role::text AS requested_role,
    d.category::text  AS category,
    d.name::text      AS dept_name,
    d.icon::text      AS dept_icon,
    dm.requested_at,
    (
      SELECT string_agg(
        COALESCE(es.grade, '?') || '반 ' || es.name,
        ', ' ORDER BY es.grade, es.name
      )
      FROM public.dept_parent_children dpc
      JOIN public.edu_students es ON es.id = dpc.student_id
      WHERE dpc.department_id = dm.department_id AND dpc.parent_user_id = dm.user_id
    )::text AS children_desc
  FROM public.department_members dm
  JOIN public.profiles p ON p.id = dm.user_id
  JOIN public.departments d ON d.id = dm.department_id
  WHERE dm.department_id = p_dept_id AND dm.status = 'pending'
  ORDER BY dm.requested_at;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_dept_pending_for_leader(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 5. 트리거: 자녀 이탈 → 링크 제거 → 자녀 없으면 학부모 자동 탈퇴
-- ─────────────────────────────────────────

-- Step A: edu_students 삭제/비활성/부서이동 → dept_parent_children 링크 제거
CREATE OR REPLACE FUNCTION public.fn_student_leave_cleanup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.dept_parent_children WHERE student_id = OLD.id;
    RETURN OLD;
  END IF;
  -- is_active 비활성 or 부서 변경
  IF TG_OP = 'UPDATE' AND (
    (OLD.is_active = true AND NEW.is_active = false) OR
    (OLD.department_id IS DISTINCT FROM NEW.department_id)
  ) THEN
    DELETE FROM public.dept_parent_children WHERE student_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_leave ON public.edu_students;
CREATE TRIGGER trg_student_leave
  AFTER DELETE OR UPDATE OF is_active, department_id ON public.edu_students
  FOR EACH ROW EXECUTE FUNCTION public.fn_student_leave_cleanup();


-- Step B: dept_parent_children 삭제 후 자녀 남아있는지 확인 → 없으면 membership 삭제
CREATE OR REPLACE FUNCTION public.fn_parent_auto_remove()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- 같은 부서에 연결된 다른 자녀가 있으면 탈퇴 안 함
  IF NOT EXISTS (
    SELECT 1 FROM public.dept_parent_children
    WHERE department_id = OLD.department_id AND parent_user_id = OLD.parent_user_id
  ) THEN
    DELETE FROM public.department_members
    WHERE department_id = OLD.department_id
      AND user_id = OLD.parent_user_id
      AND member_role = '학부모';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_parent_auto_remove ON public.dept_parent_children;
CREATE TRIGGER trg_parent_auto_remove
  AFTER DELETE ON public.dept_parent_children
  FOR EACH ROW EXECUTE FUNCTION public.fn_parent_auto_remove();
