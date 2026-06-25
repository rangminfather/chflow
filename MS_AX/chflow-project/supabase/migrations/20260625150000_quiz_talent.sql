-- =============================================================
-- 달란트 Phase B — 공과퀴즈 달란트 (바이블 공과퀴즈)
--   월 1회 시험, 문제당 1점(10~15문항 가변). 담임이 아니라 서기(등급≤2)가 채점 후 입력.
--   기존 출석/체크 모델(boolean×규칙)과 달리 학생별 가변 점수 → 전용 테이블.
--   통장 "총 달란트"에 합산되도록 talent 화면에서 별도 합산.
--   적용: <supabase.exe> --workdir <proj> db query --linked --file supabase\migrations\20260625150000_quiz_talent.sql
-- =============================================================

CREATE TABLE IF NOT EXISTS public.edu_quiz_talent (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id)  ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES public.edu_students(id) ON DELETE CASCADE,
  quiz_date     date NOT NULL,
  points        int  NOT NULL DEFAULT 0,   -- 지급 달란트 (= 맞은 개수, 문제당 1점)
  total_count   int,                        -- 총 문항 수 (10~15, 참고용)
  note          text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (student_id, quiz_date)
);

CREATE INDEX IF NOT EXISTS idx_quiz_talent_dept_date
  ON public.edu_quiz_talent(department_id, quiz_date DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_talent_student
  ON public.edu_quiz_talent(student_id, quiz_date DESC);

ALTER TABLE public.edu_quiz_talent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quiz_talent_rls" ON public.edu_quiz_talent;
CREATE POLICY "quiz_talent_rls" ON public.edu_quiz_talent
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));


-- ─────────────────────────────────────────
-- 목록: 부서 월별 공과퀴즈 기록 (입력화면용)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_quiz_talent_list(uuid, int, int);
CREATE OR REPLACE FUNCTION public.edu_quiz_talent_list(
  p_dept_id uuid,
  p_year    int,
  p_month   int
)
RETURNS TABLE (
  id          uuid,
  student_id  uuid,
  quiz_date   date,
  points      int,
  total_count int,
  note        text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.id, q.student_id, q.quiz_date, q.points, q.total_count, q.note
  FROM public.edu_quiz_talent q
  WHERE q.department_id = p_dept_id
    AND EXTRACT(YEAR  FROM q.quiz_date) = p_year
    AND EXTRACT(MONTH FROM q.quiz_date) = p_month
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY q.quiz_date, q.student_id;
$$;
GRANT EXECUTE ON FUNCTION public.edu_quiz_talent_list(uuid, int, int) TO authenticated;


-- ─────────────────────────────────────────
-- 저장(UPSERT) — 권한 grade 0~2 (서기 포함)
--   p_points 0 이하이고 기존 기록 있으면 삭제(미응시 처리)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_quiz_talent_save(uuid, uuid, date, int, int, text);
CREATE OR REPLACE FUNCTION public.edu_quiz_talent_save(
  p_dept_id    uuid,
  p_student_id uuid,
  p_date       date,
  p_points     int,
  p_total      int,
  p_note       text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF public.get_user_grade(p_dept_id) > 2 THEN
    RAISE EXCEPTION '권한이 없습니다 (요구: 임원진 등급 0~2)';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION '시험일(quiz_date)은 필수입니다';
  END IF;

  -- 미응시(0점)이고 기존 기록이 있으면 삭제
  IF COALESCE(p_points, 0) <= 0 THEN
    DELETE FROM public.edu_quiz_talent
      WHERE student_id = p_student_id AND quiz_date = p_date AND department_id = p_dept_id;
    RETURN NULL;
  END IF;

  INSERT INTO public.edu_quiz_talent
    (department_id, student_id, quiz_date, points, total_count, note, created_by)
  VALUES
    (p_dept_id, p_student_id, p_date, p_points, p_total, p_note, auth.uid())
  ON CONFLICT (student_id, quiz_date) DO UPDATE SET
    points      = EXCLUDED.points,
    total_count = EXCLUDED.total_count,
    note        = EXCLUDED.note,
    updated_at  = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_quiz_talent_save(uuid, uuid, date, int, int, text) TO authenticated;


-- ─────────────────────────────────────────
-- 삭제 — 권한 grade 0~2
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_quiz_talent_delete(uuid);
CREATE OR REPLACE FUNCTION public.edu_quiz_talent_delete(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dept uuid;
BEGIN
  SELECT department_id INTO v_dept FROM public.edu_quiz_talent WHERE id = p_id;
  IF v_dept IS NULL THEN RETURN; END IF;
  IF public.get_user_grade(v_dept) > 2 THEN
    RAISE EXCEPTION '권한이 없습니다 (요구: 임원진 등급 0~2)';
  END IF;
  DELETE FROM public.edu_quiz_talent WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_quiz_talent_delete(uuid) TO authenticated;
