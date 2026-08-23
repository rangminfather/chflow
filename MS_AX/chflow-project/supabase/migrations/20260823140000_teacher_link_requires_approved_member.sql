-- =============================================================
-- 담임 계정 연결: 승인된 부서원만 대상이 되게 한다
--
-- 문제(2026-08-23 프로덕션 실측): department_members.grade 는 NOT NULL DEFAULT 3 이라
--   가입 신청만 해도(status='pending') grade 3 행이 즉시 생긴다. 그런데
--   list_dept_eligible_for_teacher 는 `dm.grade <= 3` 만 보고 status 를 보지 않아
--   pending/rejected 사용자가 담임 연결 후보로 노출됐다. 실측 결과 3개 상태
--   (pending/approved/rejected) 전부 후보에 뜨고 연결 RPC 두 개도 전부 허용됐다.
--   (운영 데이터에는 현재 status<>'approved' 행이 없어 실제 노출 사례는 없었다)
--
-- 목록 필터와 서버측 검증을 함께 넣는다. 목록에서만 숨기면 RPC 를 직접 호출해
--   우회할 수 있기 때문이다.
--
-- 1) list_dept_eligible_for_teacher : dm.status = 'approved' 추가.
--    grade 범위(<=3), 반환 컬럼, already_linked 계산, 정렬은 그대로 둔다.
--
-- 2) merge_placeholder_teacher      : 대상 user 가 그 부서의 approved 부서원인지 확인.
--    (반 관리 화면 경로. 후보가 위 목록에서 오므로 approved 강제가 맞다)
--
-- 3) edu_link_teacher_account       : 행이 있는데 approved 가 아닌 경우만 거부.
--    이 함수는 부서원관리 '임명' 모달에서 admin_appoint_dept_member 보다 **먼저**
--    호출된다(members-grade 화면). 그 시점엔 부서원 행이 아직 없는 것이 정상이고
--    직후 임명이 approved 행을 만든다. 그래서 '행 없음'은 허용하고 pending/rejected
--    만 막는다. approved 를 요구하면 정상 임명 흐름이 깨진다.
--
-- 권한 정책(get_user_grade / dept_mgmt_grade_ok, 임원진 0~2)은 바꾸지 않는다.
-- 본문의 나머지 로직은 live 정의(pg_get_functiondef)를 그대로 옮겼다.
-- =============================================================

