-- =============================================================
-- edu_students 스키마 보강: 회원시스템(members) + 담임(edu_teachers) 연결
-- =============================================================

ALTER TABLE public.edu_students
  ADD COLUMN IF NOT EXISTS member_id  uuid REFERENCES public.members(id)      ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS teacher_id uuid REFERENCES public.edu_teachers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_edu_students_member  ON public.edu_students(member_id);
CREATE INDEX IF NOT EXISTS idx_edu_students_teacher ON public.edu_students(teacher_id);

-- ─────────────────────────────────────────
-- edu_list_students 함수에 member_id, teacher_id, teacher_name 노출
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_list_students(uuid);
CREATE OR REPLACE FUNCTION public.edu_list_students(p_dept_id uuid)
RETURNS TABLE (
  id           uuid,
  student_no   int,
  name         text,
  student_type text,
  grade        text,
  is_active    boolean,
  order_no     int,
  member_id    uuid,
  teacher_id   uuid,
  teacher_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id, s.student_no, s.name, s.student_type, s.grade, s.is_active, s.order_no,
    s.member_id, s.teacher_id,
    t.name AS teacher_name
  FROM public.edu_students s
  LEFT JOIN public.edu_teachers t ON s.teacher_id = t.id
  WHERE s.department_id = p_dept_id
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY s.grade, s.order_no, s.student_no, s.name;
$$;
GRANT EXECUTE ON FUNCTION public.edu_list_students(uuid) TO authenticated;
