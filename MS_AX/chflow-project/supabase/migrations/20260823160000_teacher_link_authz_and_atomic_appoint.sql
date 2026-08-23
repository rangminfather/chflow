-- =============================================================
-- 교사 계정 연결 영역 마무리: 후보조회 권한 가드 + 임명·연결 원자화
--
-- (1) list_dept_eligible_for_teacher 정보노출
--     SECURITY DEFINER 인데 호출자 권한 검사가 없어 실측 결과 **anon(미로그인)까지**
--     임의 dept_id 의 승인 부서원 이름·등급을 조회할 수 있었다.
--     → 호출자 게이트 추가. 기준은 이미 이 영역에서 쓰는 표준인
--       public.get_user_grade(p_dept_id) <= 2 로, 반 관리 화면(teacher-assign)의
--       화면 게이트와 merge_placeholder_teacher 의 서버 게이트와 동일하다.
--       dept_mgmt_grade_ok(dept,'dept/members-grade') 는 쓰지 않는다 —
--       dept_menu_settings 에 해당 키가 없어 교육사역국 기본값이 grade 0 이고,
--       그러면 지금 화면을 쓰는 grade 1~2 임원이 후보 목록을 못 보게 된다.
--     반환 대상 필터(dm.status='approved')는 호출자 권한과 별개 조건으로 유지한다.
--     EXECUTE 도 PUBLIC/anon 에서 회수한다(이 RPC 는 로그인 전용 화면만 쓴다).
--
-- (2) edu_link_teacher_account 의 '부서원 행 없음 허용' 예외 제거
--     지금까지 이 함수는 임명 모달에서 admin_appoint_dept_member 보다 먼저
--     호출됐다. 그래서 '행 없음'을 허용해야 했고 승인 조건이 반쪽이었다.
--     → 임명과 연결을 admin_appoint_dept_member 안에서 한 트랜잭션으로 처리하도록
--       바꾸고(아래 3), 이 함수는 '해당 부서의 status=approved 부서원만' 이라는
--       단일 규칙으로 통일한다. 행 없음 / pending / rejected 는 모두 거부.
--
-- (3) admin_appoint_dept_member 에 p_link_placeholder_id 추가
--     임명(department_members approved 생성) → 교사 로스터 동기화 →
--     placeholder 연결 을 하나의 함수 = 하나의 트랜잭션으로 처리한다.
--     '임명 성공 + 연결 실패' 로 갈라지는 중간 상태가 생기지 않는다.
--     기존 4인자 시그니처는 정확히 지정해 DROP 한다(오버로드 중복 방지 —
--     20260823120000 에서 겪은 문제를 반복하지 않기 위함). 앱은 이름 인자로
--     호출하므로 5인자 하나만 남아도 기존 호출이 그대로 동작한다.
--     placeholder 가 다른 부서 것이면 거부한다(교차 부서 오연결 방지).
--
-- 권한 정책(get_user_grade / dept_mgmt_grade_ok, 임원진 0~2, 관리자 grade 0)은
-- 바꾸지 않는다. 함수 본문은 live pg_get_functiondef 를 옮기고 최소 조건만 더했다.
-- CASCADE 사용 없음.
-- =============================================================

