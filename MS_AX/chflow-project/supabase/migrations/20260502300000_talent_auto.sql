-- =============================================================
-- 달란트 자동 적립 (B)
--   1. edu_weekly_extra: 출석부 외 주별 추가 항목 체크 (헌금/주보요절/인도/등반/심방/우스반 등)
--   2. RPC: list_attendance_columns(dept_id) — 출석부에 보여줄 동적 컬럼 (시스템 + custom)
--   3. RPC: toggle_weekly_extra(student_id, date, rule_id, checked)
--   4. RPC: get_student_auto_talent(student_id, year_from, month_from, year_to, month_to)
--      — 시스템 출석 boolean × weekly rule + custom extra × weekly rule + 보너스(수동) 합산
-- =============================================================

-- ─────────────────────────────────────────
-- 1. edu_weekly_extra
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edu_weekly_extra (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid NOT NULL REFERENCES public.edu_students(id)     ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id)      ON DELETE CASCADE,
  attend_date   date NOT NULL,
  rule_id       uuid NOT NULL REFERENCES public.edu_talent_rules(id) ON DELETE CASCADE,
  checked       boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (student_id, attend_date, rule_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_extra_dept_date
  ON public.edu_weekly_extra(department_id, attend_date);
CREATE INDEX IF NOT EXISTS idx_weekly_extra_student
  ON public.edu_weekly_extra(student_id, attend_date);

ALTER TABLE public.edu_weekly_extra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "weekly_extra_rls" ON public.edu_weekly_extra;
CREATE POLICY "weekly_extra_rls" ON public.edu_weekly_extra
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));


