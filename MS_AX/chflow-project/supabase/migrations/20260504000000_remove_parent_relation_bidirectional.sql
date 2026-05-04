-- 부모-자녀 관계를 양쪽 부모(아버지+어머니)에서 한 번에 제거.
-- 사용 시나리오: 자녀 카드에서 부모 1명을 "제거" 했을 때, 다른쪽 부모 관계도 함께 끊는다.
-- p_role 이 명시되지 않으면 row 의 role 을 조회해서 반대 role 도 같이 제거.

DROP FUNCTION IF EXISTS public.remove_parent_relation_bidirectional(uuid, uuid);
CREATE OR REPLACE FUNCTION public.remove_parent_relation_bidirectional(
  p_child_id uuid,
  p_parent_id uuid
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role text;
  v_other_role text;
  v_count int := 0;
  v_n int;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  -- 제거 대상 부모의 role 확인
  SELECT role INTO v_role
  FROM public.member_relations
  WHERE subject_id = p_child_id AND relative_id = p_parent_id AND kind = 'parent'
  LIMIT 1;

  -- 1) 명시적으로 호출된 부모 row 제거
  DELETE FROM public.member_relations
  WHERE subject_id = p_child_id AND relative_id = p_parent_id AND kind = 'parent';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_count := v_count + v_n;

  -- 2) 반대 role 부모 row 도 함께 제거 (father <-> mother 만)
  v_other_role := CASE v_role
    WHEN 'father' THEN 'mother'
    WHEN 'mother' THEN 'father'
    ELSE NULL
  END;

  IF v_other_role IS NOT NULL THEN
    DELETE FROM public.member_relations
    WHERE subject_id = p_child_id AND kind = 'parent' AND role = v_other_role;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_count := v_count + v_n;
  END IF;

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.remove_parent_relation_bidirectional(uuid, uuid) TO authenticated;
