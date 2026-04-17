-- =============================================================
-- 교육사역부 초등1부 (공통: 교육사역국 소속 부서) 기능
-- 1. 일지작성  2. 선생임(교사출석부)  3. 출결(학생출석부)
-- 4. 학생출결  5. 새친구 등록카드     6. 달란트통장
-- =============================================================

-- ─────────────────────────────────────────
-- 0. 권한 헬퍼
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_edu_member_or_admin(p_dept_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.get_user_role() IN ('admin', 'office', 'pastor')
    OR EXISTS (
      SELECT 1 FROM public.department_members
      WHERE department_id = p_dept_id
        AND user_id = auth.uid()
        AND status = 'approved'
    )
$$;
GRANT EXECUTE ON FUNCTION public.is_edu_member_or_admin(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 0-1. get_department_info 재정의 (is_admin 추가)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_department_info(uuid);
CREATE OR REPLACE FUNCTION public.get_department_info(p_dept_id uuid)
RETURNS TABLE (
  id          uuid,
  category    text,
  name        text,
  description text,
  icon        text,
  member_count bigint,
  is_member   boolean,
  my_status   text,
  is_admin    boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    d.id,
    d.category,
    d.name,
    d.description,
    d.icon,
    (SELECT COUNT(*) FROM public.department_members dm
     WHERE dm.department_id = d.id AND dm.status = 'approved') AS member_count,
    (public.get_user_role() IN ('admin','office','pastor')
     OR EXISTS (
       SELECT 1 FROM public.department_members dm
       WHERE dm.department_id = d.id AND dm.user_id = auth.uid() AND dm.status = 'approved'
     )
    ) AS is_member,
    (SELECT status FROM public.department_members dm
     WHERE dm.department_id = d.id AND dm.user_id = auth.uid() LIMIT 1) AS my_status,
    (public.get_user_role() IN ('admin','office','pastor')) AS is_admin
  FROM public.departments d
  WHERE d.id = p_dept_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_department_info(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 1. 교회학교 일지 (edu_journals)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edu_journals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  journal_date    date NOT NULL,
  edu_topic       text,        -- 교육주제
  praise          text,        -- 찬양
  joint_activity  text,        -- 합동
  lesson_content  text,        -- 공과내용
  events          text,        -- 행사
  stat_reg_male   int DEFAULT 0,   -- 등록 남
  stat_reg_female int DEFAULT 0,   -- 등록 여
  stat_reg_total  int DEFAULT 0,   -- 등록 계
  stat_enrolled   int DEFAULT 0,   -- 재적
  stat_attend     int DEFAULT 0,   -- 출석
  stat_absent     int DEFAULT 0,   -- 결석
  offering        int DEFAULT 0,   -- 헌금
  volunteers      text,            -- 봉사
  prayer_requests text,            -- 기도제목
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (department_id, journal_date)
);

ALTER TABLE public.edu_journals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "edu_journals_rls" ON public.edu_journals;
CREATE POLICY "edu_journals_rls" ON public.edu_journals
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));

CREATE INDEX IF NOT EXISTS idx_edu_journals_dept_date
  ON public.edu_journals(department_id, journal_date DESC);


-- ─────────────────────────────────────────
-- 2. 교사 목록 (edu_teachers)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edu_teachers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name          text NOT NULL,
  teacher_role  text,          -- 부장/부부장/총무/교사 등
  order_no      int DEFAULT 0,
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.edu_teachers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "edu_teachers_rls" ON public.edu_teachers;
CREATE POLICY "edu_teachers_rls" ON public.edu_teachers
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));

CREATE INDEX IF NOT EXISTS idx_edu_teachers_dept ON public.edu_teachers(department_id, order_no);


-- ─────────────────────────────────────────
-- 3. 교사 출석 (edu_teacher_attendance)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edu_teacher_attendance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  uuid NOT NULL REFERENCES public.edu_teachers(id) ON DELETE CASCADE,
  dept_id     uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  attend_date date NOT NULL,
  is_present  boolean DEFAULT false,
  note        text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (teacher_id, attend_date)
);