-- (1) 후보 조회: 호출자 권한 가드 + 대상 승인 필터 유지 --------------
CREATE OR REPLACE FUNCTION public.list_dept_eligible_for_teacher(p_dept_id uuid)
RETURNS TABLE (
  user_id UUID,
  member_id UUID,
  name TEXT,
  grade SMALLINT,
  already_linked BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_grade smallint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;

  -- 호출자 권한: 반 관리 화면과 같은 기준(임원진 0~2, 시스템 관리자는 항상 0)
  v_caller_grade := public.get_user_grade(p_dept_id);
  IF v_caller_grade IS NULL OR v_caller_grade > 2 THEN
    RAISE EXCEPTION '권한 없음 (임원진 또는 관리자만 조회 가능)';
  END IF;

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
-- 로그인 전용 화면(반 관리)에서만 쓰는 RPC — PUBLIC/anon 실행 권한 회수
REVOKE ALL ON FUNCTION public.list_dept_eligible_for_teacher(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_dept_eligible_for_teacher(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_dept_eligible_for_teacher(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_dept_eligible_for_teacher(uuid) TO service_role;


-- (2) 연결: 승인된 부서원만 (행 없음도 거부) ------------------------
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
  IF v_app_user_id IS NULL THEN
    RAISE EXCEPTION '앱 가입을 하지 않은 성도입니다 (먼저 앱 가입 후 부서 가입 승인 필요)';
  END IF;

  -- 단일 규칙: 연결 대상은 이 부서의 status='approved' 부서원이어야 한다.
  -- (임명 흐름은 admin_appoint_dept_member 가 같은 트랜잭션에서 approved 를 먼저
  --  만든 뒤 이 함수를 호출하므로 여기서 예외를 둘 필요가 없다)
  SELECT dm.status INTO v_target_status
  FROM public.department_members dm
  WHERE dm.department_id = v_dept_id AND dm.user_id = v_app_user_id;

  IF v_target_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION '대상이 이 부서의 승인된 부서원이 아닙니다 (현재 %). 사역 가입 승인 또는 임명을 먼저 하세요.',
      coalesce(v_target_status, '미가입');
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


-- (3) 임명 + placeholder 연결을 한 트랜잭션으로 ---------------------
-- 기존 4인자 시그니처는 정확히 지정해 제거한다(오버로드 중복 방지)
DROP FUNCTION IF EXISTS public.admin_appoint_dept_member(uuid, uuid, smallint, text);

CREATE OR REPLACE FUNCTION public.admin_appoint_dept_member(
  p_dept_id             uuid,
  p_member_id           uuid,
  p_grade               smallint,
  p_teacher_role        text DEFAULT NULL,
  p_link_placeholder_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app_user_id   uuid;
  v_member_name   text;
  v_dept_name     text;
  v_dept_category text;
  v_dm_id         uuid;
  v_role_label    text;
  v_ph_dept       uuid;
BEGIN
  IF NOT public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') THEN
    RAISE EXCEPTION '임명 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  END IF;
  IF p_grade IS NULL OR p_grade < 0 OR p_grade > 4 THEN
    RAISE EXCEPTION 'grade는 0~4 이어야 합니다';
  END IF;

  -- 연결 대상 placeholder 가 지정됐으면 같은 부서 것인지 먼저 확인한다
  IF p_link_placeholder_id IS NOT NULL THEN
    SELECT department_id INTO v_ph_dept FROM public.edu_teachers WHERE id = p_link_placeholder_id;
    IF v_ph_dept IS NULL THEN
      RAISE EXCEPTION '연결할 교사 정보를 찾을 수 없습니다';
    END IF;
    IF v_ph_dept <> p_dept_id THEN
      RAISE EXCEPTION '연결할 교사가 다른 부서 소속입니다';
    END IF;
  END IF;

  SELECT m.app_user_id, m.name INTO v_app_user_id, v_member_name
  FROM public.members m WHERE m.id = p_member_id;

  IF v_member_name IS NULL THEN
    RAISE EXCEPTION '회원을 찾을 수 없습니다';
  END IF;
  IF v_app_user_id IS NULL THEN
    RAISE EXCEPTION '회원이 앱 가입을 하지 않은 상태입니다 (먼저 앱 가입 필요)';
  END IF;

  SELECT name, category INTO v_dept_name, v_dept_category
  FROM public.departments WHERE id = p_dept_id;

  -- 임명 화면에서 고른 직책이 있으면 그 값이 우선한다 (총무/서기 등)
  v_role_label := coalesce(
    nullif(trim(p_teacher_role), ''),
    public.edu_default_role_for_grade(p_grade)
  );

  INSERT INTO public.department_members (
    department_id, user_id, member_role, status, grade,
    requested_at, approved_at, approved_by
  ) VALUES (
    p_dept_id, v_app_user_id, v_role_label, 'approved', p_grade,
    now(), now(), auth.uid()
  )
  ON CONFLICT (department_id, user_id) DO UPDATE
    SET status      = 'approved',
        grade       = excluded.grade,
        member_role = excluded.member_role,
        approved_at = now(),
        approved_by = auth.uid()
  RETURNING id INTO v_dm_id;

  PERFORM public.edu_sync_roster_member(p_dept_id, v_app_user_id, p_member_id, p_grade, v_role_label);

  -- 같은 트랜잭션에서 기존 placeholder 기록을 이 계정으로 합친다.
  -- 위에서 approved 행이 이미 만들어졌으므로 edu_link_teacher_account 의
  -- '승인된 부서원만' 규칙을 그대로 통과한다. 실패하면 임명까지 함께 롤백된다.
  IF p_link_placeholder_id IS NOT NULL THEN
    PERFORM public.edu_link_teacher_account(p_link_placeholder_id, p_member_id);
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
  VALUES (
    v_app_user_id,
    'dept_appointed',
    '🎖️ 부서 임명',
    v_dept_category || ' ' || v_dept_name || ' ' || v_role_label || '(으)로 임명되셨습니다',
    '/departments/d/' || p_dept_id::text,
    auth.uid()
  );

  RETURN v_dm_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_appoint_dept_member(uuid, uuid, smallint, text, uuid) TO authenticated;


-- 사후 확인: 오버로드가 1개만 남았는지
DO $$
DECLARE v_cnt int; v_args text;
BEGIN
  SELECT count(*) INTO v_cnt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_appoint_dept_member';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '중단: admin_appoint_dept_member 오버로드가 %개다(1개여야 함)', v_cnt;
  END IF;
  SELECT pg_get_function_identity_arguments(p.oid) INTO v_args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_appoint_dept_member';
  RAISE NOTICE 'admin_appoint_dept_member 최종 시그니처: (%)', v_args;
END
$$;
