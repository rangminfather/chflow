-- 초등1부 부서관리 > 참여율 조사
-- 반별 학생 명단에서 참석/불참을 체크하고 비고를 기록해 날짜별로 저장한다.
-- 접근 권한은 get_user_grade 0~1 (전도사·부장) 로 제한 — 부서관리 메뉴 기준과 동일.

CREATE TABLE IF NOT EXISTS public.edu_participation_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES public.edu_students(id) ON DELETE CASCADE,
  check_date    date NOT NULL,
  status        text NOT NULL DEFAULT '' CHECK (status IN ('', '참석', '불참')),
  note          text,
  updated_by    uuid REFERENCES auth.users(id),
  updated_at    timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now(),
  UNIQUE (student_id, check_date)
);

ALTER TABLE public.edu_participation_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "edu_participation_checks_rls" ON public.edu_participation_checks;
CREATE POLICY "edu_participation_checks_rls" ON public.edu_participation_checks
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));

CREATE INDEX IF NOT EXISTS idx_edu_participation_checks_dept_date
  ON public.edu_participation_checks(department_id, check_date);

-- ─────────────────────────────────────────
-- 조회: 반별 학생 + 해당 날짜 체크 상태/비고
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_participation_list(p_dept_id uuid, p_check_date date)
RETURNS TABLE (
  student_id   uuid,
  name         text,
  class_no     text,
  grade_year   smallint,
  gender       text,
  teacher_name text,
  status       text,
  note         text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.name,
    s.class_no,
    s.grade_year,
    s.gender,
    t.name AS teacher_name,
    COALESCE(c.status, '')::text,
    c.note
  FROM public.edu_students s
  LEFT JOIN public.edu_teachers t ON t.id = s.teacher_id
  LEFT JOIN public.edu_participation_checks c
    ON c.student_id = s.id AND c.check_date = p_check_date
  WHERE s.department_id = p_dept_id
    AND s.is_active
  ORDER BY s.grade_year NULLS LAST, s.class_no, s.order_no, s.student_no, s.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_list(uuid, date) TO authenticated;

-- ─────────────────────────────────────────
-- 상태 변경 (미체크 → 참석 → 불참 → 미체크 순환은 프런트에서 계산해 값만 전달)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_participation_set_status(
  p_dept_id    uuid,
  p_student_id uuid,
  p_check_date date,
  p_status     text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;
  IF p_status NOT IN ('', '참석', '불참') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.edu_students WHERE id = p_student_id AND department_id = p_dept_id
  ) THEN
    RAISE EXCEPTION '학생을 찾을 수 없습니다';
  END IF;

  INSERT INTO public.edu_participation_checks (department_id, student_id, check_date, status, updated_by, updated_at)
  VALUES (p_dept_id, p_student_id, p_check_date, p_status, auth.uid(), now())
  ON CONFLICT (student_id, check_date)
  DO UPDATE SET status = EXCLUDED.status, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_set_status(uuid, uuid, date, text) TO authenticated;

-- ─────────────────────────────────────────
-- 비고 저장
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_participation_set_note(
  p_dept_id    uuid,
  p_student_id uuid,
  p_check_date date,
  p_note       text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.edu_students WHERE id = p_student_id AND department_id = p_dept_id
  ) THEN
    RAISE EXCEPTION '학생을 찾을 수 없습니다';
  END IF;

  INSERT INTO public.edu_participation_checks (department_id, student_id, check_date, note, updated_by, updated_at)
  VALUES (p_dept_id, p_student_id, p_check_date, NULLIF(p_note, ''), auth.uid(), now())
  ON CONFLICT (student_id, check_date)
  DO UPDATE SET note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_set_note(uuid, uuid, date, text) TO authenticated;
