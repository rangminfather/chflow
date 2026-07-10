-- =============================================================
-- 달란트 반기 리셋 (달란트 잔치 정산)
--   1. edu_talent_resets: 부서별 리셋 이력 (리셋일 이후 적립만 잔액·통계에 반영)
--   2. get_student_auto_talent_range(student, date_from, date_to)
--      — 날짜 범위 버전 자동적립 집계 (리셋일 경계가 월 중간이어도 정확)
--   3. get_student_auto_talent(월 단위) — range 버전을 호출하는 래퍼로 재정의
-- =============================================================

-- ─────────────────────────────────────────
-- 1. edu_talent_resets
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edu_talent_resets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  reset_date    date NOT NULL,
  note          text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_talent_resets_dept
  ON public.edu_talent_resets(department_id, reset_date DESC);

ALTER TABLE public.edu_talent_resets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "talent_resets_rls" ON public.edu_talent_resets;
CREATE POLICY "talent_resets_rls" ON public.edu_talent_resets
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));


-- ─────────────────────────────────────────
-- 2. 날짜 범위 버전 자동적립 집계
--    (20260625160000 get_student_auto_talent와 동일 로직, 경계만 date)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_student_auto_talent_range(uuid, date, date);
CREATE OR REPLACE FUNCTION public.get_student_auto_talent_range(
  p_student_id uuid,
  p_date_from  date,
  p_date_to    date
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
        AND a.attend_date BETWEEN p_date_from AND p_date_to
        AND a.attend_status = '출'
    UNION ALL
    SELECT 'prayer',         COUNT(*) FROM public.edu_student_attendance a
      WHERE a.student_id = p_student_id
        AND a.attend_date BETWEEN p_date_from AND p_date_to
        AND a.had_prayer = true
    UNION ALL
    SELECT 'church_school',  COUNT(*) FROM public.edu_student_attendance a
      WHERE a.student_id = p_student_id
        AND a.attend_date BETWEEN p_date_from AND p_date_to
        AND a.had_church_sch = true
    UNION ALL
    SELECT 'worship',        COUNT(*) FROM public.edu_student_attendance a
      WHERE a.student_id = p_student_id
        AND a.attend_date BETWEEN p_date_from AND p_date_to
        AND a.had_worship = true
    UNION ALL
    SELECT 'lesson',         COUNT(*) FROM public.edu_student_attendance a
      WHERE a.student_id = p_student_id
        AND a.attend_date BETWEEN p_date_from AND p_date_to
        AND a.had_lesson = true
    UNION ALL
    SELECT 'bible',          COUNT(*) FROM public.edu_student_attendance a
      WHERE a.student_id = p_student_id
        AND a.attend_date BETWEEN p_date_from AND p_date_to
        AND a.had_bible = true
  ),
  -- Custom weekly extra (자동행 + 새친구등반 제외)
  custom_hits AS (
    SELECT r.id AS rule_id, r.rule_key, COUNT(*)::int AS cnt
    FROM public.edu_weekly_extra e
    JOIN public.edu_talent_rules r ON r.id = e.rule_id
    WHERE e.student_id = p_student_id
      AND e.checked = true
      AND r.rule_kind = 'weekly'
      AND r.rule_key NOT IN ('attendance','prayer','church_school','worship','lesson','bible','new_friend_promotion')
      AND e.attend_date BETWEEN p_date_from AND p_date_to
    GROUP BY r.id, r.rule_key
  ),
  -- 새친구등반: 이 학생이 인도자(guide)인, 확정(promoted)된 등반 건수
  promo_hits AS (
    SELECT COUNT(*)::int AS cnt
    FROM public.edu_new_friends nf
    WHERE nf.guide_student_id = p_student_id
      AND nf.promoted = true
      AND nf.promoted_at IS NOT NULL
      AND nf.promoted_at::date BETWEEN p_date_from AND p_date_to
  )
  -- 시스템 키
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

  -- Custom weekly (새친구등반 제외)
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
    AND r.rule_key NOT IN ('attendance','prayer','church_school','worship','lesson','bible','new_friend_promotion')

  UNION ALL

  -- 새친구등반 (인도자 자동 적립)
  SELECT
    r.id AS rule_id, r.rule_key, r.label, 'promotion' AS source,
    COALESCE(p.cnt, 0)::int AS count_hits,
    r.points AS per_hit,
    (COALESCE(p.cnt, 0)::int * r.points)::int AS total
  FROM public.edu_talent_rules r
  CROSS JOIN range_ok
  LEFT JOIN promo_hits p ON true
  WHERE r.department_id = (SELECT department_id FROM dept)
    AND r.rule_kind = 'weekly'
    AND r.is_active = true
    AND r.rule_key = 'new_friend_promotion'

  ORDER BY source DESC, label;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_auto_talent_range(uuid, date, date) TO authenticated;


-- ─────────────────────────────────────────
-- 3. 월 단위 버전은 range 래퍼로 재정의 (로직 단일화, 동작 동일)
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
  SELECT * FROM public.get_student_auto_talent_range(
    p_student_id,
    make_date(p_year_from, p_month_from, 1),
    (make_date(p_year_to, p_month_to, 1) + interval '1 month' - interval '1 day')::date
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_student_auto_talent(uuid, int, int, int, int) TO authenticated;
