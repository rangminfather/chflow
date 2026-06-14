-- =============================================================
-- 보안 H-1: edu 학생별 쓰기 RPC에 "내 반 + 등급" 권한 검증
-- 2026-06-13 / 보안성 검토 3차 조치
--
-- 문제: 출석/달란트/주간추가 RPC가 is_edu_member_or_admin(부서 승인멤버면 통과)
--       만 검사 → 같은 부서면 학부모(grade 4)·다른 반 교사도 임의 학생의
--       출석·달란트를 위변조 가능했음. (등급·반 무관)
--
-- 조치: 공통 헬퍼 edu_can_edit_student(dept, student) 도입.
--       - grade 0~2 (관리자/부장/총무/서기): 부서 내 전체 학생 가능
--       - grade 3   (교사): 본인 담당 반 학생만 (edu_students.teacher_id =
--                    내 edu_teachers.id) — api/edu/my-class-student 라우트와 동일 기준
--       - grade 4 (학부모) / 99 (비회원): 불가
--       출석/달란트/주간추가 3개 RPC의 가드를 이 헬퍼로 교체(본문은 동일).
--
-- ⚠️ 동작 변경: 기존엔 부서원 누구나 아무 학생을 편집할 수 있었음.
--    적용 후 교사는 "내 반"만 편집 가능(= "내 반 출결" 화면의 의도된 동작).
--    배포 전 정상교사/학부모/타반 교사 시나리오로 행동 검증 필요.
--
-- 재적용 안전(OR REPLACE). 반환 시그니처·본문 로직은 기존과 동일, 가드만 강화.
-- =============================================================

-- 공통 권한 헬퍼: 호출자가 해당 학생을 편집할 수 있는가
CREATE OR REPLACE FUNCTION public.edu_can_edit_student(p_dept_id uuid, p_student_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grade smallint;
BEGIN
  v_grade := public.get_user_grade(p_dept_id);

  -- 관리자/부장/총무/서기(0~2): 부서 내 전체 학생 편집 가능
  IF v_grade <= 2 THEN
    RETURN true;
  END IF;

  -- 교사(3): 본인이 담임인 반 학생만
  IF v_grade = 3 THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.edu_teachers t
      JOIN public.edu_students s ON s.teacher_id = t.id
      WHERE t.department_id = p_dept_id
        AND t.user_id = auth.uid()
        AND t.is_active = true
        AND s.id = p_student_id
        AND s.department_id = p_dept_id
    );
  END IF;

  -- 학부모(4)/비회원(99): 불가
  RETURN false;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_can_edit_student(uuid, uuid) TO authenticated;


-- 1) 출석 입력 ───────────────────────────────────────────────
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
  IF NOT public.edu_can_edit_student(p_dept_id, p_student_id) THEN
    RAISE EXCEPTION '담당 반 학생만 수정할 수 있습니다';
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


-- 2) 달란트 저장 ─────────────────────────────────────────────
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
  IF NOT public.edu_can_edit_student(p_dept_id, p_student_id) THEN
    RAISE EXCEPTION '담당 반 학생만 수정할 수 있습니다';
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


-- 3) 달란트 주간 항목 토글 ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.toggle_weekly_extra(
  p_student_id uuid,
  p_dept_id    uuid,
  p_date       date,
  p_rule_id    uuid,
  p_checked    boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.edu_can_edit_student(p_dept_id, p_student_id) THEN
    RAISE EXCEPTION '담당 반 학생만 수정할 수 있습니다';
  END IF;

  IF p_checked THEN
    INSERT INTO public.edu_weekly_extra (student_id, department_id, attend_date, rule_id, checked)
    VALUES (p_student_id, p_dept_id, p_date, p_rule_id, true)
    ON CONFLICT (student_id, attend_date, rule_id) DO UPDATE
      SET checked = true;
  ELSE
    DELETE FROM public.edu_weekly_extra
      WHERE student_id = p_student_id AND attend_date = p_date AND rule_id = p_rule_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.toggle_weekly_extra(uuid, uuid, date, uuid, boolean) TO authenticated;
