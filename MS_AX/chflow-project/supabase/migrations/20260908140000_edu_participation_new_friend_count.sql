-- 참여율 조사 — 학생이 데려온 새친구 수(남/여)를 기록한다.
-- 기존 데이터(status/note)는 건드리지 않는 순수 추가(ADD COLUMN, 기본값 0)라 안전하다.

ALTER TABLE public.edu_participation_checks
  ADD COLUMN IF NOT EXISTS new_friend_male_count   int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_friend_female_count  int NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'edu_participation_checks_new_friend_male_check'
  ) THEN
    ALTER TABLE public.edu_participation_checks
      ADD CONSTRAINT edu_participation_checks_new_friend_male_check CHECK (new_friend_male_count >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'edu_participation_checks_new_friend_female_check'
  ) THEN
    ALTER TABLE public.edu_participation_checks
      ADD CONSTRAINT edu_participation_checks_new_friend_female_check CHECK (new_friend_female_count >= 0);
  END IF;
END $$;

-- ─────────────────────────────────────────
-- 조회에 새친구 수 포함 (기존 컬럼 순서·의미는 그대로 두고 뒤에 추가)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_participation_list(uuid, date);
CREATE OR REPLACE FUNCTION public.edu_participation_list(p_dept_id uuid, p_check_date date)
RETURNS TABLE (
  student_id            uuid,
  name                  text,
  class_no              text,
  grade_year            smallint,
  gender                text,
  teacher_name          text,
  status                text,
  note                  text,
  new_friend_male_count int,
  new_friend_female_count int
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
    c.note,
    COALESCE(c.new_friend_male_count, 0),
    COALESCE(c.new_friend_female_count, 0)
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
-- 새친구 수 저장 — status/note 는 건드리지 않는다
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_participation_set_new_friends(
  p_dept_id    uuid,
  p_student_id uuid,
  p_check_date date,
  p_male       int,
  p_female     int
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;
  IF p_male < 0 OR p_female < 0 THEN
    RAISE EXCEPTION 'invalid new friend count';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.edu_students WHERE id = p_student_id AND department_id = p_dept_id
  ) THEN
    RAISE EXCEPTION '학생을 찾을 수 없습니다';
  END IF;

  INSERT INTO public.edu_participation_checks (
    department_id, student_id, check_date, new_friend_male_count, new_friend_female_count, updated_by, updated_at
  )
  VALUES (p_dept_id, p_student_id, p_check_date, p_male, p_female, auth.uid(), now())
  ON CONFLICT (student_id, check_date)
  DO UPDATE SET
    new_friend_male_count = EXCLUDED.new_friend_male_count,
    new_friend_female_count = EXCLUDED.new_friend_female_count,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_set_new_friends(uuid, uuid, date, int, int) TO authenticated;
