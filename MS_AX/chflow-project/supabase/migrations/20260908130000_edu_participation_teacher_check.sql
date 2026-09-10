-- 참여율 조사 — 교사 출결도 함께 체크할 수 있도록 확장.
-- 학생용 edu_participation_checks 와 동일한 구조를 교사(edu_teachers)에 대해 별도 테이블로 둔다.

CREATE TABLE IF NOT EXISTS public.edu_participation_teacher_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  teacher_id    uuid NOT NULL REFERENCES public.edu_teachers(id) ON DELETE CASCADE,
  check_date    date NOT NULL,
  status        text NOT NULL DEFAULT '' CHECK (status IN ('', '참석', '불참')),
  note          text,
  updated_by    uuid REFERENCES auth.users(id),
  updated_at    timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now(),
  UNIQUE (teacher_id, check_date)
);

ALTER TABLE public.edu_participation_teacher_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "edu_participation_teacher_checks_rls" ON public.edu_participation_teacher_checks;
CREATE POLICY "edu_participation_teacher_checks_rls" ON public.edu_participation_teacher_checks
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));

CREATE INDEX IF NOT EXISTS idx_edu_participation_teacher_checks_dept_date
  ON public.edu_participation_teacher_checks(department_id, check_date);

-- ─────────────────────────────────────────
-- 조회: 교사 목록 + 해당 날짜 체크 상태/비고
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_participation_teacher_list(p_dept_id uuid, p_check_date date)
RETURNS TABLE (
  teacher_id   uuid,
  name         text,
  teacher_role text,
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
    t.id,
    t.name,
    t.teacher_role,
    COALESCE(c.status, '')::text,
    c.note
  FROM public.edu_teachers t
  LEFT JOIN public.edu_participation_teacher_checks c
    ON c.teacher_id = t.id AND c.check_date = p_check_date
  WHERE t.department_id = p_dept_id
    AND t.is_active
  ORDER BY t.order_no, t.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_teacher_list(uuid, date) TO authenticated;

-- ─────────────────────────────────────────
-- 상태 변경
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_participation_teacher_set_status(
  p_dept_id    uuid,
  p_teacher_id uuid,
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
    SELECT 1 FROM public.edu_teachers WHERE id = p_teacher_id AND department_id = p_dept_id
  ) THEN
    RAISE EXCEPTION '교사를 찾을 수 없습니다';
  END IF;

  INSERT INTO public.edu_participation_teacher_checks (department_id, teacher_id, check_date, status, updated_by, updated_at)
  VALUES (p_dept_id, p_teacher_id, p_check_date, p_status, auth.uid(), now())
  ON CONFLICT (teacher_id, check_date)
  DO UPDATE SET status = EXCLUDED.status, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_teacher_set_status(uuid, uuid, date, text) TO authenticated;

-- ─────────────────────────────────────────
-- 비고 저장
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_participation_teacher_set_note(
  p_dept_id    uuid,
  p_teacher_id uuid,
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
    SELECT 1 FROM public.edu_teachers WHERE id = p_teacher_id AND department_id = p_dept_id
  ) THEN
    RAISE EXCEPTION '교사를 찾을 수 없습니다';
  END IF;

  INSERT INTO public.edu_participation_teacher_checks (department_id, teacher_id, check_date, note, updated_by, updated_at)
  VALUES (p_dept_id, p_teacher_id, p_check_date, NULLIF(p_note, ''), auth.uid(), now())
  ON CONFLICT (teacher_id, check_date)
  DO UPDATE SET note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_teacher_set_note(uuid, uuid, date, text) TO authenticated;
