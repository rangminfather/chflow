-- 참여율 조사 — 세션 메모 + "이전 저장 내용을 지금 보는 날짜에 적용" 기능
--
--   edu_participation_sessions : 세션(날짜+세션번호) 단위 메모 한 줄을 저장하는 곳.
--     학생/교사 체크 테이블과 별개로 둔다 — 한 세션에 여러 학생 행이 있어서
--     메모를 그 행들에 나눠 저장하면 "누구 것이 진짜 메모인지" 애매해진다.
--
--   edu_participation_copy_session : 예전에 저장해 둔 세션(예: 지난주)을
--     "지금 보고 있는 날짜"에 그대로 복사해 넣는다. 참여자가 비슷해서 거의
--     안 고쳐도 될 때, 매번 처음부터 체크하지 않고 이전 기록을 불러와 몇 명만
--     고치는 용도. 대상 세션의 기존 체크는 지우고 원본을 그대로 덮어쓴다
--     (부분 병합이 아니라 완전 교체 — 헷갈리는 잔여 데이터를 안 남긴다).
--     복사 시에도 is_active 필터가 있어 탈퇴·삭제된 학생/교사는 자동으로 빠진다.

CREATE TABLE IF NOT EXISTS public.edu_participation_sessions (
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  check_date    date NOT NULL,
  session_no    int NOT NULL DEFAULT 1 CHECK (session_no >= 1),
  memo          text,
  updated_by    uuid REFERENCES auth.users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, check_date, session_no)
);

ALTER TABLE public.edu_participation_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "edu_participation_sessions_rls" ON public.edu_participation_sessions;
CREATE POLICY "edu_participation_sessions_rls" ON public.edu_participation_sessions
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));

