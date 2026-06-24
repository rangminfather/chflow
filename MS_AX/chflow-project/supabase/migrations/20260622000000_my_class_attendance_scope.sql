-- "내 반 출결" 전용 저장 RPC.
-- 시스템/부서 직책과 무관하게 실제 담임 배정(edu_students.teacher_id) 학생만 저장한다.
CREATE OR REPLACE FUNCTION public.edu_set_my_class_attendance(
  p_student_id    uuid,
  p_dept_id       uuid,
  p_date          date,
  p_prayer        boolean,
  p_church_sch    boolean,
  p_worship       boolean,
  p_lesson        boolean,
  p_bible         boolean,
  p_status        text,
  p_memo          text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.edu_teachers t
    JOIN public.edu_students s
      ON s.teacher_id = t.id
     AND s.department_id = t.department_id
    WHERE t.department_id = p_dept_id
      AND t.user_id = auth.uid()
      AND t.is_active = true
      AND s.id = p_student_id
      AND s.is_active = true
  ) THEN
    RAISE EXCEPTION '담당 반 학생만 출결을 처리할 수 있습니다';
  END IF;

  INSERT INTO public.edu_student_attendance (
    student_id, dept_id, attend_date,
    had_prayer, had_church_sch, had_worship, had_lesson, had_bible,
    attend_status, memo
  ) VALUES (
    p_student_id, p_dept_id, p_date,
    COALESCE(p_prayer, false), COALESCE(p_church_sch, false),
    COALESCE(p_worship, false), COALESCE(p_lesson, false), COALESCE(p_bible, false),
    COALESCE(p_status, '출'), p_memo
  )
  ON CONFLICT (student_id, attend_date) DO UPDATE SET
    had_prayer     = EXCLUDED.had_prayer,
    had_church_sch = EXCLUDED.had_church_sch,
    had_worship    = EXCLUDED.had_worship,
    had_lesson     = EXCLUDED.had_lesson,
    had_bible      = EXCLUDED.had_bible,
    attend_status  = EXCLUDED.attend_status,
    memo           = EXCLUDED.memo;
END;
$$;

REVOKE ALL ON FUNCTION public.edu_set_my_class_attendance(uuid,uuid,date,boolean,boolean,boolean,boolean,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edu_set_my_class_attendance(uuid,uuid,date,boolean,boolean,boolean,boolean,boolean,text,text) TO authenticated;
