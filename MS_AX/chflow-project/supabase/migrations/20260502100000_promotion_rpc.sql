-- =============================================================
-- 매년 진급 RPC
--   1. promote_preview(p_dept_id) — Step 1 미리보기 (학년 +1, 졸업 분리)
--   2. promote_finalize(p_dept_id, p_year, p_assignments) — Step 5 확정
--      • 이력 INSERT
--      • 졸업자: department_id 변경(next_dept_id) 또는 비활성
--      • 재학자: grade_year/class_no/teacher_id 갱신
--      • 다음 부서 부장에게 알림
--   3. list_dept_classes(p_dept_id) — 학년별 반 목록 (UI용)
-- =============================================================

-- ─────────────────────────────────────────
-- 1. 미리보기
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.promote_preview(uuid);
CREATE OR REPLACE FUNCTION public.promote_preview(p_dept_id uuid)
RETURNS TABLE (
  student_id      uuid,
  member_id       uuid,
  name            text,
  current_grade   smallint,
  current_class   text,
  next_grade      smallint,
  will_graduate   boolean,
  next_dept_id    uuid,
  next_dept_name  text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max_year smallint;
  v_next_id  uuid;
BEGIN
  IF NOT public.can_appoint_in_dept(p_dept_id) THEN
    RAISE EXCEPTION '진급 권한이 없습니다 (요구: 부서 grade 0~1 또는 시스템 관리자)';
  END IF;

  SELECT d.grade_year_max, d.next_dept_id INTO v_max_year, v_next_id
  FROM public.departments d WHERE d.id = p_dept_id;

  RETURN QUERY
  SELECT
    s.id AS student_id,
    s.member_id,
    s.name,
    s.grade_year AS current_grade,
    s.class_no   AS current_class,
    (s.grade_year + 1)::smallint AS next_grade,
    (v_max_year IS NOT NULL AND s.grade_year >= v_max_year) AS will_graduate,
    v_next_id AS next_dept_id,
    (SELECT d2.name FROM public.departments d2 WHERE d2.id = v_next_id) AS next_dept_name
  FROM public.edu_students s
  WHERE s.department_id = p_dept_id
    AND s.is_active = true
  ORDER BY s.grade_year, s.class_no, s.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.promote_preview(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 2. 학년별 반 목록 (학년 +1 적용 후 반 편성용)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.list_dept_classes(uuid);
CREATE OR REPLACE FUNCTION public.list_dept_classes(p_dept_id uuid)
RETURNS TABLE (
  grade_year smallint,
  class_no   text,
  cnt        bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.grade_year, s.class_no, COUNT(*) AS cnt
  FROM public.edu_students s
  WHERE s.department_id = p_dept_id
    AND s.is_active = true
    AND public.is_edu_member_or_admin(p_dept_id)
  GROUP BY s.grade_year, s.class_no
  ORDER BY s.grade_year, s.class_no NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION public.list_dept_classes(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 3. 진급 확정
--    p_year: 진급 직전(스냅샷할) 연도 — 예: 2026 (2026년도 → 2027년도 진급)
--    p_assignments JSONB:
--      [{
--        "student_id": "uuid",
--        "new_class_no": "1-1" | null,  -- 신학년 반
--        "new_teacher_id": "uuid" | null
--      }, ...]
--    졸업자(will_graduate=true)는 p_assignments에 안 넣어도 자동 처리
--    배정 안 된 재학자는 grade_year +1만 되고 class_no=NULL, teacher_id=NULL (미배정)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.promote_finalize(uuid, smallint, jsonb);
CREATE OR REPLACE FUNCTION public.promote_finalize(
  p_dept_id     uuid,
  p_year        smallint,
  p_assignments jsonb
)
RETURNS TABLE (
  promoted_cnt  int,
  graduated_cnt int,
  history_cnt   int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dept_name     text;
  v_max_year      smallint;
  v_next_dept_id  uuid;
  v_next_dept_name text;
  v_promoted      int := 0;
  v_graduated     int := 0;
  v_history       int := 0;
  v_admin_id      uuid;
  rec             record;
  v_assignment    jsonb;
  v_new_class     text;
  v_new_teacher   uuid;
BEGIN
  IF NOT public.can_appoint_in_dept(p_dept_id) THEN
    RAISE EXCEPTION '진급 권한이 없습니다';
  END IF;
  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
    RAISE EXCEPTION 'p_year 가 유효하지 않습니다';
  END IF;

  SELECT d.name, d.grade_year_max, d.next_dept_id INTO v_dept_name, v_max_year, v_next_dept_id
  FROM public.departments d WHERE d.id = p_dept_id;

  IF v_next_dept_id IS NOT NULL THEN
    SELECT name INTO v_next_dept_name FROM public.departments WHERE id = v_next_dept_id;
  END IF;

  -- 모든 활성 학생을 순회하며 처리
  FOR rec IN
    SELECT s.id, s.member_id, s.name, s.grade_year, s.class_no, s.teacher_id,
           t.name AS teacher_name
    FROM public.edu_students s
    LEFT JOIN public.edu_teachers t ON s.teacher_id = t.id
    WHERE s.department_id = p_dept_id AND s.is_active = true
  LOOP
    -- 이력 저장 (진급 전 상태 = p_year 한 해 동안의 상태)
    INSERT INTO public.edu_student_history (
      year, student_id, member_id, member_name,
      department_id, department_name,
      grade_year, class_no, teacher_id, teacher_name,
      status
    ) VALUES (
      p_year, rec.id, rec.member_id, rec.name,
      p_dept_id, v_dept_name,
      rec.grade_year, rec.class_no, rec.teacher_id, rec.teacher_name,
      CASE
        WHEN v_max_year IS NOT NULL AND rec.grade_year >= v_max_year THEN
          CASE WHEN v_next_dept_id IS NOT NULL THEN '전출' ELSE '졸업' END
        ELSE '재학'
      END
    )
    ON CONFLICT (year, student_id) DO UPDATE SET
      grade_year = EXCLUDED.grade_year,
      class_no = EXCLUDED.class_no,
      teacher_id = EXCLUDED.teacher_id,
      teacher_name = EXCLUDED.teacher_name,
      status = EXCLUDED.status;
    v_history := v_history + 1;

    -- 졸업/전출 처리
    IF v_max_year IS NOT NULL AND rec.grade_year >= v_max_year THEN
      IF v_next_dept_id IS NOT NULL THEN
        -- 다음 부서로 이동: department_id 변경 + grade_year +1, 반/담임 초기화
        UPDATE public.edu_students
          SET department_id = v_next_dept_id,
              grade_year    = (rec.grade_year + 1)::smallint,
              class_no      = NULL,
              teacher_id    = NULL,
              grade         = ((rec.grade_year + 1)::text || '학년 미배정'),
              order_no      = 0
          WHERE id = rec.id;
        v_graduated := v_graduated + 1;
      ELSE
        -- 졸업 보관 (다음 부서 미정)
        UPDATE public.edu_students
          SET is_active = false,
              grade_year = (rec.grade_year + 1)::smallint,
              class_no   = NULL,
              teacher_id = NULL,
              grade      = ('졸업 ' || (p_year + 1)::text)
          WHERE id = rec.id;
        v_graduated := v_graduated + 1;
      END IF;
    ELSE
      -- 재학자: 학년 +1, 새 반/담임 적용 (assignments에 있으면)
      v_assignment := NULL;
      IF p_assignments IS NOT NULL THEN
        SELECT a INTO v_assignment FROM jsonb_array_elements(p_assignments) a
          WHERE a->>'student_id' = rec.id::text LIMIT 1;
      END IF;

      v_new_class   := COALESCE(v_assignment->>'new_class_no', NULL);
      v_new_teacher := CASE WHEN v_assignment ? 'new_teacher_id' AND v_assignment->>'new_teacher_id' <> ''
                            THEN (v_assignment->>'new_teacher_id')::uuid
                            ELSE NULL END;

      UPDATE public.edu_students
        SET grade_year = (rec.grade_year + 1)::smallint,
            class_no   = v_new_class,
            teacher_id = v_new_teacher,
            grade      = ((rec.grade_year + 1)::text || '학년 ' || COALESCE(v_new_class || '반', '미배정'))
        WHERE id = rec.id;
      v_promoted := v_promoted + 1;
    END IF;
  END LOOP;

  -- 다음 부서 부장(grade<=1)에게 알림 (전출 발생 시만)
  IF v_graduated > 0 AND v_next_dept_id IS NOT NULL THEN
    FOR v_admin_id IN
      SELECT user_id FROM public.department_members
      WHERE department_id = v_next_dept_id AND status='approved' AND grade <= 1
    LOOP
      INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
      VALUES (
        v_admin_id,
        'dept_promotion_in',
        '🎓 신입 학생 도착',
        v_dept_name || '에서 ' || v_graduated::text || '명이 ' || v_next_dept_name || '으로 진급했습니다',
        '/departments/d/' || v_next_dept_id::text,
        auth.uid()
      );
    END LOOP;
  END IF;

  RETURN QUERY SELECT v_promoted, v_graduated, v_history;
END;
$$;
GRANT EXECUTE ON FUNCTION public.promote_finalize(uuid, smallint, jsonb) TO authenticated;
