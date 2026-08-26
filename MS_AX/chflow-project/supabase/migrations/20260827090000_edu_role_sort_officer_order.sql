-- =============================================================
-- 임원진 표시 순서 확정 (사용자 지정, 2026-08-27)
--
--   전도사 > 교육사 > 부장 > 부부장 > 총무 > 부총무 > 서기 > 회계 > 부서기 > 부회계
--   > 기타(직접입력) > 교사 > 학부모
--
-- 교사·학부모 자리는 부서원관리(임명·등급 조정) 화면의 정렬용이다.
-- 부서원에게 보이는 '부서 구성원' 명단은 임원진(grade 0~2)과 반별 담임만 싣는다 —
-- 학부모(grade 4)는 그 명단 어디에도 나오지 않는다.
--
-- 20260825220000 의 edu_role_sort 는 서기·부서기·회계·부회계 순이었다.
-- 부서 구성원 화면(department-members)과 부서원관리 화면(list_dept_grade_members)이
-- 같은 순서로 보이도록 DB 정렬도 같은 순서로 맞춘다.
-- 프론트 대응: chflow-app/lib/deptRoles.ts 의 ROLE_DISPLAY_ORDER
--
-- 이 migration 은 edu_role_sort 함수 본문만 교체한다 (행 데이터·다른 함수 변경 없음).
-- list_dept_grade_members 는 이 함수를 호출하므로 재정의 없이 새 순서를 따른다.
-- =============================================================

CREATE OR REPLACE FUNCTION public.edu_role_sort(p_role text)
RETURNS smallint
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE nullif(trim(coalesce(p_role, '')), '')
    WHEN '전도사' THEN 0::smallint
    WHEN '교육사' THEN 1::smallint
    WHEN '부장'   THEN 2::smallint
    WHEN '부부장' THEN 3::smallint
    WHEN '총무'   THEN 4::smallint
    WHEN '부총무' THEN 5::smallint
    WHEN '서기'   THEN 6::smallint
    WHEN '회계'   THEN 7::smallint
    WHEN '부서기' THEN 8::smallint
    WHEN '부회계' THEN 9::smallint
    WHEN '교사'   THEN 20::smallint
    WHEN '학부모' THEN 30::smallint
    ELSE 25::smallint          -- 직접입력·레거시 직책: 표준 직책 뒤, 학부모 앞
  END
$$;
GRANT EXECUTE ON FUNCTION public.edu_role_sort(text) TO authenticated;

-- 사후 확인: 새 순서가 실제로 적용됐는지
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(r.role || '=' || public.edu_role_sort(r.role), ', ' ORDER BY r.ord)
  INTO v_bad
  FROM (VALUES
    ('전도사', 0), ('교육사', 1), ('부장', 2), ('부부장', 3), ('총무', 4),
    ('부총무', 5), ('서기', 6), ('회계', 7), ('부서기', 8), ('부회계', 9)
  ) AS r(role, ord)
  WHERE public.edu_role_sort(r.role) <> r.ord;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '중단: edu_role_sort 순서가 기대와 다르다 — %', v_bad;
  END IF;
  RAISE NOTICE 'edu_role_sort 임원진 순서 확인 완료';
END
$$;
