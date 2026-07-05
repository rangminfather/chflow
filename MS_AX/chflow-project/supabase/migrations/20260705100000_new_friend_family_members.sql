-- =============================================================
-- 새친구 등록카드 개선
--   1. family_members jsonb — 가족 여러 명 등록 [{name, relation, phone}, ...]
--   2. edu_save_new_friend — p_family_members 파라미터 추가
--      (기존 시그니처는 DROP — 오버로드 중의성 방지. update 시 NULL 이면 기존 값 보존)
--   3. edu_get_new_friend — family_members 반환
--   4. edu_list_students — class_no / grade_year 반환 추가
--      (인도자 선택 시 학년별 전체 학생 목록 표시용)
-- =============================================================

ALTER TABLE public.edu_new_friends
  ADD COLUMN IF NOT EXISTS family_members jsonb;

-- ─────────────────────────────────────────
-- 2. 저장 — 가족 목록 파라미터 추가
-- ─────────────────────────────────────────
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
      -- NULL 이면 기존 가족 목록 보존 (family 미지원 화면에서 저장해도 안 지워짐)
      family_members = COALESCE(p_family_members, family_members)
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
GRANT EXECUTE ON FUNCTION public.edu_save_new_friend(uuid,uuid,text,text,date,text,text,text,text,text,text,text,text,text,text,text,date,text,text,text,uuid,smallint,text,jsonb) TO authenticated;

-- ─────────────────────────────────────────
-- 3. 단건 조회 — family_members 반환
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
  created_at         timestamptz,
  family_members     jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.department_id, f.name, f.gender, f.birth_date, f.photo_url,
         f.phone, f.mobile, f.address, f.email,
         f.group_pa, f.group_jik, f.group_gun, f.group_cheo,
         f.family_name, f.guide_name, f.school_district,
         f.join_date, f.special_notes, f.memo,
         f.guide_kind, f.guide_student_id, gs.name AS guide_student_name,
         f.enroll_grade_year, f.enroll_class_no, f.student_id,
         f.promoted, f.promoted_at, f.created_at,
         f.family_members
  FROM public.edu_new_friends f
  LEFT JOIN public.edu_students gs ON gs.id = f.guide_student_id
  WHERE f.id = p_id
    AND public.is_edu_member_or_admin(f.department_id);
$$;
GRANT EXECUTE ON FUNCTION public.edu_get_new_friend(uuid) TO authenticated;

-- ─────────────────────────────────────────
-- 4. 학생 목록 — 반·학년 반환 (인도자 학년별 선택용)
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
  grade_year   smallint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id, s.student_no, s.name, s.student_type, s.grade, s.is_active, s.order_no,
    s.member_id, s.teacher_id,
    t.name AS teacher_name,
    s.class_no,
    s.grade_year
  FROM public.edu_students s
  LEFT JOIN public.edu_teachers t ON s.teacher_id = t.id
  WHERE s.department_id = p_dept_id
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY s.grade_year NULLS LAST, s.class_no, s.order_no, s.student_no, s.name;
$$;
GRANT EXECUTE ON FUNCTION public.edu_list_students(uuid) TO authenticated;
