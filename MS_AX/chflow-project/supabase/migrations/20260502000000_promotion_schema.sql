-- =============================================================
-- 매년 학년 진급(Promotion) 시스템 — 스키마 보강
--   1. edu_students: grade_year(int) + class_no(text) 분리
--   2. departments: grade_year_min/max + next_dept_id (진급 매핑)
--   3. edu_student_history: 매년 스냅샷 이력
-- =============================================================

-- ─────────────────────────────────────────
-- 1. edu_students 컬럼 추가
-- ─────────────────────────────────────────
ALTER TABLE public.edu_students
  ADD COLUMN IF NOT EXISTS grade_year smallint,
  ADD COLUMN IF NOT EXISTS class_no   text;

CREATE INDEX IF NOT EXISTS idx_edu_students_grade_year
  ON public.edu_students(department_id, grade_year, class_no);


-- ─────────────────────────────────────────
-- 2. departments 진급 매핑 컬럼
--    grade_year_min/max NULL이면 비-교육사역국 부서
--    next_dept_id NULL이면 마지막 부서(졸업 보관)
-- ─────────────────────────────────────────
ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS grade_year_min smallint,
  ADD COLUMN IF NOT EXISTS grade_year_max smallint,
  ADD COLUMN IF NOT EXISTS next_dept_id   uuid REFERENCES public.departments(id) ON DELETE SET NULL;


-- ─────────────────────────────────────────
-- 3. 이력 테이블 (연도별 스냅샷)
--    매년 진급 확정 시 직전 연도 상태를 INSERT
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edu_student_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year            smallint NOT NULL,                                  -- 해당 연도 (예: 2026)
  student_id      uuid REFERENCES public.edu_students(id)  ON DELETE SET NULL,
  member_id       uuid REFERENCES public.members(id)       ON DELETE SET NULL,
  member_name     text NOT NULL,                                       -- 학생 row 사라져도 이름 보존
  department_id   uuid REFERENCES public.departments(id)   ON DELETE SET NULL,
  department_name text NOT NULL,                                       -- 부서 사라져도 이름 보존
  grade_year      smallint,
  class_no        text,
  teacher_id      uuid REFERENCES public.edu_teachers(id)  ON DELETE SET NULL,
  teacher_name    text,
  status          text NOT NULL DEFAULT '재학'
                  CHECK (status IN ('재학','졸업','전출')),
  created_at      timestamptz DEFAULT now(),
  UNIQUE (year, student_id)
);

CREATE INDEX IF NOT EXISTS idx_edu_history_dept_year
  ON public.edu_student_history(department_id, year);
CREATE INDEX IF NOT EXISTS idx_edu_history_member
  ON public.edu_student_history(member_id);

ALTER TABLE public.edu_student_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "edu_history_rls" ON public.edu_student_history;
CREATE POLICY "edu_history_rls" ON public.edu_student_history
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));
