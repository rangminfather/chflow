-- 참여율 조사 — 같은 날짜에 여러 번(1부/2부 등) 저장할 수 있게 "세션" 개념을 추가한다.
--
--   session_no : 그 날짜 안에서 몇 번째 저장인지(1, 2, 3 ...). 기본 1.
--   화면에서 이미 저장된 날짜에 다시 들어가면 "이어서 볼지 / 새로 저장할지" 묻고,
--   새로 저장을 고르면 그 날짜의 다음 session_no로 빈 화면을 새로 시작한다.
--   목록·불러오기는 (날짜, 세션) 단위로 동작한다 — 기존 "날짜만" 있던 목록을 대체.
--
-- 기존 UNIQUE(student_id, check_date) 는 세션이 여러 개면 그 자체로 막히므로
-- UNIQUE(student_id, check_date, session_no) 로 바꾼다. 기존 데이터는 전부
-- session_no 기본값 1로 들어가므로 조회 결과가 그대로 유지된다(호환).
--
-- 기존 RPC(예: edu_participation_set_status)에 p_session_no 파라미터를 새로 추가할 때는
-- 반드시 옛 시그니처를 먼저 DROP 해야 한다 — 그냥 두면 세션 없이 호출하는 옛 버전이
-- 남아서 세션 구분이 우회된다(이전에 겪은 실수와 같은 종류).

ALTER TABLE public.edu_participation_checks
  ADD COLUMN IF NOT EXISTS session_no int NOT NULL DEFAULT 1;