-- 1) 후보 목록 ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_dept_eligible_for_teacher(p_dept_id uuid)
RETURNS TABLE (
  user_id UUID,
  member_id UUID,
  name TEXT,
  grade SMALLINT,
  already_linked BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS user_id,
    coalesce(mem.id, p.member_id) AS member_id,
    coalesce(mem.name, p.name)    AS name,
    dm.grade,
    EXISTS (
      SELECT 1
      FROM public.edu_teachers et
      LEFT JOIN public.members m2 ON m2.id = et.member_id
      WHERE et.department_id = p_dept_id
        AND coalesce(et.user_id, m2.app_user_id) = p.id
    ) AS already_linked
  FROM public.department_members dm
  JOIN public.profiles p ON p.id = dm.user_id
  LEFT JOIN public.members mem ON mem.app_user_id = p.id
  WHERE dm.department_id = p_dept_id
    AND dm.grade <= 3
    AND dm.status = 'approved'
  ORDER BY coalesce(mem.name, p.name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_dept_eligible_for_teacher(uuid) TO authenticated;


-- 2) 반 관리 화면의 placeholder 연결 -----------------------------
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
  v_target_status text;
  v_existing uuid;
  v_final uuid;
BEGIN
  SELECT department_id, name INTO v_dept_id, v_placeholder_name
  FROM public.edu_teachers WHERE id = p_placeholder_id;

  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION 'placeholder 없음';
  END IF;

  v_caller_grade := public.get_user_grade(v_dept_id);

  IF v_caller_grade IS NULL OR v_caller_grade > 2 THEN
    RAISE EXCEPTION '권한 없음 (임원진 또는 관리자만 가능)';
  END IF;

  -- 추가: 대상이 이 부서의 승인된 부서원인지 확인 (후보 목록 우회 호출 차단)
  SELECT dm.status INTO v_target_status
  FROM public.department_members dm
  WHERE dm.department_id = v_dept_id AND dm.user_id = p_target_user_id;

  IF v_target_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION '대상이 이 부서의 승인된 부서원이 아닙니다 (현재 %). 사역 가입 승인 또는 임명을 먼저 하세요.',
      coalesce(v_target_status, '미가입');
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


-- 3) 임명 직전 placeholder 연결 ----------------------------------
CREATE OR REPLACE FUNCTION public.edu_link_teacher_account(
  p_teacher_id uuid,
  p_member_id  uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dept_id uuid; v_user_id uuid; v_member_id uuid;
  v_name text; v_app_user_id uuid;
  v_caller_name text; v_existing uuid;
  v_target_status text;
BEGIN
  SELECT department_id, user_id, member_id INTO v_dept_id, v_user_id, v_member_id
  FROM public.edu_teachers WHERE id = p_teacher_id;
  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION '교사 정보 없음';
  END IF;
  IF NOT public.dept_mgmt_grade_ok(v_dept_id, 'dept/members-grade') THEN
    RAISE EXCEPTION '임명 권한이 없습니다';
  END IF;
  IF v_user_id IS NOT NULL OR v_member_id IS NOT NULL THEN
    RAISE EXCEPTION '이미 계정이 연결된 교사입니다';
  END IF;

  SELECT name, app_user_id INTO v_name, v_app_user_id
  FROM public.members WHERE id = p_member_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION '성도 정보 없음';
  END IF;

  -- 추가: pending/rejected 우회 차단.
  -- 임명(admin_appoint_dept_member) 직전에 호출되므로 부서원 행이 아직 없는 것이
  -- 정상이다 → '행 없음'은 통과, 행이 있는데 approved 가 아닐 때만 막는다.
  IF v_app_user_id IS NOT NULL THEN
    SELECT dm.status INTO v_target_status
    FROM public.department_members dm
    WHERE dm.department_id = v_dept_id AND dm.user_id = v_app_user_id;

    IF v_target_status IS NOT NULL AND v_target_status <> 'approved' THEN
      RAISE EXCEPTION '대상의 부서 가입 상태가 %입니다. 사역 가입 승인 후에 연결하세요.', v_target_status;
    END IF;
  END IF;

  -- 같은 성도의 교사 행이 이미 있으면 그쪽으로 이력을 합친다 (중복 identity 방지)
  SELECT t.id INTO v_existing FROM public.edu_teachers t
  WHERE t.department_id = v_dept_id AND t.member_id = p_member_id AND t.id <> p_teacher_id
  ORDER BY t.is_active DESC, t.created_at LIMIT 1;

  IF v_existing IS NOT NULL THEN
    PERFORM public.edu_merge_teacher_into(p_teacher_id, v_existing);
    UPDATE public.edu_teachers
    SET user_id = coalesce(v_app_user_id, user_id), name = v_name, is_active = true
    WHERE id = v_existing;
  ELSE
    UPDATE public.edu_teachers
    SET member_id = p_member_id,
        user_id   = v_app_user_id,
        name      = v_name,
        is_active = true
    WHERE id = p_teacher_id;
  END IF;

  SELECT name INTO v_caller_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.teacher_assignment_log (
    department_id, action_type, placeholder_id, real_member_id,
    new_teacher_id, new_teacher_name, changed_by, changed_by_name
  ) VALUES (
    v_dept_id, 'merge_placeholder', p_teacher_id, p_member_id,
    coalesce(v_existing, p_teacher_id), v_name, auth.uid(), v_caller_name
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_link_teacher_account(uuid, uuid) TO authenticated;
