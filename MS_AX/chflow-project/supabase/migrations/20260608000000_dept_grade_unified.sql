-- 부서원 등급관리 개선
-- list_dept_grade_members: edu_teachers + department_members 통합 목록
-- upsert_member_grade: department_members 없으면 자동 생성

-- ─────────────────────────────────────────
-- 1. 통합 멤버 목록 (교사 명단 기반 + 앱 가입자 병합)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.list_dept_grade_members(uuid);
CREATE OR REPLACE FUNCTION public.list_dept_grade_members(p_dept_id uuid)
RETURNS TABLE (
  teacher_id  uuid,
  user_id     uuid,
  name        text,
  role_label  text,
  grade       smallint,
  has_dm      boolean,
  has_app     boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_grade smallint;
BEGIN
  v_my_grade := public.get_user_grade(p_dept_id);
  IF v_my_grade > 1 THEN
    RAISE EXCEPTION 'permission denied (요구 등급: 0~1)';
  END IF;

  RETURN QUERY
  SELECT * FROM (
    -- 1) edu_teachers 기반 (교육사역국 부서)
    SELECT
      t.id                                              AS teacher_id,
      t.user_id,
      t.name,
      COALESCE(dm.member_role, t.teacher_role)::text   AS role_label,
      COALESCE(
        dm.grade,
        CASE t.teacher_role
          WHEN '전도사' THEN 0
          WHEN '교육사' THEN 0
          WHEN '부장'   THEN 1
          WHEN '부부장' THEN 2
          WHEN '총무'   THEN 2
          WHEN '서기'   THEN 2
          WHEN '학부모' THEN 4
          ELSE 3
        END
      )::smallint                                       AS grade,
      (dm.id IS NOT NULL)                               AS has_dm,
      (t.user_id IS NOT NULL)                           AS has_app
    FROM public.edu_teachers t
    LEFT JOIN public.department_members dm
      ON  dm.department_id = p_dept_id
      AND dm.user_id       = t.user_id
      AND dm.status        = 'approved'
    WHERE t.department_id = p_dept_id
      AND t.is_active     = true

    UNION ALL

    -- 2) department_members 중 edu_teachers에 없는 회원 (일반 부서 or 직접 앱 가입)
    SELECT
      NULL::uuid                                        AS teacher_id,
      dm.user_id,
      COALESCE(mem.name, u.email)::text                AS name,
      dm.member_role::text                             AS role_label,
      dm.grade::smallint,
      true                                             AS has_dm,
      true                                             AS has_app
    FROM public.department_members dm
    LEFT JOIN auth.users       u   ON u.id           = dm.user_id
    LEFT JOIN public.members   mem ON mem.app_user_id = dm.user_id
    WHERE dm.department_id = p_dept_id
      AND NOT EXISTS (
        SELECT 1 FROM public.edu_teachers t2
        WHERE  t2.department_id = p_dept_id
          AND  t2.user_id       = dm.user_id
          AND  t2.is_active     = true
      )
  ) merged
  ORDER BY
    CASE role_label
      WHEN '전도사' THEN 0
      WHEN '교육사' THEN 0
      WHEN '부장'   THEN 1
      WHEN '부부장' THEN 2
      WHEN '총무'   THEN 3
      WHEN '서기'   THEN 4
      WHEN '교사'   THEN 7
      WHEN '학부모' THEN 8
      ELSE 9
    END,
    name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_dept_grade_members(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 2. 등급 upsert (department_members 없으면 approved 로 자동 생성)
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.upsert_member_grade(uuid, uuid, smallint);
CREATE OR REPLACE FUNCTION public.upsert_member_grade(
  p_dept_id  uuid,
  p_user_id  uuid,
  p_grade    smallint
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_grade   smallint;
  v_role_label text;
BEGIN
  IF p_grade < 0 OR p_grade > 4 THEN
    RAISE EXCEPTION 'grade must be 0~4';
  END IF;
  v_my_grade := public.get_user_grade(p_dept_id);
  IF v_my_grade > 1 THEN
    RAISE EXCEPTION 'permission denied (요구 등급: 0~1)';
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
    SET grade       = EXCLUDED.grade,
        member_role = EXCLUDED.member_role,
        approved_at = now(),
        approved_by = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_member_grade(uuid, uuid, smallint) TO authenticated;
