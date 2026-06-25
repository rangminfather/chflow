-- =============================================================
-- Phase C: 새친구 등반 반자동
--   1. edu_new_friends 확장
--      - 인도자 선택형: guide_kind('student'|'self'|'other') + guide_student_id
--      - 반 편입: enroll_grade_year / enroll_class_no / student_id(편입 학생 레코드)
--      - 등반 상태: promoted / promoted_at
--   2. edu_save_new_friend 갱신 (신규 파라미터 + 등록 즉시 '체험' 학생 편입)
--   3. edu_list_new_friends / edu_get_new_friend 갱신 (신규 컬럼 반환)
--   4. edu_pending_promotions(dept) — 4회 이상 출석 & 미등반 새친구 (담임·인도자 포함)
--   5. edu_confirm_promotion(new_friend_id) — 체험→정 승격 (멱등)
--   6. get_student_auto_talent — 새친구등반(+5)을 "확정된 등반의 인도자 학생"에게 자동 적립
--
--   설계 메모:
--   - "편입" = 등록 즉시 edu_students 에 student_type='체험' 학생 레코드 생성 → 출석부/통장 노출
--   - "등반" = 체험→정 승격 (4회 '출' 출석 자동감지 → 담임이 통장에서 '등반 확정')
--   - 새친구등반 +5 는 인도자(guide_student_id) 학생에게 지급. 자진/기타(어른)는 지급 대상 없음.
--     지급은 promoted=true 인 등반 건수 기반 집계 (한 인도자 다건 등반도 정확히 누적, 이중지급 없음)
--   - 등반 임계치(4회)는 '출' 상태만 카운트 (타교회 '인'은 제외 — 기존 정책과 동일)
--   - new_friend_promotion 은 더 이상 수동 주간체크 칩이 아님 (통장 UI에서 제외, 자동집계로 일원화)
-- =============================================================

