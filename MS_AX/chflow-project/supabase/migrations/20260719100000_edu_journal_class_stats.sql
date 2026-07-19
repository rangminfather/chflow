-- =============================================================
-- 교회학교 일지: 반별 출결표 (자동집계 + 스냅샷)
--   종이 일지의 "반별 출결계" 를 디지털화.
--   - edu_journals.class_stats (jsonb): 저장 시점의 반별 스냅샷
--   - edu_journal_class_rollup(dept, date): 기존 출결/달란트에서 반별 자동집계
--   - edu_get_journal / edu_upsert_journal 에 class_stats 반영
--
-- 집계 매핑 (반별) — 컬럼: 재적/출석/결석/인도/모범/요절/과제/성경/퀴즈
--   재적   = 활성 학생 수 (edu_students.is_active, class_no)
--   출석   = attend_status IN ('출','인')   (출석 + 출석인정)
--   결석   = attend_status = '결'
--   인도   = pts_evangelism > 0 인 학생 수 (전도/인도)
--   요절   = pts_memory     > 0 인 학생 수 (요절암송)
--   과제   = had_lesson  = true 인 학생 수 (공과숙제)
--   성경   = had_bible   = true 인 학생 수 (성경읽기/성경책)
--   모범 / 퀴즈 = 대응 데이터 없음 → 자동집계에서 제외(UI 에서 0, 교사 수동 입력)
--   ※ 표는 UI 에서 편집 가능. 자동집계는 채움 편의이며 저장값은 스냅샷.
-- =============================================================

-- 1) 스냅샷 컬럼
ALTER TABLE public.edu_journals
  ADD COLUMN IF NOT EXISTS class_stats jsonb;


-- 2) 반별 자동집계 RPC
DROP FUNCTION IF EXISTS public.edu_journal_class_rollup(uuid, date);
CREATE OR REPLACE FUNCTION public.edu_journal_class_rollup(
  p_dept_id uuid,
  p_date    date
)
RETURNS TABLE (
  class_no   text,
  enrolled   int,
  attend     int,
  absent     int,
  lead       int,   -- 인도(전도)
  memory     int,   -- 요절(암송)
  lesson     int,   -- 과제(공과)
  bible      int    -- 성경(성경읽기)
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '접근 권한이 없습니다';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT s.id, s.class_no
    FROM public.edu_students s
    WHERE s.department_id = p_dept_id
      AND s.is_active = true
      AND coalesce(trim(s.class_no), '') <> ''
  ),
  classes AS (
    -- 레지스트리 ∪ 학생기반 반 (학생 없는 빈 반도 표시)
    SELECT u.class_no, min(u.sort_order) AS sort_order
    FROM (
      SELECT c.class_no, c.sort_order
      FROM public.edu_classes c
      WHERE c.department_id = p_dept_id
      UNION ALL
      SELECT DISTINCT r.class_no, 999 AS sort_order
      FROM roster r
    ) u
    GROUP BY u.class_no
  ),
  reg AS (
    SELECT r.class_no, count(*)::int AS enrolled
    FROM roster r
    GROUP BY r.class_no
  ),
  att AS (
    SELECT r.class_no,
      count(*) FILTER (WHERE a.attend_status IN ('출','인'))::int AS attend,
      count(*) FILTER (WHERE a.attend_status = '결')::int        AS absent,
      count(*) FILTER (WHERE a.had_lesson)::int                  AS lesson,
      count(*) FILTER (WHERE a.had_bible)::int                   AS bible
    FROM roster r
    JOIN public.edu_student_attendance a
      ON a.student_id = r.id AND a.attend_date = p_date
    GROUP BY r.class_no
  ),
  tal AS (
    SELECT r.class_no,
      count(*) FILTER (WHERE t.pts_evangelism > 0)::int AS lead,
      count(*) FILTER (WHERE t.pts_memory     > 0)::int AS memory
    FROM roster r
    JOIN public.edu_talent_records t
      ON t.student_id = r.id AND t.record_date = p_date
    GROUP BY r.class_no
  )
  SELECT
    c.class_no,
    coalesce(reg.enrolled, 0),
    coalesce(att.attend, 0),
    coalesce(att.absent, 0),
    coalesce(tal.lead, 0),
    coalesce(tal.memory, 0),
    coalesce(att.lesson, 0),
    coalesce(att.bible, 0)
  FROM classes c
  LEFT JOIN reg ON reg.class_no = c.class_no
  LEFT JOIN att ON att.class_no = c.class_no
  LEFT JOIN tal ON tal.class_no = c.class_no
  ORDER BY c.sort_order, c.class_no;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_journal_class_rollup(uuid, date) TO authenticated;


