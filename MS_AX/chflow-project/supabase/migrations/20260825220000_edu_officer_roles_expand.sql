-- =============================================================
-- 교육부서 임원진(grade 2) 직책 확장
--
-- 기존: 부부장 / 총무 / 서기 3종만 grade 2 로 인식했다.
-- 확장: 부부장 / 총무 / 부총무 / 서기 / 부서기 / 회계 / 부회계
--       부서마다 임원 구성이 달라(부총무·부서기가 없는 부서도 있다) 목록은 전 부서 공용이고,
--       쓰지 않는 직책은 고르지 않으면 된다. 목록에 없는 명칭은 화면의 "직접입력"으로 넣고
--       edu_resolve_role_label 의 "사용자 지정 직책 보존" 규칙이 그대로 적용된다.
--
-- 함께 바뀌는 것
--   1) edu_role_grade            — 새 직책 → grade 2 매핑
--   2) edu_role_sort             — 부서원 목록 정렬 순서 (신규)
--   3) list_dept_grade_members   — 정렬을 edu_role_sort 로 위임
--   4) upsert_member_grade       — p_role 파라미터 추가 (직책을 직접 지정)
--   5) admin_appoint_dept_member — 표준 직책이면 등급을 직책에서 유도해 불일치 방지
--
-- 기존 행 데이터는 UPDATE 하지 않는다 (함수 정의만 교체).
-- 프론트 대응: chflow-app/lib/deptRoles.ts (같은 정책의 사본)
-- =============================================================


-- ─────────────────────────────────────────
-- 1. 직책 → 등급 (grade 2 임원 직책 7종)
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
    WHEN '부총무' THEN 2::smallint
    WHEN '서기'   THEN 2::smallint
    WHEN '부서기' THEN 2::smallint
    WHEN '회계'   THEN 2::smallint
    WHEN '부회계' THEN 2::smallint
    WHEN '교사'   THEN 3::smallint
    WHEN '학부모' THEN 4::smallint
    ELSE NULL::smallint
  END
$$;
GRANT EXECUTE ON FUNCTION public.edu_role_grade(text) TO authenticated;


-- ─────────────────────────────────────────
-- 2. 직책 정렬 순서 — 목록이 임원진 → 교사 → 학부모 순으로 보이게
--    (직접입력 직책은 표준 직책 뒤, 학부모 앞)
-- ─────────────────────────────────────────
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
    WHEN '부서기' THEN 7::smallint
    WHEN '회계'   THEN 8::smallint
    WHEN '부회계' THEN 9::smallint
    WHEN '교사'   THEN 20::smallint
    WHEN '학부모' THEN 30::smallint
    ELSE 25::smallint
  END
$$;
GRANT EXECUTE ON FUNCTION public.edu_role_sort(text) TO authenticated;


-- ─────────────────────────────────────────
-- 3. 부서원 목록 — 정렬만 edu_role_sort 로 교체 (조회 내용은 동일)
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
    public.edu_role_sort(merged.role_label),
    merged.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_dept_grade_members(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 4. 등급/직책 변경 — 직책을 직접 지정할 수 있게 p_role 추가
--
--    p_role 이 비어 있으면   → 기존 동작 그대로 (현재 직책을 등급 규칙으로 해석)
--    p_role 이 표준 직책이면 → 등급을 직책에서 유도 (회계는 항상 grade 2)
--    p_role 이 직접입력이면  → 그 이름을 그대로 쓰고 등급은 p_grade
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.upsert_member_grade(uuid, uuid, smallint);

CREATE OR REPLACE FUNCTION public.upsert_member_grade(
  p_dept_id uuid,
  p_user_id uuid,
  p_grade   smallint,
  p_role    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req_role   text := nullif(trim(coalesce(p_role, '')), '');
  v_grade      smallint;
  v_cur_role   text;
  v_role_label text;
  v_member_id  uuid;
BEGIN
  IF NOT public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') THEN
    RAISE EXCEPTION '부서원 등급 관리 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  END IF;

  -- 표준 직책은 등급이 직책에 매여 있다 (직책·등급 불일치 데이터 방지)
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

    -- 같은 tier 안의 구체 직책(총무·회계)과 사용자 지정 직책은 등급만 바뀐다고 잃지 않는다
    v_role_label := public.edu_resolve_role_label(v_grade, v_cur_role);
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

  SELECT m.id INTO v_member_id FROM public.members m WHERE m.app_user_id = p_user_id LIMIT 1;
  PERFORM public.edu_sync_roster_member(p_dept_id, p_user_id, v_member_id, v_grade, v_role_label);
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_member_grade(uuid, uuid, smallint, text) TO authenticated;


-- ─────────────────────────────────────────
-- 5. 임명 — 표준 직책을 고르면 등급을 직책에서 유도한다
--    본문은 20260823160000 의 live 정의를 그대로 옮기고 등급 유도만 더했다.
--    (placeholder 연결 원자화 · 교차 부서 가드 유지)
-- ─────────────────────────────────────────
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
  v_req_role      text := nullif(trim(coalesce(p_teacher_role, '')), '');
  v_grade         smallint;
  v_role_label    text;
  v_ph_dept       uuid;
BEGIN
  IF NOT public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') THEN
    RAISE EXCEPTION '임명 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  END IF;

  -- 표준 직책이면 등급은 직책에서 나온다. 직접입력 직책은 화면에서 고른 등급을 쓴다.
  v_grade := coalesce(public.edu_role_grade(v_req_role), p_grade);
  IF v_grade IS NULL OR v_grade < 0 OR v_grade > 4 THEN
    RAISE EXCEPTION 'grade는 0~4 이어야 합니다';
  END IF;
  IF v_req_role IS NOT NULL AND char_length(v_req_role) > 20 THEN
    RAISE EXCEPTION '직책은 20자 이내로 입력해 주세요';
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

  -- 임명 화면에서 고른 직책이 있으면 그 값이 우선한다 (총무/회계/직접입력 등)
  v_role_label := coalesce(v_req_role, public.edu_default_role_for_grade(v_grade));

  INSERT INTO public.department_members (
    department_id, user_id, member_role, status, grade,
    requested_at, approved_at, approved_by
  ) VALUES (
    p_dept_id, v_app_user_id, v_role_label, 'approved', v_grade,
    now(), now(), auth.uid()
  )
  ON CONFLICT (department_id, user_id) DO UPDATE
    SET status      = 'approved',
        grade       = excluded.grade,
        member_role = excluded.member_role,
        approved_at = now(),
        approved_by = auth.uid()
  RETURNING id INTO v_dm_id;

  PERFORM public.edu_sync_roster_member(p_dept_id, v_app_user_id, p_member_id, v_grade, v_role_label);

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


-- ─────────────────────────────────────────
-- 사후 확인: 오버로드가 각각 1개만 남았는지 (20260823160000 과 같은 방식)
-- ─────────────────────────────────────────
DO $$
DECLARE v_cnt int; v_args text; r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY['admin_appoint_dept_member', 'upsert_member_grade']) AS fn LOOP
    SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.fn;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '중단: % 오버로드가 %개다(1개여야 함)', r.fn, v_cnt;
    END IF;
    SELECT pg_get_function_identity_arguments(p.oid) INTO v_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.fn;
    RAISE NOTICE '% 최종 시그니처: (%)', r.fn, v_args;
  END LOOP;
END
$$;