-- ─────────────────────────────────────────
-- 2. 출석부 동적 컬럼 목록
--    시스템 매핑 (attendance/prayer/church_school/worship/lesson/bible) +
--    custom weekly (rule_kind='weekly' AND rule_key NOT IN 시스템키)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.list_attendance_columns(uuid);
CREATE OR REPLACE FUNCTION public.list_attendance_columns(p_dept_id uuid)
RETURNS TABLE (
  rule_id    uuid,
  rule_key   text,
  label      text,
  points     int,
  source     text  -- 'system' | 'custom'
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id        AS rule_id,
    r.rule_key,
    r.label,
    r.points,
    CASE WHEN r.rule_key IN ('attendance','prayer','church_school','worship','lesson','bible')
         THEN 'system' ELSE 'custom' END AS source
  FROM public.edu_talent_rules r
  WHERE r.department_id = p_dept_id
    AND r.rule_kind = 'weekly'
    AND r.is_active = true
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY r.order_no, r.label;
$$;
GRANT EXECUTE ON FUNCTION public.list_attendance_columns(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 3. 추가 항목 토글 (UPSERT, 또는 DELETE)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.toggle_weekly_extra(uuid, uuid, date, uuid, boolean);
CREATE OR REPLACE FUNCTION public.toggle_weekly_extra(
  p_student_id uuid,
  p_dept_id    uuid,
  p_date       date,
  p_rule_id    uuid,
  p_checked    boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF p_checked THEN
    INSERT INTO public.edu_weekly_extra (student_id, department_id, attend_date, rule_id, checked)
    VALUES (p_student_id, p_dept_id, p_date, p_rule_id, true)
    ON CONFLICT (student_id, attend_date, rule_id) DO UPDATE
      SET checked = true;
  ELSE
    DELETE FROM public.edu_weekly_extra
      WHERE student_id = p_student_id AND attend_date = p_date AND rule_id = p_rule_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.toggle_weekly_extra(uuid, uuid, date, uuid, boolean) TO authenticated;


-- ─────────────────────────────────────────
-- 4. 부서 출석부 + 추가 체크 일괄 조회 (출석부 UI용)
--    edu_get_student_attendance와 별개로 추가 체크만 반환
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_dept_weekly_extra(uuid, int, int);
CREATE OR REPLACE FUNCTION public.get_dept_weekly_extra(
  p_dept_id uuid,
  p_year    int,
  p_month   int
)
RETURNS TABLE (
  student_id  uuid,
  attend_date date,
  rule_id     uuid,
  rule_key    text,
  points      int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.student_id, e.attend_date, e.rule_id, r.rule_key, r.points
  FROM public.edu_weekly_extra e
  JOIN public.edu_talent_rules r ON r.id = e.rule_id
  WHERE e.department_id = p_dept_id
    AND e.checked = true
    AND EXTRACT(YEAR FROM e.attend_date)  = p_year
    AND EXTRACT(MONTH FROM e.attend_date) = p_month
    AND public.is_edu_member_or_admin(p_dept_id);
$$;
GRANT EXECUTE ON FUNCTION public.get_dept_weekly_extra(uuid, int, int) TO authenticated;


-- ─────────────────────────────────────────
-- 5. 학생 자동 적립 합계 (기간 지정)
--    시스템: edu_student_attendance × edu_talent_rules(weekly, system key)
--    Custom: edu_weekly_extra × edu_talent_rules
--    (보너스/특별 지급은 수동 talent_records에 기록되어 별도)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_student_auto_talent(uuid, int, int, int, int);
CREATE OR REPLACE FUNCTION public.get_student_auto_talent(
  p_student_id uuid,
  p_year_from  int,
  p_month_from int,
  p_year_to    int,
  p_month_to   int
)
RETURNS TABLE (
  rule_id    uuid,
  rule_key   text,
  label      text,
  source     text,
  count_hits int,
  per_hit    int,
  total      int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH dept AS (
    SELECT s.department_id FROM public.edu_students s WHERE s.id = p_student_id
  ),
  range_ok AS (
    SELECT * FROM dept WHERE public.is_edu_member_or_admin(department_id)
  ),
  -- 시스템 출석 boolean 매핑
  system_hits AS (
    SELECT 'attendance'    AS rule_key, COUNT(*) AS cnt FROM public.edu_student_attendance a
      WHERE a.student_id = p_student_id
        AND EXTRACT(YEAR FROM a.attend_date)*100 + EXTRACT(MONTH FROM a.attend_date)
            BETWEEN p_year_from*100 + p_month_from AND p_year_to*100 + p_month_to
        AND a.attend_status = '출'
    UNION ALL
    SELECT 'prayer',         COUNT(*) FROM public.edu_student_attendance a
      WHERE a.student_id = p_student_id
        AND EXTRACT(YEAR FROM a.attend_date)*100 + EXTRACT(MONTH FROM a.attend_date)
            BETWEEN p_year_from*100 + p_month_from AND p_year_to*100 + p_month_to
        AND a.had_prayer = true
    UNION ALL
    SELECT 'church_school',  COUNT(*) FROM public.edu_student_attendance a
      WHERE a.student_id = p_student_id
        AND EXTRACT(YEAR FROM a.attend_date)*100 + EXTRACT(MONTH FROM a.attend_date)
            BETWEEN p_year_from*100 + p_month_from AND p_year_to*100 + p_month_to
        AND a.had_church_sch = true
    UNION ALL
    SELECT 'worship',        COUNT(*) FROM public.edu_student_attendance a
      WHERE a.student_id = p_student_id
        AND EXTRACT(YEAR FROM a.attend_date)*100 + EXTRACT(MONTH FROM a.attend_date)
            BETWEEN p_year_from*100 + p_month_from AND p_year_to*100 + p_month_to
        AND a.had_worship = true
    UNION ALL
    SELECT 'lesson',         COUNT(*) FROM public.edu_student_attendance a
      WHERE a.student_id = p_student_id
        AND EXTRACT(YEAR FROM a.attend_date)*100 + EXTRACT(MONTH FROM a.attend_date)
            BETWEEN p_year_from*100 + p_month_from AND p_year_to*100 + p_month_to
        AND a.had_lesson = true
    UNION ALL
    SELECT 'bible',          COUNT(*) FROM public.edu_student_attendance a
      WHERE a.student_id = p_student_id
        AND EXTRACT(YEAR FROM a.attend_date)*100 + EXTRACT(MONTH FROM a.attend_date)
            BETWEEN p_year_from*100 + p_month_from AND p_year_to*100 + p_month_to
        AND a.had_bible = true
  ),
  -- Custom weekly extra
  custom_hits AS (
    SELECT r.id AS rule_id, r.rule_key, COUNT(*)::int AS cnt
    FROM public.edu_weekly_extra e
    JOIN public.edu_talent_rules r ON r.id = e.rule_id
    WHERE e.student_id = p_student_id
      AND e.checked = true
      AND r.rule_kind = 'weekly'
      AND r.rule_key NOT IN ('attendance','prayer','church_school','worship','lesson','bible')
      AND EXTRACT(YEAR FROM e.attend_date)*100 + EXTRACT(MONTH FROM e.attend_date)
          BETWEEN p_year_from*100 + p_month_from AND p_year_to*100 + p_month_to
    GROUP BY r.id, r.rule_key
  )
  -- 시스템 키 결합
  SELECT
    r.id AS rule_id, r.rule_key, r.label, 'system' AS source,
    COALESCE(s.cnt, 0)::int AS count_hits,
    r.points AS per_hit,
    (COALESCE(s.cnt, 0)::int * r.points)::int AS total
  FROM public.edu_talent_rules r
  CROSS JOIN range_ok
  LEFT JOIN system_hits s ON s.rule_key = r.rule_key
  WHERE r.department_id = (SELECT department_id FROM dept)
    AND r.rule_kind = 'weekly'
    AND r.is_active = true
    AND r.rule_key IN ('attendance','prayer','church_school','worship','lesson','bible')

  UNION ALL

  SELECT
    r.id AS rule_id, r.rule_key, r.label, 'custom' AS source,
    COALESCE(c.cnt, 0)::int AS count_hits,
    r.points AS per_hit,
    (COALESCE(c.cnt, 0)::int * r.points)::int AS total
  FROM public.edu_talent_rules r
  CROSS JOIN range_ok
  LEFT JOIN custom_hits c ON c.rule_id = r.id
  WHERE r.department_id = (SELECT department_id FROM dept)
    AND r.rule_kind = 'weekly'
    AND r.is_active = true
    AND r.rule_key NOT IN ('attendance','prayer','church_school','worship','lesson','bible')

  ORDER BY source DESC, label;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_auto_talent(uuid, int, int, int, int) TO authenticated;