-- 3) 단건 조회 재정의 (class_stats 추가)
DROP FUNCTION IF EXISTS public.edu_get_journal(uuid);
CREATE OR REPLACE FUNCTION public.edu_get_journal(p_id uuid)
RETURNS TABLE (
  id              uuid,
  department_id   uuid,
  journal_date    date,
  edu_topic       text,
  scripture       text,
  leader          text,
  preacher        text,
  sermon_title    text,
  prayer_lead     text,
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
  class_stats     jsonb,
  created_at      timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT j.id, j.department_id, j.journal_date, j.edu_topic,
         j.scripture, j.leader, j.preacher, j.sermon_title, j.prayer_lead,
         j.praise, j.joint_activity, j.lesson_content, j.events,
         j.stat_reg_male, j.stat_reg_female, j.stat_reg_total,
         j.stat_enrolled, j.stat_attend, j.stat_absent,
         j.offering, j.volunteers, j.prayer_requests, j.class_stats, j.created_at
  FROM public.edu_journals j
  WHERE j.id = p_id
    AND public.is_edu_member_or_admin(j.department_id);
$$;
GRANT EXECUTE ON FUNCTION public.edu_get_journal(uuid) TO authenticated;


-- 4) 저장(UPSERT) 재정의 (p_class_stats 추가)
DROP FUNCTION IF EXISTS public.edu_upsert_journal(uuid, date, text, text, text, text, text, text, text, text, text, text, int, int, int, int, int, int, int, text, text);
CREATE OR REPLACE FUNCTION public.edu_upsert_journal(
  p_dept_id       uuid,
  p_date          date,
  p_topic         text,
  p_scripture     text,
  p_leader        text,
  p_preacher      text,
  p_sermon_title  text,
  p_prayer_lead   text,
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
  p_prayer        text,
  p_class_stats   jsonb DEFAULT NULL
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
    department_id, journal_date, edu_topic,
    scripture, leader, preacher, sermon_title, prayer_lead,
    praise, joint_activity, lesson_content, events,
    stat_reg_male, stat_reg_female, stat_reg_total,
    stat_enrolled, stat_attend, stat_absent, offering,
    volunteers, prayer_requests, class_stats, created_by, updated_at
  ) VALUES (
    p_dept_id, p_date, p_topic,
    p_scripture, p_leader, p_preacher, p_sermon_title, p_prayer_lead,
    p_praise, p_joint, p_lesson, p_events,
    COALESCE(p_reg_male,0), COALESCE(p_reg_female,0), COALESCE(p_reg_total,0),
    COALESCE(p_enrolled,0), COALESCE(p_attend,0), COALESCE(p_absent,0),
    COALESCE(p_offering,0), p_volunteers, p_prayer, p_class_stats, auth.uid(), now()
  )
  ON CONFLICT (department_id, journal_date) DO UPDATE SET
    edu_topic       = EXCLUDED.edu_topic,
    scripture       = EXCLUDED.scripture,
    leader          = EXCLUDED.leader,
    preacher        = EXCLUDED.preacher,
    sermon_title    = EXCLUDED.sermon_title,
    prayer_lead     = EXCLUDED.prayer_lead,
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
    class_stats     = EXCLUDED.class_stats,
    updated_at      = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_upsert_journal(uuid,date,text,text,text,text,text,text,text,text,text,text,int,int,int,int,int,int,int,text,text,jsonb) TO authenticated;
