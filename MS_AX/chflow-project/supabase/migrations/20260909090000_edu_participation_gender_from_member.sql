-- 참여율 조사 성별 통계가 0으로 나오던 원인 수정.
-- 학생 성별은 대부분 edu_students.gender 가 아니라 연결된 members.gender 에 있다
-- (초등1부 기준: 학생 40명 중 edu_students.gender 4명 / members.gender 39명).
-- 학생정보관리 화면과 같은 우선순위(members 우선 → edu_students 폴백)로 맞춘다.
-- 함수 본문만 교체하므로 저장된 출결·비고·새친구 데이터에는 영향이 없다.

CREATE OR REPLACE FUNCTION public.edu_participation_list(p_dept_id uuid, p_check_date date)
RETURNS TABLE (
  student_id            uuid,
  name                  text,
  class_no              text,
  grade_year            smallint,
  gender                text,
  teacher_name          text,
  status                text,
  note                  text,
  new_friend_male_count int,
  new_friend_female_count int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.name,
    s.class_no,
    s.grade_year,
    COALESCE(NULLIF(m.gender, ''), NULLIF(s.gender, ''))::text AS gender,
    t.name AS teacher_name,
    COALESCE(c.status, '')::text,
    c.note,
    COALESCE(c.new_friend_male_count, 0),
    COALESCE(c.new_friend_female_count, 0)
  FROM public.edu_students s
  LEFT JOIN public.members m ON m.id = s.member_id
  LEFT JOIN public.edu_teachers t ON t.id = s.teacher_id
  LEFT JOIN public.edu_participation_checks c
    ON c.student_id = s.id AND c.check_date = p_check_date
  WHERE s.department_id = p_dept_id
    AND s.is_active
  ORDER BY s.grade_year NULLS LAST, s.class_no, s.order_no, s.student_no, s.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_list(uuid, date) TO authenticated;