ALTER TABLE public.edu_teacher_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "edu_teacher_attendance_rls" ON public.edu_teacher_attendance;
CREATE POLICY "edu_teacher_attendance_rls" ON public.edu_teacher_attendance
  USING (public.is_edu_member_or_admin(dept_id))
  WITH CHECK (public.is_edu_member_or_admin(dept_id));

CREATE INDEX IF NOT EXISTS idx_edu_teacher_att_dept_date
  ON public.edu_teacher_attendance(dept_id, attend_date);


-- ─────────────────────────────────────────
-- 4. 학생 목록 (edu_students)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edu_students (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  student_no    int,          -- 번호
  name          text NOT NULL,
  student_type  text DEFAULT '정' CHECK (student_type IN ('정','체험','소')),
  grade         text,
  is_active     boolean DEFAULT true,
  order_no      int DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.edu_students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "edu_students_rls" ON public.edu_students;
CREATE POLICY "edu_students_rls" ON public.edu_students
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));

CREATE INDEX IF NOT EXISTS idx_edu_students_dept ON public.edu_students(department_id, order_no);


-- ─────────────────────────────────────────
-- 5. 학생 출석 (edu_student_attendance)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edu_student_attendance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES public.edu_students(id) ON DELETE CASCADE,
  dept_id         uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  attend_date     date NOT NULL,     -- 해당 주일 날짜
  had_prayer      boolean DEFAULT false,
  had_church_sch  boolean DEFAULT false,   -- 교회학교
  had_worship     boolean DEFAULT false,
  had_lesson      boolean DEFAULT false,   -- 공과
  had_bible       boolean DEFAULT false,   -- 성경읽기
  attend_status   text DEFAULT '출' CHECK (attend_status IN ('출','빠','결','인')),
  memo            text,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (student_id, attend_date)
);

ALTER TABLE public.edu_student_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "edu_student_attendance_rls" ON public.edu_student_attendance;
CREATE POLICY "edu_student_attendance_rls" ON public.edu_student_attendance
  USING (public.is_edu_member_or_admin(dept_id))
  WITH CHECK (public.is_edu_member_or_admin(dept_id));

CREATE INDEX IF NOT EXISTS idx_edu_student_att_dept_date
  ON public.edu_student_attendance(dept_id, attend_date);
CREATE INDEX IF NOT EXISTS idx_edu_student_att_student
  ON public.edu_student_attendance(student_id, attend_date);


-- ─────────────────────────────────────────
-- 6. 새친구 등록카드 (edu_new_friends)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edu_new_friends (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  name            text NOT NULL,
  gender          text CHECK (gender IN ('남','여')),
  birth_date      date,
  photo_url       text,
  phone           text,
  mobile          text,
  address         text,
  email           text,
  group_pa        text,   -- 파
  group_jik       text,   -- 직
  group_gun       text,   -- 군
  group_cheo      text,   -- 처
  family_name     text,
  guide_name      text,   -- 인도자
  school_district text,   -- 학원구
  join_date       date,
  special_notes   text,
  memo            text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.edu_new_friends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "edu_new_friends_rls" ON public.edu_new_friends;
CREATE POLICY "edu_new_friends_rls" ON public.edu_new_friends
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));

CREATE INDEX IF NOT EXISTS idx_edu_new_friends_dept ON public.edu_new_friends(department_id, created_at DESC);


-- ─────────────────────────────────────────
-- 7. 달란트 기록 (edu_talent_records)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edu_talent_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.edu_students(id) ON DELETE CASCADE,
  record_date     date NOT NULL,
  pts_attendance  int DEFAULT 0,   -- 출석
  pts_offering    int DEFAULT 0,   -- 예전(예배헌금)
  pts_evangelism  int DEFAULT 0,   -- 전도
  pts_memory      int DEFAULT 0,   -- 암송
  pts_win         int DEFAULT 0,   -- 우승
  pts_other       int DEFAULT 0,   -- 기타
  note            text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.edu_talent_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "edu_talent_records_rls" ON public.edu_talent_records;
