-- ─────────────────────────────────────────
-- 교사 로스터 데이터 소유권 정리
--
--  1) edu_save_teacher: UPDATE 분기를 "수동 등록(placeholder) 교사"로 한정
--     - 수동 등록 = member_id IS NULL AND user_id IS NULL
--     - 계정/성도 연결 교사의 name·teacher_role 원본은 members + department_members 이며
--       admin_appoint_dept_member / edu_link_teacher_account / merge_placeholder_teacher
--       가 덮어쓰므로, 출석부 화면에서 고쳐도 되돌아간다 → DB 레벨에서 차단.
--     - 기존 행을 UPDATE 하므로 id가 유지되고 edu_teacher_attendance(teacher_id FK)·
--       edu_students.teacher_id·edu_student_history.teacher_id 연결이 그대로 보존된다.
--     - order_no 는 인자가 NULL 이면 기존 값 유지 (기존: 무조건 0으로 밀림)
--
--  2) upsert_member_grade: 등급 변경으로 department_members.member_role 이 바뀔 때
--     연결된 edu_teachers.teacher_role 도 함께 갱신 (출석부 직책이 stale 되던 문제)
--     - 연결 교사만 대상. 수동 등록 교사(user_id·member_id 모두 NULL)는 매칭되지 않는다.
--
--  변경 없음: edu_delete_teacher(소프트), edu_restore_teacher, edu_purge_teacher,
--             edu_merge_duplicate_teacher, edu_link_teacher_account,
--             merge_placeholder_teacher, admin_appoint_dept_member
-- ─────────────────────────────────────────


-- ─────────────────────────────────────────
-- 1) [교사] 저장 — 수동 등록 교사만 수정 허용
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
    VALUES (p_dept_id, trim(p_name), nullif(trim(coalesce(p_role, '')), ''), COALESCE(p_order_no, 0))
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
    -- 계정/성도 연결 교사는 부서원관리(임명·등급)가 원본 → 여기서 수정 금지
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
-- 2) 등급 변경 시 연결 교사 직책 동기화
--    (20260702090000_dept_mgmt_delegation_menu_settings.sql 버전 + edu_teachers 동기화)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_member_grade(p_dept_id uuid, p_user_id uuid, p_grade smallint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role_label text;
BEGIN
  IF p_grade < 0 OR p_grade > 4 THEN
    RAISE EXCEPTION 'grade must be 0~4';
  END IF;
  IF NOT public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') THEN
    RAISE EXCEPTION '부서원 등급 관리 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  END IF;

  v_role_label := CASE p_grade
    WHEN 0 THEN '전도사'
    WHEN 1 THEN '부장'
    WHEN 2 THEN '부부장'
    WHEN 3 THEN '교사'
    WHEN 4 THEN '학부모'
    ELSE '교사'
  END;

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

  -- 교사 출석부 직책 동기화 — 계정/성도가 연결된 행만.
  -- 수동 등록 교사는 user_id·member_id 가 모두 NULL 이라 어느 조건에도 매칭되지 않는다.
  IF p_user_id IS NOT NULL THEN
    UPDATE public.edu_teachers t
    SET teacher_role = v_role_label
    WHERE t.department_id = p_dept_id
      AND (t.user_id IS NOT NULL OR t.member_id IS NOT NULL)
      AND (
        t.user_id = p_user_id
        OR t.member_id IN (
          SELECT m.id FROM public.members m WHERE m.app_user_id = p_user_id
        )
      )
      AND t.teacher_role IS DISTINCT FROM v_role_label;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_member_grade(uuid, uuid, smallint) TO authenticated;
