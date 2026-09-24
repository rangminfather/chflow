-- =============================================================
-- 장기결석(mgmt_status) 회귀 복구 + 행정관리용 처리/해제 RPC
-- 2026-09-21
--
-- 회귀: 20260705110000_school_absence_alerts.sql 가 edu_list_students 에
--   mgmt_status / school_name 을 추가했으나,
--   20260708182000_edu_student_photo_fallback.sql 가 photo_url 을 붙이면서
--   DROP 후 재생성할 때 그 두 컬럼을 빠뜨렸다.
--   그 결과 "내 반 출결"(my-class-attendance) 의
--   `s.mgmt_status !== '장기결석'` 필터가 undefined 비교가 되어 항상 참 →
--   장기결석 처리한 학생이 출석체크 명단에 그대로 노출됐다.
--   (school_name 도 같이 사라져 학생 부제에 학교명이 안 나왔다)
--
-- 조치 1: edu_list_students 에 mgmt_status / school_name 복원 (photo_url 유지).
-- 조치 2: edu_set_mgmt_status — 행정관리 '출결 통합 조회'에서 장기결석을
--   처리/해제하기 위한 RPC. 권한은 edu_can_edit_student 와 같은 등급 체계로
--   부서 임원 이상(grade 0~2)만 허용한다. 담임(3)은 기존처럼
--   담임메뉴 > 학생관리에서만 본인 반 학생을 처리한다.
--
-- 재적용 안전(OR REPLACE / DROP IF EXISTS).
-- =============================================================

-- ─────────────────────────────────────────
-- 1. 학생 목록 — mgmt_status / school_name 복원
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
  photo_url    text,
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
    s.photo_url,
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
-- 2. 장기결석 처리 / 해제 — 부서 임원 이상(grade 0~2)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_set_mgmt_status(
  p_dept_id    uuid,
  p_student_id uuid,
  p_status     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('정상', '장기결석') THEN
    RAISE EXCEPTION '허용되지 않는 관리 상태입니다';
  END IF;

  IF public.get_user_grade(p_dept_id) > 2 THEN
    RAISE EXCEPTION '부서 임원 이상만 장기결석을 처리할 수 있습니다';
  END IF;

  UPDATE public.edu_students
     SET mgmt_status = p_status
   WHERE id = p_student_id
     AND department_id = p_dept_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '학생을 찾을 수 없습니다';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_set_mgmt_status(uuid, uuid, text) TO authenticated;
