-- =============================================================
-- 교육부서 교사 identity / 직책 소유권 정리
--
-- [데이터 모델 확정]
--   member_id = 성도(members) identity — 앱 미가입이어도 동일인 판별의 기준
--   user_id   = 앱 계정 연결 정보 — identity 를 대체하지 않는다
--   수동 교사 = member_id IS NULL AND user_id IS NULL
--   성도 교사 = member_id IS NOT NULL (user_id 는 있을 수도, 없을 수도 있다)
--   canonical = 같은 사람이 여러 행이면 member_id 를 가진 행이 canonical,
--               나머지 행의 출석·담임·반·진급이력을 canonical 로 이관 후 제거
--
-- [교사 출석 대상 규칙]
--   교육사역국 부서의 승인된 부서원 중 grade 0~3 (전도사·교육사 / 부장 /
--   부부장·총무·서기 / 교사) 이 교사 출석 대상이다. 학부모(grade 4)는 제외.
--   근거: list_dept_eligible_for_teacher 가 이미 grade <= 3 을 교사 후보로 본다.
--
-- [직책 해석 규칙] edu_resolve_role_label
--   1) 비어 있거나 레거시 라벨(member/teacher/leader/parent/…) → 등급 기본 직책
--   2) 사용자 지정 직책(예: '부감') → 그대로 보존 (임의로 지우지 않는다)
--   3) 같은 등급 tier 의 직책(부부장/총무/서기) → 그대로 보존  ← 총무·서기 손실 해결
--   4) 다른 tier 의 직책 → 등급 기본 직책으로 교체
--
-- 이 migration 은 함수 정의만 바꾼다. 기존 행 데이터는 UPDATE 하지 않는다.
-- =============================================================


-- ─────────────────────────────────────────
-- 1. 직책/등급 helper (순수 함수)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_role_grade(p_role text)
RETURNS smallint
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE nullif(trim(coalesce(p_role, '')), '')
    WHEN '전도사' THEN 0::smallint
    WHEN '교육사' THEN 0::smallint
    WHEN '부장'   THEN 1::smallint
    WHEN '부부장' THEN 2::smallint
    WHEN '총무'   THEN 2::smallint
    WHEN '서기'   THEN 2::smallint
    WHEN '교사'   THEN 3::smallint
    WHEN '학부모' THEN 4::smallint
    ELSE NULL::smallint
  END
$$;
GRANT EXECUTE ON FUNCTION public.edu_role_grade(text) TO authenticated;

