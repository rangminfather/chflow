-- =============================================================
-- 우리반 아이정보 확장 + 장기 미출석 알림
--   1. edu_students.school_name — 학교 (새친구 등록 시 school_district 에서 복사)
--   2. edu_list_students — mgmt_status / school_name 반환 추가
--      (출석체크 화면에서 장기결석 제외 + 학교 표시용)
--   3. edu_save_new_friend — 편입 학생 레코드에 school_name 동기화
--   4. edu_emit_absence_alerts(p_week) — 2주 이상 '출' 없는 정상 학생을
--      담임 + 임원진(grade<=2)에게 주 1회 알림 (장기결석 처리 시 제외, cron 호출)
-- =============================================================

ALTER TABLE public.edu_students
  ADD COLUMN IF NOT EXISTS school_name text;

-- ─────────────────────────────────────────
-- 2. 학생 목록 — mgmt_status / school_name 추가
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
  teacher_name text,
  class_no     text,
  grade_year   smallint,
  mgmt_status  text,
  school_name  text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id, s.student_no, s.name, s.student_type, s.grade, s.is_active, s.order_no,
    s.member_id, s.teacher_id,
    t.name AS teacher_name,
    s.class_no,
    s.grade_year,
    s.mgmt_status,
    s.school_name
  FROM public.edu_students s
  LEFT JOIN public.edu_teachers t ON s.teacher_id = t.id
  WHERE s.department_id = p_dept_id
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY s.grade_year NULLS LAST, s.class_no, s.order_no, s.student_no, s.name;
$$;
GRANT EXECUTE ON FUNCTION public.edu_list_students(uuid) TO authenticated;

