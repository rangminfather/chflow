-- =============================================================
-- 교회학교 일지: 예배 관련 필드 추가
-- 인도자 / 설교자 / 설교제목 / 성경본문 / 기도담당
-- (주보 PDF 자동 채움 대응)
-- =============================================================

ALTER TABLE public.edu_journals
  ADD COLUMN IF NOT EXISTS leader        text,   -- 인도자 (예배인도)
  ADD COLUMN IF NOT EXISTS preacher      text,   -- 설교자 (강론자)
  ADD COLUMN IF NOT EXISTS sermon_title  text,   -- 설교제목 (강론)
  ADD COLUMN IF NOT EXISTS scripture     text,   -- 본문 (성경봉독)
  ADD COLUMN IF NOT EXISTS prayer_lead   text;   -- 기도 담당 (반/사람)


-- ─────────────────────────────────────────
-- [일지] 단건 조회 (필드 추가 반영)
-- ─────────────────────────────────────────
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
  created_at      timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT j.id, j.department_id, j.journal_date, j.edu_topic,
         j.scripture, j.leader, j.preacher, j.sermon_title, j.prayer_lead,
         j.praise, j.joint_activity, j.lesson_content, j.events,
         j.stat_reg_male, j.stat_reg_female, j.stat_reg_total,
         j.stat_enrolled, j.stat_attend, j.stat_absent,
         j.offering, j.volunteers, j.prayer_requests, j.created_at
  FROM public.edu_journals j
  WHERE j.id = p_id
    AND public.is_edu_member_or_admin(j.department_id);
$$;
GRANT EXECUTE ON FUNCTION public.edu_get_journal(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- [일지] 저장 (UPSERT) — 필드 추가 반영
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_upsert_journal(uuid, date, text, text, text, text, text, int, int, int, int, int, int, int, text, text);
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
    department_id, journal_date, edu_topic,
    scripture, leader, preacher, sermon_title, prayer_lead,
    praise, joint_activity, lesson_content, events,
    stat_reg_male, stat_reg_female, stat_reg_total,
    stat_enrolled, stat_attend, stat_absent, offering,
    volunteers, prayer_requests, created_by, updated_at
  ) VALUES (
    p_dept_id, p_date, p_topic,
    p_scripture, p_leader, p_preacher, p_sermon_title, p_prayer_lead,
    p_praise, p_joint, p_lesson, p_events,
    COALESCE(p_reg_male,0), COALESCE(p_reg_female,0), COALESCE(p_reg_total,0),
    COALESCE(p_enrolled,0), COALESCE(p_attend,0), COALESCE(p_absent,0),
    COALESCE(p_offering,0), p_volunteers, p_prayer, auth.uid(), now()
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
    updated_at      = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_upsert_journal(uuid,date,text,text,text,text,text,text,text,text,text,text,int,int,int,int,int,int,int,text,text) TO authenticated;