-- 가입 신청 경로에서 들어온 레거시 라벨 — 등급 기본 직책으로 교체해도 되는 값
CREATE OR REPLACE FUNCTION public.edu_role_is_replaceable(p_role text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(trim(coalesce(p_role, '')), '') IS NULL
      OR lower(trim(p_role)) IN ('member', 'teacher', 'leader', 'parent', 'student', 'staff')
$$;
GRANT EXECUTE ON FUNCTION public.edu_role_is_replaceable(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.edu_default_role_for_grade(p_grade smallint)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_grade
    WHEN 0 THEN '전도사'
    WHEN 1 THEN '부장'
    WHEN 2 THEN '부부장'
    WHEN 3 THEN '교사'
    WHEN 4 THEN '학부모'
    ELSE '교사'
  END
$$;
GRANT EXECUTE ON FUNCTION public.edu_default_role_for_grade(smallint) TO authenticated;

CREATE OR REPLACE FUNCTION public.edu_resolve_role_label(p_grade smallint, p_current text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN public.edu_role_is_replaceable(p_current)          THEN public.edu_default_role_for_grade(p_grade)
    WHEN public.edu_role_grade(p_current) IS NULL           THEN trim(p_current)
    WHEN public.edu_role_grade(p_current) = p_grade         THEN trim(p_current)
    ELSE public.edu_default_role_for_grade(p_grade)
  END
$$;
GRANT EXECUTE ON FUNCTION public.edu_resolve_role_label(smallint, text) TO authenticated;

-- 교사 출석 대상 등급인지
CREATE OR REPLACE FUNCTION public.edu_is_roster_grade(p_grade smallint)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_grade IS NOT NULL AND p_grade >= 0 AND p_grade <= 3
$$;
GRANT EXECUTE ON FUNCTION public.edu_is_roster_grade(smallint) TO authenticated;

CREATE OR REPLACE FUNCTION public.edu_next_teacher_order(p_dept_id uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(max(order_no), -1) + 1
  FROM public.edu_teachers WHERE department_id = p_dept_id
$$;
-- 내부 helper — PostgreSQL 기본값인 PUBLIC EXECUTE 를 회수해 REST 로 직접 호출되지 않게 한다
REVOKE ALL ON FUNCTION public.edu_next_teacher_order(uuid) FROM PUBLIC;


-- ─────────────────────────────────────────
-- 2. teacher identity 병합 helper (내부용 — 호출자가 권한을 검사한다)
--    edu_teachers 를 참조하는 FK 4개를 모두 canonical 행으로 옮긴 뒤 원본을 제거한다.
--      edu_teacher_attendance.teacher_id  (ON DELETE CASCADE  ← 먼저 옮기지 않으면 소실)
--      edu_students.teacher_id            (ON DELETE SET NULL)
--      edu_student_history.teacher_id     (ON DELETE SET NULL)
--      edu_classes.teacher_id             (ON DELETE SET NULL) ← 기존 병합 RPC가 누락하던 것
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_merge_teacher_into(p_source_id uuid, p_target_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_moved integer := 0;
BEGIN
  IF p_source_id IS NULL OR p_target_id IS NULL OR p_source_id = p_target_id THEN
    RETURN 0;
  END IF;

  -- 출석: 대상에 같은 날짜 기록이 없을 때만 이동 (충돌 시 대상 기록 유지)
  UPDATE public.edu_teacher_attendance a
  SET teacher_id = p_target_id
  WHERE a.teacher_id = p_source_id
    AND NOT EXISTS (
      SELECT 1 FROM public.edu_teacher_attendance b
      WHERE b.teacher_id = p_target_id AND b.attend_date = a.attend_date
    );
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  UPDATE public.edu_students        SET teacher_id = p_target_id WHERE teacher_id = p_source_id;
  UPDATE public.edu_student_history SET teacher_id = p_target_id WHERE teacher_id = p_source_id;
  UPDATE public.edu_classes         SET teacher_id = p_target_id WHERE teacher_id = p_source_id;

  DELETE FROM public.edu_teachers WHERE id = p_source_id;
  RETURN v_moved;
END;
$$;
-- 권한 검사가 없는 내부 helper — 절대 클라이언트에서 직접 호출할 수 없어야 한다
REVOKE ALL ON FUNCTION public.edu_merge_teacher_into(uuid, uuid) FROM PUBLIC;


-- ─────────────────────────────────────────
-- 3. 성도 → 교사 로스터 동기화 helper (단일 진입점)
--    임명 / 등급변경 / 가입승인 이 모두 이 함수를 통해 edu_teachers 를 다룬다.
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_sync_roster_member(
  p_dept_id   uuid,
  p_user_id   uuid,
  p_member_id uuid,
  p_grade     smallint,
  p_role      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_category  text;
  v_name      text;
  v_cur_role  text;
  v_member_id uuid := p_member_id;
  v_by_member uuid;
  v_by_user   uuid;
  v_target    uuid;
BEGIN
  SELECT category INTO v_category FROM public.departments WHERE id = p_dept_id;
  IF v_category IS DISTINCT FROM '교육사역국' THEN
    RETURN NULL;              -- 교육사역국이 아니면 교사 로스터 자체가 없다
  END IF;

  -- 성도 identity 확보: member_id 우선, 없으면 members.app_user_id 로 역참조
  IF v_member_id IS NULL AND p_user_id IS NOT NULL THEN
    SELECT m.id INTO v_member_id FROM public.members m WHERE m.app_user_id = p_user_id LIMIT 1;
  END IF;

  IF v_member_id IS NOT NULL THEN
    SELECT m.name INTO v_name FROM public.members m WHERE m.id = v_member_id;
  END IF;
  IF v_name IS NULL AND p_user_id IS NOT NULL THEN
    SELECT pr.name INTO v_name FROM public.profiles pr WHERE pr.id = p_user_id;
  END IF;

  -- 기존 행 탐색 (성도 identity 우선)
  IF v_member_id IS NOT NULL THEN
    SELECT t.id INTO v_by_member FROM public.edu_teachers t
    WHERE t.department_id = p_dept_id AND t.member_id = v_member_id
    ORDER BY t.is_active DESC, t.created_at LIMIT 1;
  END IF;
  IF p_user_id IS NOT NULL THEN
    SELECT t.id INTO v_by_user FROM public.edu_teachers t
    WHERE t.department_id = p_dept_id AND t.user_id = p_user_id
      AND (v_by_member IS NULL OR t.id <> v_by_member)
    ORDER BY t.is_active DESC, t.created_at LIMIT 1;
  END IF;

  -- 같은 사람이 두 행으로 갈라져 있으면 성도 행을 canonical 로 병합
  IF v_by_member IS NOT NULL AND v_by_user IS NOT NULL THEN
    PERFORM public.edu_merge_teacher_into(v_by_user, v_by_member);
    v_by_user := NULL;
  END IF;
  v_target := coalesce(v_by_member, v_by_user);

  -- 교사 출석 대상이 아니면(학부모 등) 명단에서 내리되 출석 이력은 보존
  IF NOT public.edu_is_roster_grade(p_grade) THEN
    IF v_target IS NOT NULL THEN
      UPDATE public.edu_teachers SET is_active = false WHERE id = v_target;
    END IF;
    RETURN v_target;
  END IF;

  IF v_target IS NULL THEN
    INSERT INTO public.edu_teachers (
      department_id, member_id, user_id, name, teacher_role, order_no, is_active
    ) VALUES (
      p_dept_id, v_member_id, p_user_id, coalesce(v_name, '(이름없음)'),
      public.edu_resolve_role_label(p_grade, p_role),
      public.edu_next_teacher_order(p_dept_id), true
    )
    RETURNING id INTO v_target;
  ELSE
    SELECT t.teacher_role INTO v_cur_role FROM public.edu_teachers t WHERE t.id = v_target;
    UPDATE public.edu_teachers
    SET member_id    = coalesce(v_member_id, member_id),
        user_id      = coalesce(p_user_id, user_id),
        name         = coalesce(v_name, name),
        teacher_role = public.edu_resolve_role_label(
                         p_grade,
                         coalesce(nullif(trim(coalesce(p_role, '')), ''), v_cur_role)
                       ),
        is_active    = true
    WHERE id = v_target;
  END IF;

  RETURN v_target;
END;
$$;
-- 권한 검사가 없는 내부 helper — 호출자(임명/등급변경/가입승인)가 권한을 검사한다
REVOKE ALL ON FUNCTION public.edu_sync_roster_member(uuid, uuid, uuid, smallint, text) FROM PUBLIC;


-- ─────────────────────────────────────────
-- 4. 등급 변경 — member_role 도 직책 해석 규칙을 따른다 (총무·서기 보존)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_member_grade(p_dept_id uuid, p_user_id uuid, p_grade smallint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cur_role  text;
  v_role_label text;
  v_member_id uuid;
BEGIN
  IF p_grade < 0 OR p_grade > 4 THEN
    RAISE EXCEPTION 'grade must be 0~4';
  END IF;
  IF NOT public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') THEN
    RAISE EXCEPTION '부서원 등급 관리 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  END IF;

  SELECT dm.member_role INTO v_cur_role
  FROM public.department_members dm
  WHERE dm.department_id = p_dept_id AND dm.user_id = p_user_id;

  -- 같은 tier 안의 구체 직책(총무·서기)과 사용자 지정 직책은 등급만 바뀐다고 잃지 않는다
  v_role_label := public.edu_resolve_role_label(p_grade, v_cur_role);

  INSERT INTO public.department_members (
    department_id, user_id, member_role, status, grade,
    requested_at, approved_at, approved_by
  ) VALUES (
    p_dept_id, p_user_id, v_role_label, 'approved', p_grade,
    now(), now(), auth.uid()
  )
  ON CONFLICT (department_id, user_id) DO UPDATE
    SET grade       = excluded.grade,
        member_role = excluded.member_role,
        approved_at = now(),
        approved_by = auth.uid();

  SELECT m.id INTO v_member_id FROM public.members m WHERE m.app_user_id = p_user_id LIMIT 1;
  PERFORM public.edu_sync_roster_member(p_dept_id, p_user_id, v_member_id, p_grade, v_role_label);
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_member_grade(uuid, uuid, smallint) TO authenticated;


-- ─────────────────────────────────────────
-- 5. 임명 — edu_teachers 직접 조작 제거, helper 경유 (중복 행 자동 병합)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_appoint_dept_member(
  p_dept_id uuid, p_member_id uuid, p_grade smallint, p_teacher_role text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_app_user_id   uuid;
  v_member_name   text;
  v_dept_name     text;
  v_dept_category text;
  v_dm_id         uuid;
  v_role_label    text;
BEGIN
  IF NOT public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') THEN
    RAISE EXCEPTION '임명 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  END IF;
  IF p_grade IS NULL OR p_grade < 0 OR p_grade > 4 THEN
    RAISE EXCEPTION 'grade는 0~4 이어야 합니다';
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
GRANT EXECUTE ON FUNCTION public.admin_appoint_dept_member(uuid, uuid, smallint, text) TO authenticated;


-- ─────────────────────────────────────────
-- 6. 가입 승인 — 교육사역국 grade 0~3 이면 교사 로스터에 자동 연결
--    (중복 입력 없이 출석부에 바로 나타난다. 학부모(4)는 제외)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dept_leader_approve_join(
  p_join_id  uuid,
  p_approved boolean,
  p_grade    smallint DEFAULT 3
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dept_id        uuid;
  v_member_user_id uuid;
  v_dept_name      text;
  v_approver_grade smallint;
  v_cur_role       text;
  v_role_label     text;
  v_member_id      uuid;
BEGIN
  SELECT dm.department_id, dm.user_id, d.name, dm.member_role
  INTO v_dept_id, v_member_user_id, v_dept_name, v_cur_role
  FROM public.department_members dm
  JOIN public.departments d ON d.id = dm.department_id
  WHERE dm.id = p_join_id;

  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION '신청을 찾을 수 없습니다';
  END IF;

  v_approver_grade := public.get_user_grade(v_dept_id);
  IF v_approver_grade > 2 THEN
    RAISE EXCEPTION '권한 없음 (임원진 grade 0~2만 승인 가능)';
  END IF;

  IF p_approved THEN
    v_role_label := public.edu_resolve_role_label(p_grade, v_cur_role);

    UPDATE public.department_members
    SET status = 'approved', approved_at = now(), approved_by = auth.uid(),
        grade = p_grade, member_role = v_role_label
    WHERE id = p_join_id;

    SELECT m.id INTO v_member_id FROM public.members m WHERE m.app_user_id = v_member_user_id LIMIT 1;
    PERFORM public.edu_sync_roster_member(v_dept_id, v_member_user_id, v_member_id, p_grade, v_role_label);

    INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
    VALUES (
      v_member_user_id, 'dept_approved', '✅ 부서 가입 승인',
      v_dept_name || ' 가입이 승인되었습니다',
      '/home', auth.uid()
    );
  ELSE
    UPDATE public.department_members
    SET status = 'rejected', approved_at = now(), approved_by = auth.uid()
    WHERE id = p_join_id;

    INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
    VALUES (
      v_member_user_id, 'dept_rejected', '❌ 부서 가입 거절',
      v_dept_name || ' 가입 신청이 거절되었습니다',
      '/home', auth.uid()
    );
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dept_leader_approve_join(uuid, boolean, smallint) TO authenticated;


-- ─────────────────────────────────────────
-- 7. placeholder → 성도 연결 (임명 직전 경로)
--    이미 같은 성도의 교사 행이 있으면 그 행을 canonical 로 삼아 병합한다.
-- ─────────────────────────────────────────
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


-- ─────────────────────────────────────────
-- 8. 반 관리 화면의 placeholder 연결
--    기존 구현은 profiles.member_id 로 성도를 찾았다. 이 프로젝트의 identity 방향은
--    members.app_user_id = profiles.id 이고, 운영 데이터 확인 결과 profiles.member_id 는
--    일부만 채워져 있어(교육부서 대상 6/10) member_id 가 NULL 인 반쪽 연결이 생기고 있었다.
--    → members.app_user_id 를 1순위로 사용하고, profiles.member_id 는 보조 수단으로만 쓴다.
-- ─────────────────────────────────────────
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

  SELECT grade INTO v_caller_grade
  FROM public.department_members
  WHERE department_id = v_dept_id AND user_id = v_caller;

  IF v_caller_grade IS NULL OR v_caller_grade > 2 THEN
    RAISE EXCEPTION '권한 없음 (임원진만 가능)';
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


-- ─────────────────────────────────────────
-- 9. 중복 교사 병합 RPC — 공통 helper 사용 (edu_classes 이관 누락 수정)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_merge_duplicate_teacher(
  p_source_id uuid,
  p_target_id uuid,
  p_reason    text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src_dept uuid; v_tgt_dept uuid;
  v_src_name text; v_tgt_name text;
  v_moved integer;
  v_caller_name text;
BEGIN
  IF p_source_id = p_target_id THEN
    RAISE EXCEPTION '같은 교사끼리는 병합할 수 없습니다';
  END IF;
  SELECT department_id, name INTO v_src_dept, v_src_name FROM public.edu_teachers WHERE id = p_source_id;
  SELECT department_id, name INTO v_tgt_dept, v_tgt_name FROM public.edu_teachers WHERE id = p_target_id;
  IF v_src_dept IS NULL OR v_tgt_dept IS NULL THEN
    RAISE EXCEPTION '교사 정보 없음';
  END IF;
  IF v_src_dept <> v_tgt_dept THEN
    RAISE EXCEPTION '다른 부서의 교사는 병합할 수 없습니다';
  END IF;
  IF NOT public.is_edu_member_or_admin(v_src_dept) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  v_moved := public.edu_merge_teacher_into(p_source_id, p_target_id);

  SELECT name INTO v_caller_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.teacher_assignment_log (
    department_id, action_type, old_teacher_id, old_teacher_name,
    new_teacher_id, new_teacher_name, reason, changed_by, changed_by_name
  ) VALUES (
    v_src_dept, 'merge_duplicate', p_source_id, v_src_name,
    p_target_id, v_tgt_name, p_reason, auth.uid(), v_caller_name
  );

  RETURN v_moved;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_merge_duplicate_teacher(uuid, uuid, text) TO authenticated;


-- ─────────────────────────────────────────
-- 10. 부서원 목록 — 성도 identity 로 중복 제거
--     기존에는 user_id 로만 dm 을 매칭/제외해서, member_id 만 있고 user_id 가 NULL 인
--     교사가 부서원 행과 따로 두 줄로 보일 수 있었다.
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_dept_grade_members(p_dept_id uuid)
RETURNS TABLE(teacher_id uuid, user_id uuid, name text, role_label text, grade smallint, has_dm boolean, has_app boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') THEN
    RAISE EXCEPTION '부서원 등급 관리 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  END IF;

  RETURN QUERY
  SELECT * FROM (
    SELECT
      t.id                                                as teacher_id,
      coalesce(t.user_id, mem.app_user_id)                as user_id,
      t.name,
      coalesce(dm.member_role, t.teacher_role)::text      as role_label,
      coalesce(dm.grade, public.edu_role_grade(t.teacher_role), 3)::smallint as grade,
      (dm.id IS NOT NULL)                                 as has_dm,
      (coalesce(t.user_id, mem.app_user_id) IS NOT NULL)  as has_app
    FROM public.edu_teachers t
    LEFT JOIN public.members mem ON mem.id = t.member_id
    LEFT JOIN public.department_members dm
      ON  dm.department_id = p_dept_id
      AND dm.user_id       = coalesce(t.user_id, mem.app_user_id)
      AND dm.status        = 'approved'
    WHERE t.department_id = p_dept_id
      AND t.is_active     = true

    UNION ALL

    SELECT
      NULL::uuid                                          as teacher_id,
      dm.user_id,
      coalesce(mem.name, pr.name, u.email)::text          as name,
      dm.member_role::text                                as role_label,
      dm.grade::smallint,
      true                                                as has_dm,
      true                                                as has_app
    FROM public.department_members dm
    LEFT JOIN auth.users       u   ON u.id            = dm.user_id
    LEFT JOIN public.members   mem ON mem.app_user_id = dm.user_id
    LEFT JOIN public.profiles  pr  ON pr.id           = dm.user_id
    WHERE dm.department_id = p_dept_id
      AND dm.status        = 'approved'
      AND NOT EXISTS (
        SELECT 1
        FROM public.edu_teachers t2
        LEFT JOIN public.members m2 ON m2.id = t2.member_id
        WHERE t2.department_id = p_dept_id
          AND t2.is_active     = true
          AND coalesce(t2.user_id, m2.app_user_id) = dm.user_id
      )
  ) merged
  ORDER BY
    merged.has_app DESC,
    CASE merged.role_label
      WHEN '전도사' THEN 0
      WHEN '교육사' THEN 0
      WHEN '부장'   THEN 1
      WHEN '부부장' THEN 2
      WHEN '총무'   THEN 3
      WHEN '서기'   THEN 4
      WHEN '교사'   THEN 7
      WHEN '학부모' THEN 8
      ELSE 9
    END,
    merged.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_dept_grade_members(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 11. 수동 교사 저장 — order_no 를 넘기지 않으면 맨 뒤에 붙인다
--     (연결 교사 UPDATE 차단은 20260815090000 과 동일하게 유지)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_save_teacher(
  p_id          uuid,
  p_dept_id     uuid,
  p_name        text,
  p_role        text,
  p_order_no    int
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id        uuid;
  v_member_id uuid;
  v_user_id   uuid;
  v_dept_id   uuid;
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION '이름을 입력하세요';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.edu_teachers (department_id, name, teacher_role, order_no)
    VALUES (
      p_dept_id, trim(p_name), nullif(trim(coalesce(p_role, '')), ''),
      coalesce(p_order_no, public.edu_next_teacher_order(p_dept_id))
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT department_id, member_id, user_id
      INTO v_dept_id, v_member_id, v_user_id
    FROM public.edu_teachers
    WHERE id = p_id;

    IF v_dept_id IS NULL THEN
      RAISE EXCEPTION '교사 정보 없음';
    END IF;
    IF v_dept_id <> p_dept_id THEN
      RAISE EXCEPTION '다른 부서의 교사는 수정할 수 없습니다';
    END IF;
    IF v_member_id IS NOT NULL OR v_user_id IS NOT NULL THEN
      RAISE EXCEPTION '계정이 연결된 교사입니다. 이름·직책은 부서원관리에서 변경하세요';
    END IF;

    UPDATE public.edu_teachers
    SET name         = trim(p_name),
        teacher_role = nullif(trim(coalesce(p_role, '')), ''),
        order_no     = COALESCE(p_order_no, order_no)
    WHERE id = p_id AND department_id = p_dept_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_save_teacher(uuid, uuid, text, text, int) TO authenticated;


-- ─────────────────────────────────────────
-- 12. 교사 표시 순서 이동 (위/아래 한 칸)
--     이동 전에 활성 교사의 order_no 를 0..n-1 로 정규화해 값이 겹쳐도 안정적으로 동작한다.
--     teacher id / 출석 기록은 건드리지 않는다.
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_move_teacher(p_id uuid, p_dir int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dept_id uuid;
  v_active  boolean;
  v_pos     int;
  v_target  int;
  v_max     int;
BEGIN
  SELECT department_id, is_active INTO v_dept_id, v_active
  FROM public.edu_teachers WHERE id = p_id;
  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION '교사 정보 없음';
  END IF;
  IF NOT public.is_edu_member_or_admin(v_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION '삭제된 교사는 순서를 바꿀 수 없습니다';
  END IF;
  IF p_dir NOT IN (-1, 1) THEN
    RAISE EXCEPTION '이동 방향이 올바르지 않습니다';
  END IF;

  -- 정규화: 화면 정렬(order_no, name)과 같은 기준으로 0..n-1 재부여
  WITH ranked AS (
    SELECT t.id, (row_number() OVER (ORDER BY t.order_no, t.name) - 1)::int AS rn
    FROM public.edu_teachers t
    WHERE t.department_id = v_dept_id AND t.is_active = true
  )
  UPDATE public.edu_teachers t
  SET order_no = r.rn
  FROM ranked r
  WHERE t.id = r.id AND t.order_no IS DISTINCT FROM r.rn;

  SELECT count(*) - 1 INTO v_max
  FROM public.edu_teachers
  WHERE department_id = v_dept_id AND is_active = true;

  SELECT order_no INTO v_pos FROM public.edu_teachers WHERE id = p_id;
  v_target := v_pos + p_dir;
  IF v_target < 0 OR v_target > v_max THEN
    RETURN;                       -- 이미 맨 위/아래 — 조용히 무시
  END IF;

  UPDATE public.edu_teachers
  SET order_no = v_pos
  WHERE department_id = v_dept_id AND is_active = true AND order_no = v_target AND id <> p_id;

  UPDATE public.edu_teachers SET order_no = v_target WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_move_teacher(uuid, int) TO authenticated;


-- ─────────────────────────────────────────
-- 13. 교사 연결 후보 — already_linked 를 성도 identity 기준으로 판정
-- ─────────────────────────────────────────
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
  WHERE dm.department_id = p_dept_id AND dm.grade <= 3
  ORDER BY coalesce(mem.name, p.name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_dept_eligible_for_teacher(uuid) TO authenticated;