-- ─────────────────────────────────────────
-- 3. 새친구 저장 — 편입 학생에 school_name 동기화 (시그니처 동일, 본문만 교체)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_save_new_friend(
  p_id              uuid,
  p_dept_id         uuid,
  p_name            text,
  p_gender          text,
  p_birth_date      date,
  p_phone           text,
  p_mobile          text,
  p_address         text,
  p_email           text,
  p_group_pa        text,
  p_group_jik       text,
  p_group_gun       text,
  p_group_cheo      text,
  p_family_name     text,
  p_guide_name      text,
  p_school_dist     text,
  p_join_date       date,
  p_special         text,
  p_memo            text,
  p_guide_kind      text     DEFAULT 'other',
  p_guide_student_id uuid    DEFAULT NULL,
  p_enroll_grade_year smallint DEFAULT NULL,
  p_enroll_class_no text     DEFAULT NULL,
  p_family_members  jsonb    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id         uuid;
  v_student_id uuid;
  v_kind       text := COALESCE(NULLIF(trim(p_guide_kind), ''), 'other');
  v_guide_sid  uuid;
  v_guide_name text;
  v_class      text := NULLIF(trim(COALESCE(p_enroll_class_no, '')), '');
  v_school     text := NULLIF(trim(COALESCE(p_school_dist, '')), '');
  v_teacher_id uuid;
  v_no         int;
  v_order      int;
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF v_kind = 'student' AND p_guide_student_id IS NOT NULL THEN
    SELECT name INTO v_guide_name FROM public.edu_students
     WHERE id = p_guide_student_id AND department_id = p_dept_id;
    IF v_guide_name IS NULL THEN
      RAISE EXCEPTION '인도자 학생을 찾을 수 없습니다';
    END IF;
    v_guide_sid := p_guide_student_id;
  ELSIF v_kind = 'self' THEN
    v_guide_name := '자진';
  ELSE
    v_kind := 'other';
    v_guide_name := NULLIF(trim(COALESCE(p_guide_name, '')), '');
  END IF;

  IF v_class IS NOT NULL THEN
    SELECT teacher_id INTO v_teacher_id
      FROM public.edu_classes
     WHERE department_id = p_dept_id AND class_no = v_class;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.edu_new_friends (
      department_id, name, gender, birth_date, phone, mobile, address, email,
      group_pa, group_jik, group_gun, group_cheo, family_name, guide_name,
      school_district, join_date, special_notes, memo, created_by,
      guide_kind, guide_student_id, enroll_grade_year, enroll_class_no,
      family_members
    ) VALUES (
      p_dept_id, p_name, p_gender, p_birth_date, p_phone, p_mobile, p_address, p_email,
      p_group_pa, p_group_jik, p_group_gun, p_group_cheo, p_family_name, v_guide_name,
      p_school_dist, p_join_date, p_special, p_memo, auth.uid(),
      v_kind, v_guide_sid, p_enroll_grade_year, v_class,
      p_family_members
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.edu_new_friends SET
      name = p_name, gender = p_gender, birth_date = p_birth_date,
      phone = p_phone, mobile = p_mobile, address = p_address, email = p_email,
      group_pa = p_group_pa, group_jik = p_group_jik, group_gun = p_group_gun,
      group_cheo = p_group_cheo, family_name = p_family_name, guide_name = v_guide_name,
      school_district = p_school_dist, join_date = p_join_date,
      special_notes = p_special, memo = p_memo, updated_at = now(),
      guide_kind = v_kind, guide_student_id = v_guide_sid,
      enroll_grade_year = p_enroll_grade_year, enroll_class_no = v_class,
      family_members = COALESCE(p_family_members, family_members)
    WHERE id = p_id AND department_id = p_dept_id
    RETURNING id, student_id INTO v_id, v_student_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION '대상 새친구를 찾을 수 없습니다';
    END IF;
  END IF;

  IF v_student_id IS NULL THEN
    SELECT COALESCE(MAX(student_no), 0) + 1 INTO v_no    FROM public.edu_students WHERE department_id = p_dept_id;
    SELECT COALESCE(MAX(order_no), 0) + 1   INTO v_order FROM public.edu_students WHERE department_id = p_dept_id;
    INSERT INTO public.edu_students
      (department_id, student_no, name, student_type, grade_year, class_no, teacher_id, is_active, order_no, school_name)
    VALUES
      (p_dept_id, v_no, p_name, '체험', p_enroll_grade_year, v_class, v_teacher_id, true, v_order, v_school)
    RETURNING id INTO v_student_id;

    UPDATE public.edu_new_friends SET student_id = v_student_id WHERE id = v_id;
  ELSE
    UPDATE public.edu_students SET
      name        = p_name,
      grade_year  = COALESCE(p_enroll_grade_year, grade_year),
      class_no    = COALESCE(v_class, class_no),
      teacher_id  = COALESCE(v_teacher_id, teacher_id),
      school_name = COALESCE(v_school, school_name)
    WHERE id = v_student_id AND department_id = p_dept_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_save_new_friend(uuid,uuid,text,text,date,text,text,text,text,text,text,text,text,text,text,text,date,text,text,text,uuid,smallint,text,jsonb) TO authenticated;

-- ─────────────────────────────────────────
-- 4. 장기 미출석 알림 — 마지막 '출' 이 2주 이상 전인 정상 학생
--    p_week = 해당 주 토요일(KST). 담임 + 임원진(grade<=2)에게 주 1회(dedup).
--    장기결석(mgmt_status) 처리된 학생과 출석 기록이 아예 없는 학생은 제외.
-- ─────────────────────────────────────────
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
  FOR s IN
    SELECT st.id, st.department_id, st.name, st.teacher_id, la.last_att
    FROM public.edu_students st
    JOIN LATERAL (
      SELECT MAX(a.attend_date) AS last_att
      FROM public.edu_student_attendance a
      WHERE a.student_id = st.id AND a.attend_status = '출'
    ) la ON true
    WHERE st.is_active = true
      AND st.mgmt_status = '정상'
      AND la.last_att IS NOT NULL
      AND la.last_att <= p_week - 13   -- 지난 두 주일 연속 미출석
  LOOP
    v_weeks := GREATEST(2, FLOOR((p_week - s.last_att) / 7.0)::int);
    v_dedup := 'absence:' || s.id::text || ':' || to_char(p_week, 'YYYYMMDD');
    v_body  := COALESCE(s.name, '학생') || ' 학생이 ' || v_weeks || '주째 출석하지 않고 있어요. 연락이 필요합니다.';

    SELECT t.user_id INTO v_teacher_user FROM public.edu_teachers t WHERE t.id = s.teacher_id;
    IF v_teacher_user IS NOT NULL THEN
      PERFORM public._emit_promo_notif(
        v_teacher_user, 'edu_absence', '📭 장기 미출석', v_body,
        '/departments/d/' || s.department_id::text || '/my-class-attendance', v_dedup);
      v_sent := v_sent + 1;
    END IF;

    FOR r IN
      SELECT dm.user_id
      FROM public.department_members dm
      WHERE dm.department_id = s.department_id
        AND dm.status = 'approved'
        AND dm.grade <= 2
        AND dm.user_id IS NOT NULL
        AND dm.user_id IS DISTINCT FROM v_teacher_user
    LOOP
      PERFORM public._emit_promo_notif(
        r.user_id, 'edu_absence', '📭 장기 미출석', v_body,
        '/departments/d/' || s.department_id::text || '/attendance', v_dedup);
      v_sent := v_sent + 1;
    END LOOP;
  END LOOP;
  RETURN v_sent;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_emit_absence_alerts(date) TO service_role;