CREATE POLICY "edu_talent_records_rls" ON public.edu_talent_records
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));

CREATE INDEX IF NOT EXISTS idx_edu_talent_dept ON public.edu_talent_records(department_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_edu_talent_student ON public.edu_talent_records(student_id, record_date DESC);


-- =============================================================
-- RPC 함수들
-- =============================================================

-- ─────────────────────────────────────────
-- [일지] 목록
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_list_journals(uuid);
CREATE OR REPLACE FUNCTION public.edu_list_journals(p_dept_id uuid)
RETURNS TABLE (
  id            uuid,
  journal_date  date,
  edu_topic     text,
  stat_attend   int,
  offering      int,
  created_at    timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, journal_date, edu_topic, stat_attend, offering, created_at
  FROM public.edu_journals
  WHERE department_id = p_dept_id
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY journal_date DESC;
$$;
GRANT EXECUTE ON FUNCTION public.edu_list_journals(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [일지] 단건 조회
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_get_journal(uuid);
CREATE OR REPLACE FUNCTION public.edu_get_journal(p_id uuid)
RETURNS TABLE (
  id              uuid,
  department_id   uuid,
  journal_date    date,
  edu_topic       text,
  praise          text,
  joint_activity  text,
  lesson_content  text,
  events          text,
  stat_reg_male   int,
  stat_reg_female int,
  stat_reg_total  int,
  stat_enrolled   int,
  stat_attend     int,
  stat_absent     int,
  offering        int,
  volunteers      text,
  prayer_requests text,
  created_at      timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT j.id, j.department_id, j.journal_date, j.edu_topic, j.praise,
         j.joint_activity, j.lesson_content, j.events,
         j.stat_reg_male, j.stat_reg_female, j.stat_reg_total,
         j.stat_enrolled, j.stat_attend, j.stat_absent,
         j.offering, j.volunteers, j.prayer_requests, j.created_at
  FROM public.edu_journals j
  WHERE j.id = p_id
    AND public.is_edu_member_or_admin(j.department_id);
$$;
GRANT EXECUTE ON FUNCTION public.edu_get_journal(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [일지] 저장 (UPSERT)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_upsert_journal(uuid, date, text, text, text, text, text, int, int, int, int, int, int, int, text, text);
CREATE OR REPLACE FUNCTION public.edu_upsert_journal(
  p_dept_id       uuid,
  p_date          date,
  p_topic         text,
  p_praise        text,
  p_joint         text,
  p_lesson        text,
  p_events        text,
  p_reg_male      int,
  p_reg_female    int,
  p_reg_total     int,
  p_enrolled      int,
  p_attend        int,
  p_absent        int,
  p_offering      int,
  p_volunteers    text,
  p_prayer        text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  INSERT INTO public.edu_journals (
    department_id, journal_date, edu_topic, praise, joint_activity,
    lesson_content, events, stat_reg_male, stat_reg_female, stat_reg_total,
    stat_enrolled, stat_attend, stat_absent, offering, volunteers,
    prayer_requests, created_by, updated_at
  ) VALUES (
    p_dept_id, p_date, p_topic, p_praise, p_joint, p_lesson, p_events,
    COALESCE(p_reg_male,0), COALESCE(p_reg_female,0), COALESCE(p_reg_total,0),
    COALESCE(p_enrolled,0), COALESCE(p_attend,0), COALESCE(p_absent,0),
    COALESCE(p_offering,0), p_volunteers, p_prayer, auth.uid(), now()
  )
  ON CONFLICT (department_id, journal_date) DO UPDATE SET
    edu_topic       = EXCLUDED.edu_topic,
    praise          = EXCLUDED.praise,
    joint_activity  = EXCLUDED.joint_activity,
    lesson_content  = EXCLUDED.lesson_content,
    events          = EXCLUDED.events,
    stat_reg_male   = EXCLUDED.stat_reg_male,
    stat_reg_female = EXCLUDED.stat_reg_female,
    stat_reg_total  = EXCLUDED.stat_reg_total,
    stat_enrolled   = EXCLUDED.stat_enrolled,
    stat_attend     = EXCLUDED.stat_attend,
    stat_absent     = EXCLUDED.stat_absent,
    offering        = EXCLUDED.offering,
    volunteers      = EXCLUDED.volunteers,
    prayer_requests = EXCLUDED.prayer_requests,
    updated_at      = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_upsert_journal(uuid,date,text,text,text,text,text,int,int,int,int,int,int,int,text,text) TO authenticated;


-- ─────────────────────────────────────────
-- [일지] 삭제
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_delete_journal(uuid);
CREATE OR REPLACE FUNCTION public.edu_delete_journal(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dept_id uuid;
BEGIN
  SELECT department_id INTO v_dept_id FROM public.edu_journals WHERE id = p_id;
  IF NOT public.is_edu_member_or_admin(v_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  DELETE FROM public.edu_journals WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_delete_journal(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [교사] 목록
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_list_teachers(uuid);
CREATE OR REPLACE FUNCTION public.edu_list_teachers(p_dept_id uuid)
RETURNS TABLE (
  id           uuid,
  name         text,
  teacher_role text,
  order_no     int,
  is_active    boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, teacher_role, order_no, is_active
  FROM public.edu_teachers
  WHERE department_id = p_dept_id
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY order_no, name;
$$;
GRANT EXECUTE ON FUNCTION public.edu_list_teachers(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [교사] 저장
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_save_teacher(uuid, uuid, text, text, int);
CREATE OR REPLACE FUNCTION public.edu_save_teacher(
  p_id          uuid,
  p_dept_id     uuid,
  p_name        text,
  p_role        text,
  p_order_no    int
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.edu_teachers (department_id, name, teacher_role, order_no)
    VALUES (p_dept_id, p_name, p_role, COALESCE(p_order_no, 0))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.edu_teachers
    SET name = p_name, teacher_role = p_role, order_no = COALESCE(p_order_no, 0)
    WHERE id = p_id AND department_id = p_dept_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_save_teacher(uuid, uuid, text, text, int) TO authenticated;


-- ─────────────────────────────────────────
-- [교사] 삭제
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_delete_teacher(uuid);
CREATE OR REPLACE FUNCTION public.edu_delete_teacher(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dept_id uuid;
BEGIN
  SELECT department_id INTO v_dept_id FROM public.edu_teachers WHERE id = p_id;
  IF NOT public.is_edu_member_or_admin(v_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  DELETE FROM public.edu_teachers WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_delete_teacher(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [교사출석] 월별 데이터 조회
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_get_teacher_attendance(uuid, int, int);
CREATE OR REPLACE FUNCTION public.edu_get_teacher_attendance(
  p_dept_id uuid,
  p_year    int,
  p_month   int
)
RETURNS TABLE (
  teacher_id   uuid,
  teacher_name text,
  teacher_role text,
  order_no     int,
  attend_date  date,
  is_present   boolean,
  note         text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    t.id AS teacher_id,
    t.name AS teacher_name,
    t.teacher_role,
    t.order_no,
    a.attend_date,
    a.is_present,
    a.note
  FROM public.edu_teachers t
  LEFT JOIN public.edu_teacher_attendance a
    ON a.teacher_id = t.id
    AND EXTRACT(YEAR FROM a.attend_date) = p_year
    AND EXTRACT(MONTH FROM a.attend_date) = p_month
  WHERE t.department_id = p_dept_id
    AND t.is_active = true
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY t.order_no, t.name, a.attend_date;
$$;
GRANT EXECUTE ON FUNCTION public.edu_get_teacher_attendance(uuid, int, int) TO authenticated;


-- ─────────────────────────────────────────
-- [교사출석] 출석 저장 (UPSERT)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_set_teacher_attendance(uuid, uuid, date, boolean, text);
CREATE OR REPLACE FUNCTION public.edu_set_teacher_attendance(
  p_teacher_id uuid,
  p_dept_id    uuid,
  p_date       date,
  p_present    boolean,
  p_note       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  INSERT INTO public.edu_teacher_attendance (teacher_id, dept_id, attend_date, is_present, note)
  VALUES (p_teacher_id, p_dept_id, p_date, p_present, p_note)
  ON CONFLICT (teacher_id, attend_date) DO UPDATE
    SET is_present = EXCLUDED.is_present, note = EXCLUDED.note;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_set_teacher_attendance(uuid, uuid, date, boolean, text) TO authenticated;


-- ─────────────────────────────────────────
-- [학생] 목록
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_list_students(uuid);
CREATE OR REPLACE FUNCTION public.edu_list_students(p_dept_id uuid)
RETURNS TABLE (
  id           uuid,
  student_no   int,
  name         text,
  student_type text,
  grade        text,
  is_active    boolean,
  order_no     int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, student_no, name, student_type, grade, is_active, order_no
  FROM public.edu_students
  WHERE department_id = p_dept_id
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY order_no, student_no, name;
$$;
GRANT EXECUTE ON FUNCTION public.edu_list_students(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [학생] 저장
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_save_student(uuid, uuid, int, text, text, text, int);
CREATE OR REPLACE FUNCTION public.edu_save_student(
  p_id         uuid,
  p_dept_id    uuid,
  p_no         int,
  p_name       text,
  p_type       text,
  p_grade      text,
  p_order_no   int
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.edu_students (department_id, student_no, name, student_type, grade, order_no)
    VALUES (p_dept_id, p_no, p_name, COALESCE(p_type,'정'), p_grade, COALESCE(p_order_no, 0))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.edu_students
    SET student_no = p_no, name = p_name, student_type = COALESCE(p_type,'정'),
        grade = p_grade, order_no = COALESCE(p_order_no, 0)
    WHERE id = p_id AND department_id = p_dept_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_save_student(uuid, uuid, int, text, text, text, int) TO authenticated;


-- ─────────────────────────────────────────
-- [학생] 삭제
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_delete_student(uuid);
CREATE OR REPLACE FUNCTION public.edu_delete_student(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dept_id uuid;
BEGIN
  SELECT department_id INTO v_dept_id FROM public.edu_students WHERE id = p_id;
  IF NOT public.is_edu_member_or_admin(v_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  DELETE FROM public.edu_students WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_delete_student(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [학생출석] 월별 데이터 조회
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_get_student_attendance(uuid, int, int);
CREATE OR REPLACE FUNCTION public.edu_get_student_attendance(
  p_dept_id uuid,
  p_year    int,
  p_month   int
)
RETURNS TABLE (
  student_id    uuid,
  student_no    int,
  student_name  text,
  student_type  text,
  order_no      int,
  attend_date   date,
  had_prayer    boolean,
  had_church_sch boolean,
  had_worship   boolean,
  had_lesson    boolean,
  had_bible     boolean,
  attend_status text,
  memo          text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id AS student_id,
    s.student_no,
    s.name AS student_name,
    s.student_type,
    s.order_no,
    a.attend_date,
    a.had_prayer,
    a.had_church_sch,
    a.had_worship,
    a.had_lesson,
    a.had_bible,
    a.attend_status,
    a.memo
  FROM public.edu_students s
  LEFT JOIN public.edu_student_attendance a
    ON a.student_id = s.id
    AND EXTRACT(YEAR FROM a.attend_date) = p_year
    AND EXTRACT(MONTH FROM a.attend_date) = p_month
  WHERE s.department_id = p_dept_id
    AND s.is_active = true
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY s.order_no, s.student_no, s.name, a.attend_date;
$$;
GRANT EXECUTE ON FUNCTION public.edu_get_student_attendance(uuid, int, int) TO authenticated;


-- ─────────────────────────────────────────
-- [학생출석] 저장 (UPSERT)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_set_student_attendance(uuid, uuid, date, boolean, boolean, boolean, boolean, boolean, text, text);
CREATE OR REPLACE FUNCTION public.edu_set_student_attendance(
  p_student_id    uuid,
  p_dept_id       uuid,
  p_date          date,
  p_prayer        boolean,
  p_church_sch    boolean,
  p_worship       boolean,
  p_lesson        boolean,
  p_bible         boolean,
  p_status        text,
  p_memo          text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  INSERT INTO public.edu_student_attendance (
    student_id, dept_id, attend_date,
    had_prayer, had_church_sch, had_worship, had_lesson, had_bible,
    attend_status, memo
  ) VALUES (
    p_student_id, p_dept_id, p_date,
    COALESCE(p_prayer, false), COALESCE(p_church_sch, false),
    COALESCE(p_worship, false), COALESCE(p_lesson, false), COALESCE(p_bible, false),
    COALESCE(p_status, '출'), p_memo
  )
  ON CONFLICT (student_id, attend_date) DO UPDATE SET
    had_prayer    = EXCLUDED.had_prayer,
    had_church_sch = EXCLUDED.had_church_sch,
    had_worship   = EXCLUDED.had_worship,
    had_lesson    = EXCLUDED.had_lesson,
    had_bible     = EXCLUDED.had_bible,
    attend_status = EXCLUDED.attend_status,
    memo          = EXCLUDED.memo;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_set_student_attendance(uuid,uuid,date,boolean,boolean,boolean,boolean,boolean,text,text) TO authenticated;


-- ─────────────────────────────────────────
-- [학생출결] 개별 학생 이력 조회
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_get_student_history(uuid, int, int, int, int);
CREATE OR REPLACE FUNCTION public.edu_get_student_history(
  p_student_id uuid,
  p_year_from  int,
  p_month_from int,
  p_year_to    int,
  p_month_to   int
)
RETURNS TABLE (
  attend_date    date,
  had_prayer     boolean,
  had_church_sch boolean,
  had_worship    boolean,
  had_lesson     boolean,
  had_bible      boolean,
  attend_status  text,
  memo           text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    a.attend_date, a.had_prayer, a.had_church_sch, a.had_worship,
    a.had_lesson, a.had_bible, a.attend_status, a.memo
  FROM public.edu_student_attendance a
  JOIN public.edu_students s ON s.id = a.student_id
  WHERE a.student_id = p_student_id
    AND public.is_edu_member_or_admin(s.department_id)
    AND (
      EXTRACT(YEAR FROM a.attend_date) * 100 + EXTRACT(MONTH FROM a.attend_date)
      BETWEEN p_year_from * 100 + p_month_from
          AND p_year_to * 100 + p_month_to
    )
  ORDER BY a.attend_date;
$$;
GRANT EXECUTE ON FUNCTION public.edu_get_student_history(uuid, int, int, int, int) TO authenticated;


-- ─────────────────────────────────────────
-- [새친구] 목록
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_list_new_friends(uuid);
CREATE OR REPLACE FUNCTION public.edu_list_new_friends(p_dept_id uuid)
RETURNS TABLE (
  id         uuid,
  name       text,
  gender     text,
  birth_date date,
  mobile     text,
  join_date  date,
  guide_name text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, gender, birth_date, mobile, join_date, guide_name, created_at
  FROM public.edu_new_friends
  WHERE department_id = p_dept_id
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.edu_list_new_friends(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [새친구] 단건 조회
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_get_new_friend(uuid);
CREATE OR REPLACE FUNCTION public.edu_get_new_friend(p_id uuid)
RETURNS TABLE (
  id              uuid,
  department_id   uuid,
  name            text,
  gender          text,
  birth_date      date,
  photo_url       text,
  phone           text,
  mobile          text,
  address         text,
  email           text,
  group_pa        text,
  group_jik       text,
  group_gun       text,
  group_cheo      text,
  family_name     text,
  guide_name      text,
  school_district text,
  join_date       date,
  special_notes   text,
  memo            text,
  created_at      timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.department_id, f.name, f.gender, f.birth_date, f.photo_url,
         f.phone, f.mobile, f.address, f.email,
         f.group_pa, f.group_jik, f.group_gun, f.group_cheo,
         f.family_name, f.guide_name, f.school_district,
         f.join_date, f.special_notes, f.memo, f.created_at
  FROM public.edu_new_friends f
  WHERE f.id = p_id
    AND public.is_edu_member_or_admin(f.department_id);
$$;
GRANT EXECUTE ON FUNCTION public.edu_get_new_friend(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [새친구] 저장
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_save_new_friend(uuid, uuid, text, text, date, text, text, text, text, text, text, text, text, text, text, text, text, date, text, text);
CREATE OR REPLACE FUNCTION public.edu_save_new_friend(
  p_id            uuid,
  p_dept_id       uuid,
  p_name          text,
  p_gender        text,
  p_birth_date    date,
  p_phone         text,
  p_mobile        text,
  p_address       text,
  p_email         text,
  p_group_pa      text,
  p_group_jik     text,
  p_group_gun     text,
  p_group_cheo    text,
  p_family_name   text,
  p_guide_name    text,
  p_school_dist   text,
  p_join_date     date,
  p_special       text,
  p_memo          text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.edu_new_friends (
      department_id, name, gender, birth_date, phone, mobile, address, email,
      group_pa, group_jik, group_gun, group_cheo, family_name, guide_name,
      school_district, join_date, special_notes, memo, created_by
    ) VALUES (
      p_dept_id, p_name, p_gender, p_birth_date, p_phone, p_mobile, p_address, p_email,
      p_group_pa, p_group_jik, p_group_gun, p_group_cheo, p_family_name, p_guide_name,
      p_school_dist, p_join_date, p_special, p_memo, auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.edu_new_friends SET
      name = p_name, gender = p_gender, birth_date = p_birth_date,
      phone = p_phone, mobile = p_mobile, address = p_address, email = p_email,
      group_pa = p_group_pa, group_jik = p_group_jik, group_gun = p_group_gun,
      group_cheo = p_group_cheo, family_name = p_family_name, guide_name = p_guide_name,
      school_district = p_school_dist, join_date = p_join_date,
      special_notes = p_special, memo = p_memo, updated_at = now()
    WHERE id = p_id AND department_id = p_dept_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_save_new_friend(uuid,uuid,text,text,date,text,text,text,text,text,text,text,text,text,text,text,date,text,text) TO authenticated;


-- ─────────────────────────────────────────
-- [새친구] 삭제
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_delete_new_friend(uuid);
CREATE OR REPLACE FUNCTION public.edu_delete_new_friend(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dept_id uuid;
BEGIN
  SELECT department_id INTO v_dept_id FROM public.edu_new_friends WHERE id = p_id;
  IF NOT public.is_edu_member_or_admin(v_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  DELETE FROM public.edu_new_friends WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_delete_new_friend(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [달란트] 학생별 합계 (요약)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_get_talent_summary(uuid);
CREATE OR REPLACE FUNCTION public.edu_get_talent_summary(p_dept_id uuid)
RETURNS TABLE (
  student_id     uuid,
  student_no     int,
  student_name   text,
  student_type   text,
  total_pts      bigint,
  pts_attendance bigint,
  pts_offering   bigint,
  pts_evangelism bigint,
  pts_memory     bigint,
  pts_win        bigint,
  pts_other      bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id AS student_id,
    s.student_no,
    s.name AS student_name,
    s.student_type,
    COALESCE(SUM(r.pts_attendance + r.pts_offering + r.pts_evangelism + r.pts_memory + r.pts_win + r.pts_other), 0) AS total_pts,
    COALESCE(SUM(r.pts_attendance), 0) AS pts_attendance,
    COALESCE(SUM(r.pts_offering), 0)   AS pts_offering,
    COALESCE(SUM(r.pts_evangelism), 0) AS pts_evangelism,
    COALESCE(SUM(r.pts_memory), 0)     AS pts_memory,
    COALESCE(SUM(r.pts_win), 0)        AS pts_win,
    COALESCE(SUM(r.pts_other), 0)      AS pts_other
  FROM public.edu_students s
  LEFT JOIN public.edu_talent_records r ON r.student_id = s.id AND r.department_id = p_dept_id
  WHERE s.department_id = p_dept_id
    AND s.is_active = true
    AND public.is_edu_member_or_admin(p_dept_id)
  GROUP BY s.id, s.student_no, s.name, s.student_type, s.order_no
  ORDER BY s.order_no, s.student_no, s.name;
$$;
GRANT EXECUTE ON FUNCTION public.edu_get_talent_summary(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [달란트] 학생 개인 기록
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_get_student_talent(uuid);
CREATE OR REPLACE FUNCTION public.edu_get_student_talent(p_student_id uuid)
RETURNS TABLE (
  id             uuid,
  record_date    date,
  pts_attendance int,
  pts_offering   int,
  pts_evangelism int,
  pts_memory     int,
  pts_win        int,
  pts_other      int,
  note           text,
  created_at     timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.record_date, r.pts_attendance, r.pts_offering,
         r.pts_evangelism, r.pts_memory, r.pts_win, r.pts_other,
         r.note, r.created_at
  FROM public.edu_talent_records r
  JOIN public.edu_students s ON s.id = r.student_id
  WHERE r.student_id = p_student_id
    AND public.is_edu_member_or_admin(s.department_id)
  ORDER BY r.record_date DESC;
$$;
GRANT EXECUTE ON FUNCTION public.edu_get_student_talent(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [달란트] 저장
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_save_talent(uuid, uuid, uuid, date, int, int, int, int, int, int, text);
CREATE OR REPLACE FUNCTION public.edu_save_talent(
  p_id          uuid,
  p_dept_id     uuid,
  p_student_id  uuid,
  p_date        date,
  p_attendance  int,
  p_offering    int,
  p_evangelism  int,
  p_memory      int,
  p_win         int,
  p_other       int,
  p_note        text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.edu_talent_records (
      department_id, student_id, record_date,
      pts_attendance, pts_offering, pts_evangelism, pts_memory, pts_win, pts_other,
      note, created_by
    ) VALUES (
      p_dept_id, p_student_id, p_date,
      COALESCE(p_attendance,0), COALESCE(p_offering,0), COALESCE(p_evangelism,0),
      COALESCE(p_memory,0), COALESCE(p_win,0), COALESCE(p_other,0),
      p_note, auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.edu_talent_records SET
      record_date     = p_date,
      pts_attendance  = COALESCE(p_attendance,0),
      pts_offering    = COALESCE(p_offering,0),
      pts_evangelism  = COALESCE(p_evangelism,0),
      pts_memory      = COALESCE(p_memory,0),
      pts_win         = COALESCE(p_win,0),
      pts_other       = COALESCE(p_other,0),
      note            = p_note
    WHERE id = p_id AND department_id = p_dept_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_save_talent(uuid,uuid,uuid,date,int,int,int,int,int,int,text) TO authenticated;


-- ─────────────────────────────────────────
-- [달란트] 삭제
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_delete_talent(uuid);
CREATE OR REPLACE FUNCTION public.edu_delete_talent(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dept_id uuid;
BEGIN
  SELECT department_id INTO v_dept_id FROM public.edu_talent_records WHERE id = p_id;
  IF NOT public.is_edu_member_or_admin(v_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  DELETE FROM public.edu_talent_records WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_delete_talent(uuid) TO authenticated;
