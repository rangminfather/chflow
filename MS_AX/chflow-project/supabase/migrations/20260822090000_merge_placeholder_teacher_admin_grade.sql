-- =============================================================
-- merge_placeholder_teacher: 권한 판정을 get_user_grade 로 통일
--
-- 문제(2026-08-22 실측): 이 함수만 department_members.grade 를 직접 읽어서
--   시스템 role(admin/office/pastor)을 인정하지 않았다. 그 결과 부서 소속이 없는
--   관리자가 '사역 가입 승인'은 성공하는데(dept_leader_approve_join → get_user_grade)
--   같은 흐름의 마지막 단계인 '담임 계정 연결'은 "권한 없음 (임원진만 가능)"으로
--   막혀, 관리자가 대신 처리해 줄 수 없었다.
--
-- 정책 기준은 20260711150000_get_user_grade_admin_priority: admin/office/pastor 는
--   부서 임명과 무관하게 항상 grade 0. 같은 계정 연결 경로인
--   edu_link_teacher_account 는 dept_mgmt_grade_ok(→ get_user_grade)를 쓰므로
--   이 함수만 예외였다.
--
-- 변경: 권한 블록만 get_user_grade(v_dept_id) 로 교체. 임원진 0~2 기준은 그대로라
--   일반 임원의 동작은 종전과 동일하다. 나머지 본문은 손대지 않았다.
--
-- 남은 동일 패턴(이 마이그레이션 범위 아님): set_class_homeroom_teacher,
--   add_dept_class, rename_dept_class, delete_dept_class 등 반 관리 계열 함수들도
--   department_members.grade 를 직접 읽는다. 필요하면 별도로 정리한다.
-- =============================================================

CREATE OR REPLACE FUNCTION public.merge_placeholder_teacher(
  p_placeholder_id uuid,
  p_target_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_grade smallint;
  v_caller_name text;
  v_dept_id uuid;
  v_placeholder_name text;
  v_target_member_id uuid;
  v_target_name text;
  v_existing uuid;
  v_final uuid;
BEGIN
  SELECT department_id, name INTO v_dept_id, v_placeholder_name
  FROM public.edu_teachers WHERE id = p_placeholder_id;

  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION 'placeholder 없음';
  END IF;

  -- 변경 지점: 부서 등급과 시스템 role 을 함께 보는 단일 정책 함수를 쓴다
  v_caller_grade := public.get_user_grade(v_dept_id);

  IF v_caller_grade IS NULL OR v_caller_grade > 2 THEN
    RAISE EXCEPTION '권한 없음 (임원진 또는 관리자만 가능)';
  END IF;

  SELECT name INTO v_caller_name FROM public.profiles WHERE id = v_caller;

  -- 성도 identity: members.app_user_id 우선, 없으면 profiles.member_id 보조
  SELECT m.id, m.name INTO v_target_member_id, v_target_name
  FROM public.members m WHERE m.app_user_id = p_target_user_id LIMIT 1;

  IF v_target_member_id IS NULL THEN
    SELECT p.member_id INTO v_target_member_id FROM public.profiles p WHERE p.id = p_target_user_id;
    IF v_target_member_id IS NOT NULL THEN
      SELECT m.name INTO v_target_name FROM public.members m WHERE m.id = v_target_member_id;
    END IF;
  END IF;

  IF v_target_name IS NULL THEN
    SELECT p.name INTO v_target_name FROM public.profiles p WHERE p.id = p_target_user_id;
  END IF;

  IF v_target_name IS NULL THEN
    RAISE EXCEPTION '대상 사용자 없음';
  END IF;

  -- 같은 사람의 교사 행이 이미 있으면 그 행이 canonical
  IF v_target_member_id IS NOT NULL THEN
    SELECT t.id INTO v_existing FROM public.edu_teachers t
    WHERE t.department_id = v_dept_id AND t.member_id = v_target_member_id AND t.id <> p_placeholder_id
    ORDER BY t.is_active DESC, t.created_at LIMIT 1;
  END IF;
  IF v_existing IS NULL THEN
    SELECT t.id INTO v_existing FROM public.edu_teachers t
    WHERE t.department_id = v_dept_id AND t.user_id = p_target_user_id AND t.id <> p_placeholder_id
    ORDER BY t.is_active DESC, t.created_at LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    PERFORM public.edu_merge_teacher_into(p_placeholder_id, v_existing);
    UPDATE public.edu_teachers
    SET member_id = coalesce(v_target_member_id, member_id),
        user_id   = coalesce(p_target_user_id, user_id),
        name      = v_target_name,
        is_active = true
    WHERE id = v_existing;
    v_final := v_existing;
  ELSE
    UPDATE public.edu_teachers
    SET user_id   = p_target_user_id,
        member_id = coalesce(v_target_member_id, member_id),
        name      = v_target_name,
        is_active = true
    WHERE id = p_placeholder_id;
    v_final := p_placeholder_id;
  END IF;

  INSERT INTO public.teacher_assignment_log (
    department_id, action_type, placeholder_id, real_member_id,
    new_teacher_id, new_teacher_name, reason, changed_by, changed_by_name
  ) VALUES (
    v_dept_id, 'merge_placeholder', p_placeholder_id, v_target_member_id,
    v_final, v_target_name, p_reason, v_caller, v_caller_name
  );

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.merge_placeholder_teacher(uuid, uuid, text) TO authenticated;
