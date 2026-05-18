-- 담임선생님 지정 메뉴용 RPC + 변경 이력
-- (teacher_assignment_log 테이블은 이미 별도 적용됨, IF NOT EXISTS 로 멱등 처리)

CREATE TABLE IF NOT EXISTS public.teacher_assignment_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('bulk_assign','merge_placeholder','change_student','manual_edit')),
  class_no TEXT,
  old_teacher_id UUID,
  old_teacher_name TEXT,
  new_teacher_id UUID,
  new_teacher_name TEXT,
  student_id UUID,
  student_name TEXT,
  placeholder_id UUID,
  real_member_id UUID,
  reason TEXT,
  changed_by UUID,
  changed_by_name TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_assignment_log_dept ON public.teacher_assignment_log(department_id, changed_at DESC);

ALTER TABLE public.teacher_assignment_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_grade_select_assignment_log ON public.teacher_assignment_log;
CREATE POLICY admin_grade_select_assignment_log ON public.teacher_assignment_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.department_members dm
            WHERE dm.department_id = teacher_assignment_log.department_id
              AND dm.user_id = auth.uid() AND dm.grade <= 2)
  );

-- 1. 반 단위 담임 일괄 변경
CREATE OR REPLACE FUNCTION public.bulk_assign_class_teacher(
  p_dept_id UUID,
  p_class_no TEXT,
  p_new_teacher_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_caller_name TEXT;
  v_caller_grade SMALLINT;
  v_old_teacher_id UUID;
  v_old_teacher_name TEXT;
  v_new_teacher_name TEXT;
  v_count INTEGER;
BEGIN
  SELECT grade INTO v_caller_grade FROM public.department_members
  WHERE department_id = p_dept_id AND user_id = v_caller;
  IF v_caller_grade IS NULL OR v_caller_grade > 1 THEN
    RAISE EXCEPTION '권한 없음 (grade 0~1 만 가능)';
  END IF;
  SELECT name INTO v_caller_name FROM public.profiles WHERE id = v_caller;
  SELECT name INTO v_new_teacher_name FROM public.edu_teachers
  WHERE id = p_new_teacher_id AND department_id = p_dept_id;
  IF v_new_teacher_name IS NULL THEN
    RAISE EXCEPTION '담임 정보 없음 또는 부서 불일치';
  END IF;
  SELECT teacher_id INTO v_old_teacher_id FROM public.edu_students
  WHERE department_id = p_dept_id AND class_no = p_class_no LIMIT 1;
  IF v_old_teacher_id IS NOT NULL THEN
    SELECT name INTO v_old_teacher_name FROM public.edu_teachers WHERE id = v_old_teacher_id;
  END IF;
  UPDATE public.edu_students
  SET teacher_id = p_new_teacher_id
  WHERE department_id = p_dept_id AND class_no = p_class_no;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.teacher_assignment_log (
    department_id, action_type, class_no, old_teacher_id, old_teacher_name,
    new_teacher_id, new_teacher_name, reason, changed_by, changed_by_name
  ) VALUES (
    p_dept_id, 'bulk_assign', p_class_no, v_old_teacher_id, v_old_teacher_name,
    p_new_teacher_id, v_new_teacher_name, p_reason, v_caller, v_caller_name
  );
  RETURN v_count;
END;
$$;

-- 2. placeholder ↔ 실 회원 연결
CREATE OR REPLACE FUNCTION public.merge_placeholder_teacher(
  p_placeholder_id UUID,
  p_target_user_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_caller_name TEXT;
  v_caller_grade SMALLINT;
  v_dept_id UUID;
  v_placeholder_name TEXT;
  v_target_member_id UUID;
  v_target_name TEXT;
BEGIN
  SELECT department_id, name INTO v_dept_id, v_placeholder_name
  FROM public.edu_teachers WHERE id = p_placeholder_id;
  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION 'placeholder 없음';
  END IF;
  SELECT grade INTO v_caller_grade FROM public.department_members
  WHERE department_id = v_dept_id AND user_id = v_caller;
  IF v_caller_grade IS NULL OR v_caller_grade > 1 THEN
    RAISE EXCEPTION '권한 없음';
  END IF;
  SELECT name INTO v_caller_name FROM public.profiles WHERE id = v_caller;
  SELECT member_id, name INTO v_target_member_id, v_target_name
  FROM public.profiles WHERE id = p_target_user_id;
  IF v_target_name IS NULL THEN
    RAISE EXCEPTION '대상 사용자 없음';
  END IF;
  UPDATE public.edu_teachers
  SET user_id = p_target_user_id,
      member_id = v_target_member_id,
      name = v_target_name
  WHERE id = p_placeholder_id;
  INSERT INTO public.teacher_assignment_log (
    department_id, action_type, placeholder_id, real_member_id,
    new_teacher_id, new_teacher_name, reason, changed_by, changed_by_name
  ) VALUES (
    v_dept_id, 'merge_placeholder', p_placeholder_id, v_target_member_id,
    p_placeholder_id, v_target_name, p_reason, v_caller, v_caller_name
  );
  RETURN TRUE;
END;
$$;

-- 3. 반별 + 담임 정보 조회
CREATE OR REPLACE FUNCTION public.list_classes_with_teachers(p_dept_id UUID)
RETURNS TABLE (
  class_no TEXT,
  grade_year SMALLINT,
  teacher_id UUID,
  teacher_name TEXT,
  teacher_member_id UUID,
  is_placeholder BOOLEAN,
  student_count BIGINT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    es.class_no,
    es.grade_year,
    es.teacher_id,
    et.name AS teacher_name,
    et.member_id AS teacher_member_id,
    (et.member_id IS NULL) AS is_placeholder,
    COUNT(*) AS student_count
  FROM public.edu_students es
  LEFT JOIN public.edu_teachers et ON et.id = es.teacher_id
  WHERE es.department_id = p_dept_id AND es.is_active = TRUE
  GROUP BY es.class_no, es.grade_year, es.teacher_id, et.name, et.member_id
  ORDER BY es.grade_year NULLS LAST, es.class_no;
END;
$$;

-- 4. 부서의 모든 담임 (placeholder + 실 회원)
CREATE OR REPLACE FUNCTION public.list_teachers_status(p_dept_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  member_id UUID,
  user_id UUID,
  is_placeholder BOOLEAN,
  is_active BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT et.id, et.name, et.member_id, et.user_id, (et.member_id IS NULL), et.is_active
  FROM public.edu_teachers et
  WHERE et.department_id = p_dept_id
  ORDER BY et.is_active DESC, et.name;
END;
$$;

-- 5. 회원 연결 후보 (이 부서의 실 회원, placeholder 와 연결 안 된)
CREATE OR REPLACE FUNCTION public.list_dept_eligible_for_teacher(p_dept_id UUID)
RETURNS TABLE (
  user_id UUID,
  member_id UUID,
  name TEXT,
  grade SMALLINT,
  already_linked BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.member_id,
    p.name,
    dm.grade,
    EXISTS (SELECT 1 FROM public.edu_teachers et
            WHERE et.department_id = p_dept_id AND et.user_id = p.id) AS already_linked
  FROM public.department_members dm
  JOIN public.profiles p ON p.id = dm.user_id
  WHERE dm.department_id = p_dept_id AND dm.grade <= 3
  ORDER BY p.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_assign_class_teacher TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_placeholder_teacher TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_classes_with_teachers TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_teachers_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_dept_eligible_for_teacher TO authenticated;
