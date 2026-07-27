-- Fix school absence alerts:
-- 1. Count attendance recognition ('인') as a positive attendance signal.
-- 2. Keep teacher alerts per student, but collapse executive alerts into one
--    weekly department summary per recipient.
-- 3. Keep the existing conservative behavior of excluding students with no
--    positive attendance history, so imported or unrecorded rosters do not
--    flood executives.

DROP FUNCTION IF EXISTS public.edu_emit_absence_alerts(date);
CREATE OR REPLACE FUNCTION public.edu_emit_absence_alerts(p_week date)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s              record;
  r              record;
  v_teacher_user uuid;
  v_dedup        text;
  v_body         text;
  v_weeks        int;
  v_sent         int := 0;
BEGIN
  -- Individual alert to each homeroom teacher.
  FOR s IN
    SELECT st.id, st.department_id, st.name, st.teacher_id, la.last_att
    FROM public.edu_students st
    JOIN LATERAL (
      SELECT MAX(a.attend_date) AS last_att
      FROM public.edu_student_attendance a
      WHERE a.student_id = st.id
        AND a.attend_status IN ('출', '인')
    ) la ON true
    WHERE st.is_active = true
      AND st.mgmt_status = '정상'
      AND la.last_att IS NOT NULL
      AND la.last_att <= p_week - 13
  LOOP
    v_weeks := GREATEST(2, FLOOR((p_week - s.last_att) / 7.0)::int);
    v_dedup := 'absence_teacher:' || s.id::text || ':' || to_char(p_week, 'YYYYMMDD');
    v_body  := COALESCE(s.name, '학생') || ' 학생이 ' || v_weeks || '주째 출석하지 않고 있어요. 연락이 필요합니다.';

    SELECT t.user_id INTO v_teacher_user FROM public.edu_teachers t WHERE t.id = s.teacher_id;
    IF v_teacher_user IS NOT NULL THEN
      PERFORM public._emit_promo_notif(
        v_teacher_user, 'edu_absence', '장기 미출석', v_body,
        '/departments/d/' || s.department_id::text || '/my-class-attendance', v_dedup);
      v_sent := v_sent + 1;
    END IF;
  END LOOP;

  -- One weekly summary per executive recipient, per department.
  FOR r IN
    WITH candidates AS (
      SELECT st.id, st.department_id, st.name, st.teacher_id, la.last_att
      FROM public.edu_students st
      JOIN LATERAL (
        SELECT MAX(a.attend_date) AS last_att
        FROM public.edu_student_attendance a
        WHERE a.student_id = st.id
          AND a.attend_status IN ('출', '인')
      ) la ON true
      WHERE st.is_active = true
        AND st.mgmt_status = '정상'
        AND la.last_att IS NOT NULL
        AND la.last_att <= p_week - 13
    ),
    teacher_users AS (
      SELECT c.id AS student_id, t.user_id
      FROM candidates c
      LEFT JOIN public.edu_teachers t ON t.id = c.teacher_id
    )
    SELECT
      c.department_id,
      dm.user_id,
      COUNT(*)::int AS student_count,
      STRING_AGG(c.name, ', ' ORDER BY c.name) AS student_names
    FROM candidates c
    JOIN public.department_members dm
      ON dm.department_id = c.department_id
     AND dm.status = 'approved'
     AND dm.grade <= 2
     AND dm.user_id IS NOT NULL
    LEFT JOIN teacher_users tu
      ON tu.student_id = c.id
    WHERE dm.user_id IS DISTINCT FROM tu.user_id
    GROUP BY c.department_id, dm.user_id
  LOOP
    v_dedup := 'absence_exec_summary:' || r.department_id::text || ':' || to_char(p_week, 'YYYYMMDD');
    v_body := CASE
      WHEN r.student_count = 1 THEN r.student_names || ' 학생이 2주 이상 출석하지 않고 있어요.'
      ELSE r.student_count::text || '명의 학생이 2주 이상 출석하지 않고 있어요: ' || r.student_names
    END;

    PERFORM public._emit_promo_notif(
      r.user_id, 'edu_absence', '장기 미출석 요약', v_body,
      '/departments/d/' || r.department_id::text || '/attendance', v_dedup);
    v_sent := v_sent + 1;
  END LOOP;

  RETURN v_sent;
END;
$$;

GRANT EXECUTE ON FUNCTION public.edu_emit_absence_alerts(date) TO service_role;
