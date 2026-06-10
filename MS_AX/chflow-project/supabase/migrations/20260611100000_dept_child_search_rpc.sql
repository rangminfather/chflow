-- =============================================================
-- 학부모 자녀 자동 매칭 + 이름 검색 RPC (개인정보 보호)
-- =============================================================

-- 1. 자동 매칭: 현재 사용자의 member_relations(parent)에서
--    해당 부서의 edu_students 연결
DROP FUNCTION IF EXISTS public.dept_match_children_for_parent(uuid);
CREATE OR REPLACE FUNCTION public.dept_match_children_for_parent(p_dept_id uuid)
RETURNS TABLE (
  id           uuid,
  student_no   int,
  name         text,
  grade        text,
  teacher_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- auth.uid() → members(app_user_id) → member_relations(relative_id=me, kind='parent')
  -- → subject_id(자녀) → edu_students(member_id)
  SELECT s.id, s.student_no, s.name, s.grade, t.name AS teacher_name
  FROM public.members me
  JOIN public.member_relations mr
    ON mr.relative_id = me.id AND mr.kind = 'parent'
  JOIN public.edu_students s
    ON s.member_id = mr.subject_id
  LEFT JOIN public.edu_teachers t ON s.teacher_id = t.id
  WHERE me.app_user_id = auth.uid()
    AND s.department_id = p_dept_id
    AND s.is_active = true
  ORDER BY s.grade, s.order_no, s.student_no, s.name;
$$;
GRANT EXECUTE ON FUNCTION public.dept_match_children_for_parent(uuid) TO authenticated;


-- 2. 이름 검색: 2자 이상 입력 시에만 동작 (전체 목록 노출 방지)
DROP FUNCTION IF EXISTS public.dept_search_children(uuid, text);
CREATE OR REPLACE FUNCTION public.dept_search_children(p_dept_id uuid, p_query text)
RETURNS TABLE (
  id           uuid,
  student_no   int,
  name         text,
  grade        text,
  teacher_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF length(trim(p_query)) < 2 THEN
    RAISE EXCEPTION '검색어는 2자 이상 입력해 주세요';
  END IF;

  RETURN QUERY
  SELECT s.id, s.student_no, s.name, s.grade, t.name AS teacher_name
  FROM public.edu_students s
  LEFT JOIN public.edu_teachers t ON s.teacher_id = t.id
  WHERE s.department_id = p_dept_id
    AND s.is_active = true
    AND s.name LIKE '%' || trim(p_query) || '%'
  ORDER BY s.grade, s.order_no, s.student_no, s.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dept_search_children(uuid, text) TO authenticated;