-- ─────────────────────────────────────────
-- 메모 저장 — 세션에 실제 체크 데이터가 아직 없어도(새 세션 막 시작) 저장할 수 있다.
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_participation_set_session_memo(
  p_dept_id    uuid,
  p_check_date date,
  p_session_no int,
  p_memo       text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;

  INSERT INTO public.edu_participation_sessions (department_id, check_date, session_no, memo, updated_by, updated_at)
  VALUES (p_dept_id, p_check_date, COALESCE(p_session_no, 1), NULLIF(TRIM(p_memo), ''), auth.uid(), now())
  ON CONFLICT (department_id, check_date, session_no)
  DO UPDATE SET memo = EXCLUDED.memo, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_set_session_memo(uuid, date, int, text) TO authenticated;

-- ─────────────────────────────────────────
-- 저장 목록에 메모 포함 (returns table 컬럼 구성이 바뀌므로 drop 후 재생성)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_participation_list_dates(uuid);
CREATE OR REPLACE FUNCTION public.edu_participation_list_dates(p_dept_id uuid)
RETURNS TABLE (
  check_date       date,
  session_no       int,
  memo             text,
  student_present  int,
  new_friend_total int,
  teacher_present  int,
  teacher_total    int,
  updated_at       timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;

  RETURN QUERY
  SELECT
    d.check_date,
    d.session_no,
    m.memo,
    COALESCE(s.student_present, 0)::int,
    COALESCE(s.new_friend_total, 0)::int,
    COALESCE(t.teacher_present, 0)::int,
    COALESCE(t.teacher_total, 0)::int,
    GREATEST(
      COALESCE(s.updated_at, 'epoch'::timestamptz),
      COALESCE(t.updated_at, 'epoch'::timestamptz),
      COALESCE(m.updated_at, 'epoch'::timestamptz)
    )
  FROM (
    SELECT c.check_date, c.session_no FROM public.edu_participation_checks c WHERE c.department_id = p_dept_id
    UNION
    SELECT tc.check_date, tc.session_no FROM public.edu_participation_teacher_checks tc WHERE tc.department_id = p_dept_id
    UNION
    SELECT ps.check_date, ps.session_no FROM public.edu_participation_sessions ps WHERE ps.department_id = p_dept_id
  ) d
  LEFT JOIN (
    SELECT
      c.check_date AS check_date,
      c.session_no AS session_no,
      COUNT(*) FILTER (WHERE c.status = '참석') AS student_present,
      SUM(c.new_friend_male_count + c.new_friend_female_count) AS new_friend_total,
      MAX(c.updated_at) AS updated_at
    FROM public.edu_participation_checks c
    WHERE c.department_id = p_dept_id
    GROUP BY c.check_date, c.session_no
  ) s ON s.check_date = d.check_date AND s.session_no = d.session_no
  LEFT JOIN (
    SELECT
      tc.check_date AS check_date,
      tc.session_no AS session_no,
      COUNT(*) FILTER (WHERE tc.status <> '') AS teacher_total,
      COUNT(*) FILTER (WHERE tc.status = '참석') AS teacher_present,
      MAX(tc.updated_at) AS updated_at
    FROM public.edu_participation_teacher_checks tc
    WHERE tc.department_id = p_dept_id
    GROUP BY tc.check_date, tc.session_no
  ) t ON t.check_date = d.check_date AND t.session_no = d.session_no
  LEFT JOIN public.edu_participation_sessions m
    ON m.department_id = p_dept_id AND m.check_date = d.check_date AND m.session_no = d.session_no
  -- 체크 데이터가 하나도 없이 메모만 있는 "빈 세션"은 목록에 안 보여준다(만들다 만 세션 취급)
  WHERE s.check_date IS NOT NULL OR t.check_date IS NOT NULL
  ORDER BY d.check_date DESC, d.session_no ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_list_dates(uuid) TO authenticated;

-- ─────────────────────────────────────────
-- 삭제 시 메모도 같이 지운다
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_participation_delete_date(p_dept_id uuid, p_check_date date, p_session_no int DEFAULT 1)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;

  DELETE FROM public.edu_participation_checks
    WHERE department_id = p_dept_id AND check_date = p_check_date AND session_no = COALESCE(p_session_no, 1);
  DELETE FROM public.edu_participation_teacher_checks
    WHERE department_id = p_dept_id AND check_date = p_check_date AND session_no = COALESCE(p_session_no, 1);
  DELETE FROM public.edu_participation_sessions
    WHERE department_id = p_dept_id AND check_date = p_check_date AND session_no = COALESCE(p_session_no, 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_delete_date(uuid, date, int) TO authenticated;

-- ─────────────────────────────────────────
-- 이전 세션을 지금 보는 날짜(세션)에 그대로 적용(완전 교체)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_participation_copy_session(
  p_dept_id         uuid,
  p_source_date     date,
  p_source_session  int,
  p_target_date     date,
  p_target_session  int
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;
  IF p_source_date = p_target_date AND COALESCE(p_source_session, 1) = COALESCE(p_target_session, 1) THEN
    RAISE EXCEPTION '같은 세션에는 적용할 수 없습니다';
  END IF;

  -- 대상 세션은 완전 교체한다 — 부분 병합하면 이전에 체크했던 값이 남아 헷갈린다.
  DELETE FROM public.edu_participation_checks
    WHERE department_id = p_dept_id AND check_date = p_target_date AND session_no = COALESCE(p_target_session, 1);
  DELETE FROM public.edu_participation_teacher_checks
    WHERE department_id = p_dept_id AND check_date = p_target_date AND session_no = COALESCE(p_target_session, 1);

  -- 학생 체크 복사 — 탈퇴·삭제되어 지금은 비활성인 학생은 자동으로 빠진다.
  INSERT INTO public.edu_participation_checks (
    department_id, student_id, check_date, session_no, status, note,
    new_friend_male_count, new_friend_female_count, updated_by, updated_at
  )
  SELECT
    c.department_id, c.student_id, p_target_date, COALESCE(p_target_session, 1),
    c.status, c.note, c.new_friend_male_count, c.new_friend_female_count, auth.uid(), now()
  FROM public.edu_participation_checks c
  JOIN public.edu_students s ON s.id = c.student_id AND s.is_active
  WHERE c.department_id = p_dept_id AND c.check_date = p_source_date AND c.session_no = COALESCE(p_source_session, 1);

  -- 교사 체크 복사 — 마찬가지로 활성 교사만.
  INSERT INTO public.edu_participation_teacher_checks (
    department_id, teacher_id, check_date, session_no, status, note, updated_by, updated_at
  )
  SELECT
    tc.department_id, tc.teacher_id, p_target_date, COALESCE(p_target_session, 1),
    tc.status, tc.note, auth.uid(), now()
  FROM public.edu_participation_teacher_checks tc
  JOIN public.edu_teachers t ON t.id = tc.teacher_id AND t.is_active
  WHERE tc.department_id = p_dept_id AND tc.check_date = p_source_date AND tc.session_no = COALESCE(p_source_session, 1);

  -- 메모는 복사하지 않는다 — 대상 날짜의 메모는 그 날짜 사정에 맞게 따로 적는 것이 맞다.
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_copy_session(uuid, date, int, date, int) TO authenticated;
