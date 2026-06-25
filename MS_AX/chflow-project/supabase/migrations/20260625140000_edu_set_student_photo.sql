-- =============================================================
-- 교사/관리자가 학생(연결된 members) 프로필 사진을 등록·교체·삭제하는 RPC
-- 권한: 기존 edu_can_edit_student(dept, student) 재사용
--   - grade 0~2 (관리자/부장/총무/서기): 부서 내 전체 학생
--   - grade 3   (교사): 본인 담당 반 학생만
--   - grade 4/99: 불가
-- p_photo_url = NULL 이면 사진 제거(기본 얼굴로 복귀).
-- 사진 파일 자체는 member-photos 버킷에 업로드되어 있고, 여기서는 members.photo_url 만 갱신.
-- 재적용 안전(OR REPLACE).
-- =============================================================

CREATE OR REPLACE FUNCTION public.edu_set_student_photo(
  p_dept_id    uuid,
  p_student_id uuid,
  p_photo_url  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  IF NOT public.edu_can_edit_student(p_dept_id, p_student_id) THEN
    RAISE EXCEPTION '담당 반 학생만 수정할 수 있습니다';
  END IF;

  SELECT member_id INTO v_member_id
  FROM public.edu_students
  WHERE id = p_student_id AND department_id = p_dept_id;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION '연결된 성도 정보가 없어 사진을 저장할 수 없습니다';
  END IF;

  UPDATE public.members
  SET photo_url = NULLIF(p_photo_url, '')
  WHERE id = v_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.edu_set_student_photo(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edu_set_student_photo(uuid, uuid, text) TO authenticated;