-- ─────────────────────────────────────────
-- 1. 컬럼 추가
-- ─────────────────────────────────────────
ALTER TABLE public.edu_new_friends
  ADD COLUMN IF NOT EXISTS guide_kind        text
    CHECK (guide_kind IS NULL OR guide_kind IN ('student','self','other')),
  ADD COLUMN IF NOT EXISTS guide_student_id  uuid REFERENCES public.edu_students(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enroll_grade_year smallint,
  ADD COLUMN IF NOT EXISTS enroll_class_no   text,
  ADD COLUMN IF NOT EXISTS student_id        uuid REFERENCES public.edu_students(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promoted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_by       uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_edu_new_friends_student ON public.edu_new_friends(student_id);
CREATE INDEX IF NOT EXISTS idx_edu_new_friends_guide
  ON public.edu_new_friends(guide_student_id) WHERE guide_student_id IS NOT NULL;

-- 기존 행: 인도자 텍스트가 있으면 'other'(어른 이름)로 간주
UPDATE public.edu_new_friends
   SET guide_kind = 'other'
 WHERE guide_kind IS NULL
   AND COALESCE(trim(guide_name), '') <> '';


-- ─────────────────────────────────────────
-- 2. [새친구] 저장 — 신규 파라미터 + 등록 즉시 '체험' 학생 편입
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_save_new_friend(uuid, uuid, text, text, date, text, text, text, text, text, text, text, text, text, text, text, date, text, text);
DROP FUNCTION IF EXISTS public.edu_save_new_friend(uuid, uuid, text, text, date, text, text, text, text, text, text, text, text, text, text, text, date, text, text, text, uuid, smallint, text);
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
  p_enroll_class_no text     DEFAULT NULL
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
  v_teacher_id uuid;
  v_no         int;
  v_order      int;
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  -- 인도자 정규화: student → 학생ID + 학생명 / self → '자진' / other → 입력 텍스트
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

  -- 편입 반의 담임(레지스트리에 있으면 자동 연결)
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
      guide_kind, guide_student_id, enroll_grade_year, enroll_class_no
    ) VALUES (
      p_dept_id, p_name, p_gender, p_birth_date, p_phone, p_mobile, p_address, p_email,
      p_group_pa, p_group_jik, p_group_gun, p_group_cheo, p_family_name, v_guide_name,
      p_school_dist, p_join_date, p_special, p_memo, auth.uid(),
      v_kind, v_guide_sid, p_enroll_grade_year, v_class
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
      enroll_grade_year = p_enroll_grade_year, enroll_class_no = v_class
    WHERE id = p_id AND department_id = p_dept_id
    RETURNING id, student_id INTO v_id, v_student_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION '대상 새친구를 찾을 수 없습니다';
    END IF;
  END IF;

  -- 등록 즉시 '체험' 학생으로 편입 (출석부·통장 노출). 이미 연결돼 있으면 동기화.
  IF v_student_id IS NULL THEN
    SELECT COALESCE(MAX(student_no), 0) + 1 INTO v_no    FROM public.edu_students WHERE department_id = p_dept_id;
    SELECT COALESCE(MAX(order_no), 0) + 1   INTO v_order FROM public.edu_students WHERE department_id = p_dept_id;
    INSERT INTO public.edu_students
      (department_id, student_no, name, student_type, grade_year, class_no, teacher_id, is_active, order_no)
    VALUES
      (p_dept_id, v_no, p_name, '체험', p_enroll_grade_year, v_class, v_teacher_id, true, v_order)
    RETURNING id INTO v_student_id;

    UPDATE public.edu_new_friends SET student_id = v_student_id WHERE id = v_id;
  ELSE
    -- 등반된 '정' 학생도 이름·반·학년은 갱신하되 student_type 은 보존
    UPDATE public.edu_students SET
      name       = p_name,
      grade_year = COALESCE(p_enroll_grade_year, grade_year),
      class_no   = COALESCE(v_class, class_no),
      teacher_id = COALESCE(v_teacher_id, teacher_id)
    WHERE id = v_student_id AND department_id = p_dept_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_save_new_friend(uuid,uuid,text,text,date,text,text,text,text,text,text,text,text,text,text,text,date,text,text,text,uuid,smallint,text) TO authenticated;


-- ─────────────────────────────────────────
-- 3a. [새친구] 목록 — 신규 컬럼 + 인도자 표시명
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_list_new_friends(uuid);
CREATE OR REPLACE FUNCTION public.edu_list_new_friends(p_dept_id uuid)
RETURNS TABLE (
  id              uuid,
  name            text,
  gender          text,
  birth_date      date,
  mobile          text,
  join_date       date,
  guide_name      text,
  guide_kind      text,
  guide_display   text,
  enroll_class_no text,
  student_id      uuid,
  promoted        boolean,
  created_at      timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    f.id, f.name, f.gender, f.birth_date, f.mobile, f.join_date, f.guide_name,
    f.guide_kind,
    CASE
      WHEN f.guide_kind = 'self'    THEN '자진'
      WHEN f.guide_kind = 'student' THEN COALESCE(gs.name, '(삭제된 학생)')
      ELSE NULLIF(trim(COALESCE(f.guide_name, '')), '')
    END AS guide_display,
    f.enroll_class_no, f.student_id, f.promoted, f.created_at
  FROM public.edu_new_friends f
  LEFT JOIN public.edu_students gs ON gs.id = f.guide_student_id
  WHERE f.department_id = p_dept_id
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY f.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.edu_list_new_friends(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 3b. [새친구] 단건 조회 — 신규 컬럼
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_get_new_friend(uuid);
CREATE OR REPLACE FUNCTION public.edu_get_new_friend(p_id uuid)
RETURNS TABLE (
  id                 uuid,
  department_id      uuid,
  name               text,
  gender             text,
  birth_date         date,
  photo_url          text,
  phone              text,
  mobile             text,
  address            text,
  email              text,
  group_pa           text,
  group_jik          text,
  group_gun          text,
  group_cheo         text,
  family_name        text,
  guide_name         text,
  school_district    text,
  join_date          date,
  special_notes      text,
  memo               text,
  guide_kind         text,
  guide_student_id   uuid,
  guide_student_name text,
  enroll_grade_year  smallint,
  enroll_class_no    text,
  student_id         uuid,
  promoted           boolean,
  promoted_at        timestamptz,
  created_at         timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.department_id, f.name, f.gender, f.birth_date, f.photo_url,
         f.phone, f.mobile, f.address, f.email,
         f.group_pa, f.group_jik, f.group_gun, f.group_cheo,
         f.family_name, f.guide_name, f.school_district,
         f.join_date, f.special_notes, f.memo,
         f.guide_kind, f.guide_student_id, gs.name AS guide_student_name,
         f.enroll_grade_year, f.enroll_class_no, f.student_id,
         f.promoted, f.promoted_at, f.created_at
  FROM public.edu_new_friends f
  LEFT JOIN public.edu_students gs ON gs.id = f.guide_student_id
  WHERE f.id = p_id
    AND public.is_edu_member_or_admin(f.department_id);
$$;
GRANT EXECUTE ON FUNCTION public.edu_get_new_friend(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 4. 등반 대기 목록 — 편입 학생이 '출' 4회 이상 & 아직 미등반
--    (담임 teacher_id, 인도자 표시명 포함 → 통장 배너에서 내 반만 필터·표시)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_pending_promotions(uuid);
CREATE OR REPLACE FUNCTION public.edu_pending_promotions(p_dept_id uuid)
RETURNS TABLE (
  new_friend_id      uuid,
  student_id         uuid,
  name               text,
  class_no           text,
  grade_year         smallint,
  teacher_id         uuid,
  attend_count       int,
  guide_kind         text,
  guide_student_id   uuid,
  guide_student_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    f.id           AS new_friend_id,
    f.student_id,
    s.name,
    s.class_no,
    s.grade_year,
    s.teacher_id,
    cnt.c::int     AS attend_count,
    f.guide_kind,
    f.guide_student_id,
    gs.name        AS guide_student_name
  FROM public.edu_new_friends f
  JOIN public.edu_students s ON s.id = f.student_id AND s.is_active = true
  LEFT JOIN public.edu_students gs ON gs.id = f.guide_student_id
  JOIN LATERAL (
    SELECT COUNT(*) AS c
    FROM public.edu_student_attendance a
    WHERE a.student_id = f.student_id AND a.attend_status = '출'
  ) cnt ON true
  WHERE f.department_id = p_dept_id
    AND f.promoted = false
    AND cnt.c >= 4
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY cnt.c DESC, s.name;
$$;
GRANT EXECUTE ON FUNCTION public.edu_pending_promotions(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 5. 등반 확정 (멱등) — 체험→정 승격. +5 적립은 6번 자동집계가 담당.
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_confirm_promotion(uuid);
CREATE OR REPLACE FUNCTION public.edu_confirm_promotion(p_new_friend_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dept     uuid;
  v_student  uuid;
  v_promoted boolean;
BEGIN
  SELECT department_id, student_id, promoted
    INTO v_dept, v_student, v_promoted
  FROM public.edu_new_friends WHERE id = p_new_friend_id;

  IF v_dept IS NULL THEN RAISE EXCEPTION '새친구를 찾을 수 없습니다'; END IF;
  IF NOT public.is_edu_member_or_admin(v_dept) THEN RAISE EXCEPTION '권한이 없습니다'; END IF;
  IF v_student IS NULL THEN RAISE EXCEPTION '편입된 학생이 없습니다'; END IF;
  IF v_promoted THEN RETURN; END IF;   -- 멱등: 이미 등반 확정 시 무시

  -- 체험 → 정
  UPDATE public.edu_students SET student_type = '정'
   WHERE id = v_student AND department_id = v_dept;

  UPDATE public.edu_new_friends
     SET promoted = true, promoted_at = now(), promoted_by = auth.uid()
   WHERE id = p_new_friend_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_confirm_promotion(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 6. get_student_auto_talent 재작성
--    새친구등반(new_friend_promotion)은 주간체크(edu_weekly_extra)가 아니라
--    "이 학생이 인도자(guide)인, 확정(promoted)된 등반 건수 × 규칙점수"로 자동 적립.
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
  -- Custom weekly extra (자동행 + 새친구등반 제외)
  custom_hits AS (
    SELECT r.id AS rule_id, r.rule_key, COUNT(*)::int AS cnt
    FROM public.edu_weekly_extra e
    JOIN public.edu_talent_rules r ON r.id = e.rule_id
    WHERE e.student_id = p_student_id
      AND e.checked = true
      AND r.rule_kind = 'weekly'
      AND r.rule_key NOT IN ('attendance','prayer','church_school','worship','lesson','bible','new_friend_promotion')
      AND EXTRACT(YEAR FROM e.attend_date)*100 + EXTRACT(MONTH FROM e.attend_date)
          BETWEEN p_year_from*100 + p_month_from AND p_year_to*100 + p_month_to
    GROUP BY r.id, r.rule_key
  ),
  -- 새친구등반: 이 학생이 인도자(guide)인, 확정(promoted)된 등반 건수
  promo_hits AS (
    SELECT COUNT(*)::int AS cnt
    FROM public.edu_new_friends nf
    WHERE nf.guide_student_id = p_student_id
      AND nf.promoted = true
      AND nf.promoted_at IS NOT NULL
      AND EXTRACT(YEAR FROM nf.promoted_at)*100 + EXTRACT(MONTH FROM nf.promoted_at)
          BETWEEN p_year_from*100 + p_month_from AND p_year_to*100 + p_month_to
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
GRANT EXECUTE ON FUNCTION public.get_student_auto_talent(uuid, int, int, int, int) TO authenticated;
