-- ─────────────────────────────────────────
-- 교사 소프트 삭제 + 임시 교사 병합/계정 연결
--  1) edu_delete_teacher   : hard delete → 소프트 삭제 (is_active=false, 출석 이력 보존)
--  2) edu_restore_teacher  : 삭제된 교사 복구
--  3) edu_purge_teacher    : 영구 삭제 (소프트 삭제된 행만 허용, 출석 기록 CASCADE)
--  4) edu_merge_duplicate_teacher : 중복 교사 병합 — 출석/담임/진급이력을 대상 행으로
--     이관 후 원본 행 삭제. 같은 주에 양쪽 기록이 있으면 대상 행 기록 유지.
--  5) edu_link_teacher_account    : 임명 직전, 미연결(placeholder) 교사 행에 성도를
--     연결해 임명 플로우가 새 행을 만들지 않고 기존 행을 재사용하도록 함.
--     (members.app_user_id → user_id 방향, profiles.member_id 사용 안 함)
-- ─────────────────────────────────────────

-- 로그 action_type 확장 (merge_duplicate 추가)
ALTER TABLE public.teacher_assignment_log
  DROP CONSTRAINT IF EXISTS teacher_assignment_log_action_type_check;
ALTER TABLE public.teacher_assignment_log
  ADD CONSTRAINT teacher_assignment_log_action_type_check
  CHECK (action_type IN ('bulk_assign','merge_placeholder','change_student','manual_edit','merge_duplicate'));

-- 1) 소프트 삭제
CREATE OR REPLACE FUNCTION public.edu_delete_teacher(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dept_id uuid;
BEGIN
  SELECT department_id INTO v_dept_id FROM public.edu_teachers WHERE id = p_id;
  IF NOT public.is_edu_member_or_admin(v_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  UPDATE public.edu_teachers SET is_active = false WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_delete_teacher(uuid) TO authenticated;

-- 2) 복구
CREATE OR REPLACE FUNCTION public.edu_restore_teacher(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dept_id uuid;
BEGIN
  SELECT department_id INTO v_dept_id FROM public.edu_teachers WHERE id = p_id;
  IF NOT public.is_edu_member_or_admin(v_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  UPDATE public.edu_teachers SET is_active = true WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_restore_teacher(uuid) TO authenticated;

-- 3) 영구 삭제 — 소프트 삭제된 행만 (실수로 활성 교사를 바로 지우는 경로 차단)
CREATE OR REPLACE FUNCTION public.edu_purge_teacher(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dept_id uuid; v_active boolean;
BEGIN
  SELECT department_id, is_active INTO v_dept_id, v_active
  FROM public.edu_teachers WHERE id = p_id;
  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION '교사 정보 없음';
  END IF;
  IF NOT public.is_edu_member_or_admin(v_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  IF v_active THEN
    RAISE EXCEPTION '활성 교사는 영구 삭제할 수 없습니다. 먼저 삭제하세요';
  END IF;
  DELETE FROM public.edu_teachers WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_purge_teacher(uuid) TO authenticated;

-- 4) 중복 교사 병합: source(임시) → target(유지) 이관 후 source 삭제
--    반환값: 이관된 출석 기록 수
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

  -- 출석 이관: 대상에 같은 날짜 기록이 없을 때만 이동 (충돌 시 대상 기록 유지)
  UPDATE public.edu_teacher_attendance a
  SET teacher_id = p_target_id
  WHERE a.teacher_id = p_source_id
    AND NOT EXISTS (
      SELECT 1 FROM public.edu_teacher_attendance b
      WHERE b.teacher_id = p_target_id AND b.attend_date = a.attend_date
    );
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- 담임 배정·진급 이력 이관
  UPDATE public.edu_students        SET teacher_id = p_target_id WHERE teacher_id = p_source_id;
  UPDATE public.edu_student_history SET teacher_id = p_target_id WHERE teacher_id = p_source_id;

  -- 원본 삭제 (충돌로 남은 출석 기록은 CASCADE 정리)
  DELETE FROM public.edu_teachers WHERE id = p_source_id;

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

-- 5) 임명 직전 placeholder 교사에 성도 연결
--    이후 admin_appoint_dept_member 가 member_id 매칭으로 이 행을 UPDATE → 중복 생성 안 됨
CREATE OR REPLACE FUNCTION public.edu_link_teacher_account(
  p_teacher_id uuid,
  p_member_id  uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dept_id uuid; v_user_id uuid; v_member_id uuid;
  v_name text; v_app_user_id uuid;
  v_caller_name text;
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

  UPDATE public.edu_teachers
  SET member_id = p_member_id,
      user_id   = v_app_user_id,
      name      = v_name,
      is_active = true
  WHERE id = p_teacher_id;

  SELECT name INTO v_caller_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.teacher_assignment_log (
    department_id, action_type, placeholder_id, real_member_id,
    new_teacher_id, new_teacher_name, changed_by, changed_by_name
  ) VALUES (
    v_dept_id, 'merge_placeholder', p_teacher_id, p_member_id,
    p_teacher_id, v_name, auth.uid(), v_caller_name
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_link_teacher_account(uuid, uuid) TO authenticated;
