-- =============================================================
-- 기존 부서원 직책 변경 시 미연결 교사 중복 생성 방지
--
-- 원인:
--   신규 임명(admin_appoint_dept_member)은 같은 이름의 placeholder를 골라
--   원자적으로 연결할 수 있지만, 기존 부서원의 직책 변경(upsert_member_grade)은
--   그 입력을 받지 않았다. 그 결과 edu_sync_roster_member가 계정 연결 교사 행을
--   새로 만들고 기존 placeholder는 담임/출석을 가진 채 남을 수 있었다.
--
-- 조치:
--   1) 직책 변경도 p_link_placeholder_id를 받아 같은 트랜잭션에서 병합한다.
--   2) 같은 이름의 활성 placeholder가 있는데 연결 여부를 명시하지 않으면
--      서버가 저장을 거부한다. 동명이인은 p_allow_duplicate=true를 명시해야 한다.
-- =============================================================

DROP FUNCTION IF EXISTS public.upsert_member_grade(uuid, uuid, smallint, text);

CREATE OR REPLACE FUNCTION public.upsert_member_grade(
  p_dept_id             uuid,
  p_user_id             uuid,
  p_grade               smallint,
  p_role                text DEFAULT NULL,
  p_link_placeholder_id uuid DEFAULT NULL,
  p_allow_duplicate     boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req_role          text := nullif(trim(coalesce(p_role, '')), '');
  v_grade             smallint;
  v_cur_role          text;
  v_role_label        text;
  v_member_id         uuid;
  v_member_name       text;
  v_placeholder_dept  uuid;
  v_placeholder_member uuid;
  v_placeholder_user  uuid;
  v_placeholder_active boolean;
  v_same_name_count   integer := 0;
BEGIN
  IF NOT public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') THEN
    RAISE EXCEPTION '부서원 등급 관리 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  END IF;

  v_grade := coalesce(public.edu_role_grade(v_req_role), p_grade);
  IF v_grade IS NULL OR v_grade < 0 OR v_grade > 4 THEN
    RAISE EXCEPTION 'grade must be 0~4';
  END IF;

  IF v_req_role IS NOT NULL THEN
    IF char_length(v_req_role) > 20 THEN
      RAISE EXCEPTION '직책은 20자 이내로 입력해 주세요';
    END IF;
    v_role_label := v_req_role;
  ELSE
    SELECT dm.member_role INTO v_cur_role
    FROM public.department_members dm
    WHERE dm.department_id = p_dept_id AND dm.user_id = p_user_id;

    v_role_label := public.edu_resolve_role_label(v_grade, v_cur_role);
  END IF;

  SELECT m.id, m.name INTO v_member_id, v_member_name
  FROM public.members m
  WHERE m.app_user_id = p_user_id
  LIMIT 1;

  IF v_member_name IS NULL THEN
    SELECT p.name INTO v_member_name FROM public.profiles p WHERE p.id = p_user_id;
  END IF;

  IF p_link_placeholder_id IS NOT NULL THEN
    IF NOT public.edu_is_roster_grade(v_grade) THEN
      RAISE EXCEPTION '학부모 등급은 교사 기록과 연결할 수 없습니다';
    END IF;
    IF v_member_id IS NULL THEN
      RAISE EXCEPTION '연결할 성도 정보를 찾을 수 없습니다';
    END IF;

    SELECT t.department_id, t.member_id, t.user_id, t.is_active
      INTO v_placeholder_dept, v_placeholder_member, v_placeholder_user, v_placeholder_active
    FROM public.edu_teachers t
    WHERE t.id = p_link_placeholder_id;

    IF v_placeholder_dept IS NULL THEN
      RAISE EXCEPTION '연결할 교사 정보를 찾을 수 없습니다';
    END IF;
    IF v_placeholder_dept <> p_dept_id THEN
      RAISE EXCEPTION '연결할 교사가 다른 부서 소속입니다';
    END IF;
    IF NOT v_placeholder_active THEN
      RAISE EXCEPTION '삭제된 교사 기록은 연결할 수 없습니다';
    END IF;
    IF v_placeholder_member IS NOT NULL OR v_placeholder_user IS NOT NULL THEN
      RAISE EXCEPTION '연결 대상으로 선택한 교사는 이미 계정이 연결되어 있습니다';
    END IF;
  ELSIF public.edu_is_roster_grade(v_grade) AND NOT coalesce(p_allow_duplicate, false) THEN
    SELECT count(*) INTO v_same_name_count
    FROM public.edu_teachers t
    WHERE t.department_id = p_dept_id
      AND t.is_active = true
      AND t.member_id IS NULL
      AND t.user_id IS NULL
      AND regexp_replace(trim(t.name), '\s+', '', 'g') = regexp_replace(trim(coalesce(v_member_name, '')), '\s+', '', 'g');

    IF v_same_name_count > 0 THEN
      RAISE EXCEPTION '같은 이름의 미연결 교사 기록이 %건 있습니다. 동일인 연결 또는 동명이인 여부를 먼저 확인해 주세요',
        v_same_name_count;
    END IF;
  END IF;

  INSERT INTO public.department_members (
    department_id, user_id, member_role, status, grade,
    requested_at, approved_at, approved_by
  ) VALUES (
    p_dept_id, p_user_id, v_role_label, 'approved', v_grade,
    now(), now(), auth.uid()
  )
  ON CONFLICT (department_id, user_id) DO UPDATE
    SET grade       = excluded.grade,
        member_role = excluded.member_role,
        approved_at = now(),
        approved_by = auth.uid();

  PERFORM public.edu_sync_roster_member(
    p_dept_id, p_user_id, v_member_id, v_grade, v_role_label
  );

  IF p_link_placeholder_id IS NOT NULL THEN
    PERFORM public.edu_link_teacher_account(p_link_placeholder_id, v_member_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_member_grade(uuid, uuid, smallint, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_member_grade(uuid, uuid, smallint, text, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_member_grade(uuid, uuid, smallint, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_member_grade(uuid, uuid, smallint, text, uuid, boolean) TO service_role;