ALTER TABLE public.edu_participation_teacher_checks
  ADD COLUMN IF NOT EXISTS session_no int NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edu_participation_checks_session_no_check') THEN
    ALTER TABLE public.edu_participation_checks
      ADD CONSTRAINT edu_participation_checks_session_no_check CHECK (session_no >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edu_participation_teacher_checks_session_no_check') THEN
    ALTER TABLE public.edu_participation_teacher_checks
      ADD CONSTRAINT edu_participation_teacher_checks_session_no_check CHECK (session_no >= 1);
  END IF;
END $$;

ALTER TABLE public.edu_participation_checks
  DROP CONSTRAINT IF EXISTS edu_participation_checks_student_id_check_date_key;
ALTER TABLE public.edu_participation_checks
  ADD CONSTRAINT edu_participation_checks_student_session_key UNIQUE (student_id, check_date, session_no);

ALTER TABLE public.edu_participation_teacher_checks
  DROP CONSTRAINT IF EXISTS edu_participation_teacher_checks_teacher_id_check_date_key;
ALTER TABLE public.edu_participation_teacher_checks
  ADD CONSTRAINT edu_participation_teacher_checks_teacher_session_key UNIQUE (teacher_id, check_date, session_no);

CREATE INDEX IF NOT EXISTS idx_edu_participation_checks_dept_date_session
  ON public.edu_participation_checks(department_id, check_date, session_no);
CREATE INDEX IF NOT EXISTS idx_edu_participation_teacher_checks_dept_date_session
  ON public.edu_participation_teacher_checks(department_id, check_date, session_no);

-- ─────────────────────────────────────────
-- 조회: 반별 학생 + 해당 날짜·세션 체크 상태
-- (is_active 필터가 그대로 있어 탈퇴·삭제된 학생은 과거 세션을 불러와도 자동으로
--  빠진다 — "인원이 안 맞으면 강제로 버린다"는 요구를 이 필터가 이미 만족한다)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_participation_list(uuid, date);
CREATE OR REPLACE FUNCTION public.edu_participation_list(p_dept_id uuid, p_check_date date, p_session_no int DEFAULT 1)
RETURNS TABLE (
  student_id            uuid,
  name                  text,
  class_no              text,
  grade_year            smallint,
  gender                text,
  teacher_name          text,
  status                text,
  note                  text,
  new_friend_male_count int,
  new_friend_female_count int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.name,
    s.class_no,
    s.grade_year,
    s.gender,
    t.name AS teacher_name,
    COALESCE(c.status, '')::text,
    c.note,
    COALESCE(c.new_friend_male_count, 0),
    COALESCE(c.new_friend_female_count, 0)
  FROM public.edu_students s
  LEFT JOIN public.edu_teachers t ON t.id = s.teacher_id
  LEFT JOIN public.edu_participation_checks c
    ON c.student_id = s.id AND c.check_date = p_check_date AND c.session_no = COALESCE(p_session_no, 1)
  WHERE s.department_id = p_dept_id
    AND s.is_active
  ORDER BY s.grade_year NULLS LAST, s.class_no, s.order_no, s.student_no, s.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_list(uuid, date, int) TO authenticated;

DROP FUNCTION IF EXISTS public.edu_participation_set_status(uuid, uuid, date, text);
CREATE OR REPLACE FUNCTION public.edu_participation_set_status(
  p_dept_id    uuid,
  p_student_id uuid,
  p_check_date date,
  p_status     text,
  p_session_no int DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;
  IF p_status NOT IN ('', '참석', '불참') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.edu_students WHERE id = p_student_id AND department_id = p_dept_id
  ) THEN
    RAISE EXCEPTION '학생을 찾을 수 없습니다';
  END IF;

  INSERT INTO public.edu_participation_checks (department_id, student_id, check_date, session_no, status, updated_by, updated_at)
  VALUES (p_dept_id, p_student_id, p_check_date, COALESCE(p_session_no, 1), p_status, auth.uid(), now())
  ON CONFLICT (student_id, check_date, session_no)
  DO UPDATE SET status = EXCLUDED.status, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_set_status(uuid, uuid, date, text, int) TO authenticated;

DROP FUNCTION IF EXISTS public.edu_participation_set_note(uuid, uuid, date, text);
CREATE OR REPLACE FUNCTION public.edu_participation_set_note(
  p_dept_id    uuid,
  p_student_id uuid,
  p_check_date date,
  p_note       text,
  p_session_no int DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.edu_students WHERE id = p_student_id AND department_id = p_dept_id
  ) THEN
    RAISE EXCEPTION '학생을 찾을 수 없습니다';
  END IF;

  INSERT INTO public.edu_participation_checks (department_id, student_id, check_date, session_no, note, updated_by, updated_at)
  VALUES (p_dept_id, p_student_id, p_check_date, COALESCE(p_session_no, 1), NULLIF(p_note, ''), auth.uid(), now())
  ON CONFLICT (student_id, check_date, session_no)
  DO UPDATE SET note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_set_note(uuid, uuid, date, text, int) TO authenticated;

DROP FUNCTION IF EXISTS public.edu_participation_set_new_friends(uuid, uuid, date, int, int);
CREATE OR REPLACE FUNCTION public.edu_participation_set_new_friends(
  p_dept_id    uuid,
  p_student_id uuid,
  p_check_date date,
  p_male       int,
  p_female     int,
  p_session_no int DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;
  IF p_male < 0 OR p_female < 0 THEN
    RAISE EXCEPTION 'invalid new friend count';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.edu_students WHERE id = p_student_id AND department_id = p_dept_id
  ) THEN
    RAISE EXCEPTION '학생을 찾을 수 없습니다';
  END IF;

  INSERT INTO public.edu_participation_checks (
    department_id, student_id, check_date, session_no, new_friend_male_count, new_friend_female_count, updated_by, updated_at
  )
  VALUES (p_dept_id, p_student_id, p_check_date, COALESCE(p_session_no, 1), p_male, p_female, auth.uid(), now())
  ON CONFLICT (student_id, check_date, session_no)
  DO UPDATE SET
    new_friend_male_count = EXCLUDED.new_friend_male_count,
    new_friend_female_count = EXCLUDED.new_friend_female_count,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_set_new_friends(uuid, uuid, date, int, int, int) TO authenticated;

DROP FUNCTION IF EXISTS public.edu_participation_teacher_list(uuid, date);
CREATE OR REPLACE FUNCTION public.edu_participation_teacher_list(p_dept_id uuid, p_check_date date, p_session_no int DEFAULT 1)
RETURNS TABLE (
  teacher_id   uuid,
  name         text,
  teacher_role text,
  status       text,
  note         text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.name,
    t.teacher_role,
    COALESCE(c.status, '')::text,
    c.note
  FROM public.edu_teachers t
  LEFT JOIN public.edu_participation_teacher_checks c
    ON c.teacher_id = t.id AND c.check_date = p_check_date AND c.session_no = COALESCE(p_session_no, 1)
  WHERE t.department_id = p_dept_id
    AND t.is_active
  ORDER BY t.order_no, t.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_teacher_list(uuid, date, int) TO authenticated;

DROP FUNCTION IF EXISTS public.edu_participation_teacher_set_status(uuid, uuid, date, text);
CREATE OR REPLACE FUNCTION public.edu_participation_teacher_set_status(
  p_dept_id    uuid,
  p_teacher_id uuid,
  p_check_date date,
  p_status     text,
  p_session_no int DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;
  IF p_status NOT IN ('', '참석', '불참') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.edu_teachers WHERE id = p_teacher_id AND department_id = p_dept_id
  ) THEN
    RAISE EXCEPTION '교사를 찾을 수 없습니다';
  END IF;

  INSERT INTO public.edu_participation_teacher_checks (department_id, teacher_id, check_date, session_no, status, updated_by, updated_at)
  VALUES (p_dept_id, p_teacher_id, p_check_date, COALESCE(p_session_no, 1), p_status, auth.uid(), now())
  ON CONFLICT (teacher_id, check_date, session_no)
  DO UPDATE SET status = EXCLUDED.status, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_teacher_set_status(uuid, uuid, date, text, int) TO authenticated;

DROP FUNCTION IF EXISTS public.edu_participation_teacher_set_note(uuid, uuid, date, text);
CREATE OR REPLACE FUNCTION public.edu_participation_teacher_set_note(
  p_dept_id    uuid,
  p_teacher_id uuid,
  p_check_date date,
  p_note       text,
  p_session_no int DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_grade(p_dept_id) > 1 THEN
    RAISE EXCEPTION '참여율 조사 접근 권한이 없습니다 (요구 등급: 0~1)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.edu_teachers WHERE id = p_teacher_id AND department_id = p_dept_id
  ) THEN
    RAISE EXCEPTION '교사를 찾을 수 없습니다';
  END IF;

  INSERT INTO public.edu_participation_teacher_checks (department_id, teacher_id, check_date, session_no, note, updated_by, updated_at)
  VALUES (p_dept_id, p_teacher_id, p_check_date, COALESCE(p_session_no, 1), NULLIF(p_note, ''), auth.uid(), now())
  ON CONFLICT (teacher_id, check_date, session_no)
  DO UPDATE SET note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_teacher_set_note(uuid, uuid, date, text, int) TO authenticated;

-- ─────────────────────────────────────────
-- 저장 목록 — 이제 "날짜"가 아니라 "날짜+세션" 단위로 한 행씩 돌려준다.
-- 저장일시(updated_at)를 그대로 내려서 화면에 "언제 저장했는지"를 보여줄 수 있게 한다.
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_participation_list_dates(uuid);
CREATE OR REPLACE FUNCTION public.edu_participation_list_dates(p_dept_id uuid)
RETURNS TABLE (
  check_date       date,
  session_no       int,
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
    COALESCE(s.student_present, 0)::int,
    COALESCE(s.new_friend_total, 0)::int,
    COALESCE(t.teacher_present, 0)::int,
    COALESCE(t.teacher_total, 0)::int,
    GREATEST(COALESCE(s.updated_at, 'epoch'::timestamptz), COALESCE(t.updated_at, 'epoch'::timestamptz))
  FROM (
    SELECT c.check_date, c.session_no FROM public.edu_participation_checks c WHERE c.department_id = p_dept_id
    UNION
    SELECT tc.check_date, tc.session_no FROM public.edu_participation_teacher_checks tc WHERE tc.department_id = p_dept_id
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
  ORDER BY d.check_date DESC, d.session_no ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_list_dates(uuid) TO authenticated;

-- ─────────────────────────────────────────
-- 삭제 — 이제 날짜의 특정 세션 하나만 지운다.
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_participation_delete_date(uuid, date);
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
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_participation_delete_date(uuid, date, int) TO authenticated;
