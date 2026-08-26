-- =============================================================
-- 학부모(등급 4) 부서원은 교사·담임이 될 수 없다 — DB 레벨 차단
--
-- 배경:
--   담임메뉴는 "담임 배정 있음 + 등급 <= 3" 일 때만 노출되는데(화면 규칙),
--   서버 쪽에는 등급 4 를 막는 조건이 없어 경로에 따라 학부모가 교사 로스터에
--   올라가거나 담임으로 지정될 수 있었다.
--     - merge_placeholder_teacher : 대상 등급을 전혀 보지 않음
--     - edu_link_teacher_account  : status='approved' 만 보고 grade 는 안 봄
--     - set_class_homeroom_teacher / bulk_assign_class_teacher
--                                 : edu_teachers.is_active 만 보고 grade 는 안 봄
--   (list_dept_eligible_for_teacher 의 dm.grade <= 3 은 후보 '목록' 필터일 뿐이라
--    RPC 를 직접 호출하면 우회된다)
--
-- 조치:
--   함수 본문을 갈아끼우는 대신 트리거로 막는다. 경로가 여러 개(RPC 4개 + 직접
--   SQL)라 진입점마다 조건을 복사하면 새 경로가 생길 때 또 새는데, 트리거는
--   테이블에 한 번만 걸면 모든 경로를 덮는다. 다른 세션이 같은 함수들을 손대고
--   있어도 충돌하지 않는다는 이점도 있다.
--
--   1) edu_teachers  : 활성 교사 행을 등급 4 계정에 연결하는 것을 거부
--   2) edu_classes   : 정/부담임을 등급 4 교사로 지정하는 것을 거부
--   3) edu_students  : 학생 담당교사를 등급 4 교사로 지정하는 것을 거부
--
-- 판정 기준은 기존 표준을 그대로 쓴다 — public.edu_is_roster_grade(grade)
-- (0~3 이면 교사 가능). 부서원 행이 없거나(placeholder 교사) status 가
-- approved 가 아니면 판정 대상이 아니므로 통과시킨다. 즉 지금 동작에서
-- 새로 막히는 것은 '승인된 등급 4 부서원' 한 가지뿐이다.
--
-- 등급을 4 로 내리는 경로(upsert_member_grade → edu_sync_roster_member)는
-- edu_teachers.is_active 를 false 로 내리므로 트리거에 걸리지 않는다.
-- =============================================================

-- 교사 행이 가리키는 앱 계정의 해당 부서 등급 (없으면 NULL) -----------
CREATE OR REPLACE FUNCTION public.edu_teacher_dept_grade(p_teacher_id uuid)
RETURNS smallint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dm.grade
  FROM public.edu_teachers t
  LEFT JOIN public.members m ON m.id = t.member_id
  JOIN public.department_members dm
    ON dm.department_id = t.department_id
   AND dm.user_id = coalesce(t.user_id, m.app_user_id)
  WHERE t.id = p_teacher_id
    AND dm.status = 'approved'
  LIMIT 1
$$;
-- 내부 helper — REST 로 직접 호출될 이유가 없다
REVOKE ALL ON FUNCTION public.edu_teacher_dept_grade(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edu_teacher_dept_grade(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.edu_teacher_dept_grade(uuid) TO service_role;


-- 1) 교사 로스터: 등급 4 계정 연결 거부 -------------------------------
CREATE OR REPLACE FUNCTION public.edu_teachers_block_parent_grade()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid;
  v_grade smallint;
BEGIN
  IF NOT coalesce(NEW.is_active, false) THEN
    RETURN NEW;                       -- 명단에서 내려간 행은 검사하지 않는다
  END IF;

  v_uid := NEW.user_id;
  IF v_uid IS NULL AND NEW.member_id IS NOT NULL THEN
    SELECT m.app_user_id INTO v_uid FROM public.members m WHERE m.id = NEW.member_id;
  END IF;
  IF v_uid IS NULL THEN
    RETURN NEW;                       -- 계정 없는 placeholder 교사는 그대로 허용
  END IF;

  SELECT dm.grade INTO v_grade
  FROM public.department_members dm
  WHERE dm.department_id = NEW.department_id
    AND dm.user_id = v_uid
    AND dm.status = 'approved'
  LIMIT 1;

  IF v_grade IS NOT NULL AND NOT public.edu_is_roster_grade(v_grade) THEN
    RAISE EXCEPTION '학부모 등급(4) 부서원은 교사 명단에 올릴 수 없습니다. 먼저 직책·등급을 교사(3) 이상으로 바꿔 주세요';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_edu_teachers_block_parent_grade ON public.edu_teachers;
CREATE TRIGGER trg_edu_teachers_block_parent_grade
  BEFORE INSERT OR UPDATE ON public.edu_teachers
  FOR EACH ROW EXECUTE FUNCTION public.edu_teachers_block_parent_grade();


-- 2) 반 담임(정·부): 등급 4 교사 지정 거부 ----------------------------
CREATE OR REPLACE FUNCTION public.edu_classes_block_parent_homeroom()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_grade smallint;
BEGIN
  IF NEW.teacher_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.teacher_id IS DISTINCT FROM OLD.teacher_id) THEN
    v_grade := public.edu_teacher_dept_grade(NEW.teacher_id);
    IF v_grade IS NOT NULL AND NOT public.edu_is_roster_grade(v_grade) THEN
      RAISE EXCEPTION '학부모 등급(4) 부서원은 담임으로 지정할 수 없습니다';
    END IF;
  END IF;

  IF NEW.assistant_teacher_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assistant_teacher_id IS DISTINCT FROM OLD.assistant_teacher_id) THEN
    v_grade := public.edu_teacher_dept_grade(NEW.assistant_teacher_id);
    IF v_grade IS NOT NULL AND NOT public.edu_is_roster_grade(v_grade) THEN
      RAISE EXCEPTION '학부모 등급(4) 부서원은 부담임으로 지정할 수 없습니다';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_edu_classes_block_parent_homeroom ON public.edu_classes;
CREATE TRIGGER trg_edu_classes_block_parent_homeroom
  BEFORE INSERT OR UPDATE ON public.edu_classes
  FOR EACH ROW EXECUTE FUNCTION public.edu_classes_block_parent_homeroom();


-- 3) 학생 담당교사: 등급 4 교사 지정 거부 -----------------------------
CREATE OR REPLACE FUNCTION public.edu_students_block_parent_teacher()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_grade smallint;
BEGIN
  IF NEW.teacher_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.teacher_id IS DISTINCT FROM OLD.teacher_id) THEN
    v_grade := public.edu_teacher_dept_grade(NEW.teacher_id);
    IF v_grade IS NOT NULL AND NOT public.edu_is_roster_grade(v_grade) THEN
      RAISE EXCEPTION '학부모 등급(4) 부서원은 학생 담당교사로 지정할 수 없습니다';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_edu_students_block_parent_teacher ON public.edu_students;
CREATE TRIGGER trg_edu_students_block_parent_teacher
  BEFORE INSERT OR UPDATE ON public.edu_students
  FOR EACH ROW EXECUTE FUNCTION public.edu_students_block_parent_teacher();
