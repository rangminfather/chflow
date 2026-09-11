-- 참여율 조사 — 저장된 날짜 목록 조회·삭제(리스트 관리)
--
-- 지금까지는 날짜 하나씩만 조회/저장했다(edu_participation_list 등). 여기서는
-- 그동안 저장된 날짜들을 한 번에 보여주고(불러오기는 기존 changeDate 그대로 재사용),
-- 잘못 만든 날짜를 통째로 지울 수 있는 삭제 기능을 추가한다.

-- ─────────────────────────────────────────
-- 조회: 저장된 날짜 목록 + 요약(참석·새친구·교사)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_participation_list_dates(p_dept_id uuid)
RETURNS TABLE (
  check_date       date,
  student_present  int,
  new_friend_total int,
  teacher_present  int,
  teacher_total    int,
  updated_at       timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;

  -- 주의: RETURNS TABLE의 출력 컬럼명(check_date 등)이 함수 본문 전체에서 변수처럼
  -- 보이기 때문에, 같은 이름의 테이블 컬럼은 반드시 테이블 별칭으로 한정해야 한다
  -- (그냥 "check_date"라고만 쓰면 "column reference is ambiguous" 오류가 난다).
  RETURN QUERY
  SELECT
    d.check_date,
    COALESCE(s.student_present, 0)::int,
    COALESCE(s.new_friend_total, 0)::int,
    COALESCE(t.teacher_present, 0)::int,
    COALESCE(t.teacher_total, 0)::int,
    GREATEST(COALESCE(s.updated_at, 'epoch'::timestamptz), COALESCE(t.updated_at, 'epoch'::timestamptz))
  FROM (
    SELECT c.check_date FROM public.edu_participation_checks c WHERE c.department_id = p_dept_id
    UNION
    SELECT tc.check_date FROM public.edu_participation_teacher_checks tc WHERE tc.department_id = p_dept_id
  ) d
  LEFT JOIN (
    SELECT
      c.check_date AS check_date,
      COUNT(*) FILTER (WHERE c.status = '참석') AS student_present,
      SUM(c.new_friend_male_count + c.new_friend_female_count) AS new_friend_total,
      MAX(c.updated_at) AS updated_at
    FROM public.edu_participation_checks c
    WHERE c.department_id = p_dept_id
    GROUP BY c.check_date
  ) s ON s.check_date = d.check_date
  LEFT JOIN (
    SELECT
      tc.check_date AS check_date,
      COUNT(*) FILTER (WHERE tc.status <> '') AS teacher_total,
      COUNT(*) FILTER (WHERE tc.status = '참석') AS teacher_present,
      MAX(tc.updated_at) AS updated_at
    FROM public.edu_participation_teacher_checks tc
    WHERE tc.department_id = p_dept_id
    GROUP BY tc.check_date
  ) t ON t.check_date = d.check_date
  ORDER BY d.check_date DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_list_dates(uuid) TO authenticated;

-- ─────────────────────────────────────────
-- 삭제: 그 날짜의 학생·교사 체크를 통째로 지운다 (되돌릴 수 없음 — 프런트에서 확인 필요)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_participation_delete_date(p_dept_id uuid, p_check_date date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;

  DELETE FROM public.edu_participation_checks
    WHERE department_id = p_dept_id AND check_date = p_check_date;
  DELETE FROM public.edu_participation_teacher_checks
    WHERE department_id = p_dept_id AND check_date = p_check_date;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_delete_date(uuid, date) TO authenticated;
