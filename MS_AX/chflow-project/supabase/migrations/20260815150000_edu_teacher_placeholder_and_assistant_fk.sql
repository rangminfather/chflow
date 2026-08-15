-- =============================================================
-- 교사 identity 정리 마무리
--
--  1) list_teachers_status.is_placeholder 를 새 데이터 모델과 일치시킨다.
--     기존: member_id IS NULL                      → user_id 만 있는 반쪽 연결 행을 placeholder 로 오판
--     변경: member_id IS NULL AND user_id IS NULL  → 수동 등록 교사만 placeholder
--     반환 컬럼 구성은 그대로라 반 관리 화면(teacher-assign)의 사용부는 영향이 없다.
--
--  2) edu_merge_teacher_into 가 edu_classes.assistant_teacher_id(부담임)도 이관하도록 보강.
--     이 컬럼은 별도 작업(20260816100000_edu_class_dual_homeroom)에서 추가되며, 아직
--     적용 전일 수 있다. 컬럼 존재 여부를 확인한 뒤 동적 SQL 로 처리해 적용 순서와
--     무관하게 동작하게 한다. (FK 가 ON DELETE SET NULL 이라 이관하지 않으면 병합 시
--     부담임 지정이 조용히 사라진다.)
-- =============================================================

CREATE OR REPLACE FUNCTION public.list_teachers_status(p_dept_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  member_id UUID,
  user_id UUID,
  is_placeholder BOOLEAN,
  is_active BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    et.id,
    et.name,
    et.member_id,
    et.user_id,
    (et.member_id IS NULL AND et.user_id IS NULL) AS is_placeholder,
    et.is_active
  FROM public.edu_teachers et
  WHERE et.department_id = p_dept_id
  ORDER BY et.is_active DESC, et.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_teachers_status(uuid) TO authenticated;


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

  -- 부담임 슬롯 (다른 작업에서 추가되는 컬럼 — 있을 때만 이관)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'edu_classes'
      AND column_name  = 'assistant_teacher_id'
  ) THEN
    EXECUTE 'UPDATE public.edu_classes SET assistant_teacher_id = $1 WHERE assistant_teacher_id = $2'
      USING p_target_id, p_source_id;
  END IF;

  DELETE FROM public.edu_teachers WHERE id = p_source_id;
  RETURN v_moved;
END;
$$;
REVOKE ALL ON FUNCTION public.edu_merge_teacher_into(uuid, uuid) FROM PUBLIC;
