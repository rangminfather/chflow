-- Allow education student photos before a student is linked to a member record.
ALTER TABLE public.edu_students
  ADD COLUMN IF NOT EXISTS photo_url text;

CREATE OR REPLACE FUNCTION public.edu_set_student_photo(
  p_dept_id    uuid,
  p_student_id uuid,
  p_photo_url  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  IF NOT public.edu_can_edit_student(p_dept_id, p_student_id) THEN
    RAISE EXCEPTION '해당 반 학생만 수정할 수 있습니다';
  END IF;

  SELECT member_id INTO v_member_id
  FROM public.edu_students
  WHERE id = p_student_id AND department_id = p_dept_id;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.members
    SET photo_url = NULLIF(p_photo_url, '')
    WHERE id = v_member_id;
  END IF;

  UPDATE public.edu_students
  SET photo_url = NULLIF(p_photo_url, '')
  WHERE id = p_student_id AND department_id = p_dept_id;
END;
$$;

REVOKE ALL ON FUNCTION public.edu_set_student_photo(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edu_set_student_photo(uuid, uuid, text) TO authenticated;

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
  teacher_name text,
  class_no     text,
  grade_year   smallint,
  photo_url    text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id, s.student_no, s.name, s.student_type, s.grade, s.is_active, s.order_no,
    s.member_id, s.teacher_id,
    t.name AS teacher_name,
    s.class_no,
    s.grade_year,
    s.photo_url
  FROM public.edu_students s
  LEFT JOIN public.edu_teachers t ON s.teacher_id = t.id
  WHERE s.department_id = p_dept_id
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY s.grade_year NULLS LAST, s.class_no, s.order_no, s.student_no, s.name;
$$;
GRANT EXECUTE ON FUNCTION public.edu_list_students(uuid) TO authenticated;
