-- 김찬규 집사 초등1부 교사 identity 정합성 복구.
-- 3-3반을 가진 기존 placeholder를 직책 변경 중 생성된 계정 연결 행으로 병합한다.
DO $$
DECLARE
  v_dept_id   uuid := '882ee0b6-af49-46bb-a077-682a9536cb76';
  v_source_id uuid := '6f07fc34-bd32-4117-98d4-bfb0761a503f';
  v_target_id uuid := '5ea966bb-d663-4c95-8c57-e96247631b68';
  v_member_id uuid := 'd04dc94e-932a-48a0-8ee8-7ce1efdb5af7';
  v_user_id   uuid := '9f52c279-34d3-45cc-88f3-8e770b654e57';
  v_source    public.edu_teachers;
  v_target    public.edu_teachers;
  v_moved     integer;
BEGIN
  SELECT * INTO v_target FROM public.edu_teachers WHERE id = v_target_id;
  IF v_target.id IS NULL
     OR v_target.department_id <> v_dept_id
     OR v_target.member_id <> v_member_id
     OR v_target.user_id <> v_user_id
     OR v_target.name <> '김찬규' THEN
    RAISE EXCEPTION '김찬규 계정 연결 교사 행이 예상 상태와 다릅니다';
  END IF;

  SELECT * INTO v_source FROM public.edu_teachers WHERE id = v_source_id;
  IF v_source.id IS NULL THEN
    RAISE NOTICE '김찬규 placeholder가 이미 병합되어 복구 작업을 건너뜁니다';
    RETURN;
  END IF;
  IF v_source.department_id <> v_dept_id
     OR v_source.member_id IS NOT NULL
     OR v_source.user_id IS NOT NULL
     OR v_source.name <> '김찬규' THEN
    RAISE EXCEPTION '김찬규 placeholder 행이 예상 상태와 다릅니다';
  END IF;

  v_moved := public.edu_merge_teacher_into(v_source_id, v_target_id);

  UPDATE public.edu_teachers t
  SET teacher_role = coalesce(dm.member_role, t.teacher_role),
      is_active = true
  FROM public.department_members dm
  WHERE t.id = v_target_id
    AND dm.department_id = v_dept_id
    AND dm.user_id = v_user_id
    AND dm.status = 'approved';

  INSERT INTO public.teacher_assignment_log (
    department_id, action_type, old_teacher_id, old_teacher_name,
    new_teacher_id, new_teacher_name, reason, changed_by_name
  ) VALUES (
    v_dept_id, 'merge_duplicate', v_source_id, '김찬규',
    v_target_id, '김찬규',
    '직책 변경 경로에서 생성된 교사 identity 중복 정합성 복구; 출석 이관 ' || v_moved || '건',
    '시스템 데이터 정합성 복구'
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.edu_classes
    WHERE department_id = v_dept_id
      AND class_no = '3-3'
      AND teacher_id = v_target_id
  ) THEN
    RAISE EXCEPTION '병합 후 초등1부 3-3반 담임 이관 검증 실패';
  END IF;
END
$$;
