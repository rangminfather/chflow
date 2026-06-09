-- list_dept_grade_members: ORDER BY 에서 role_label 컬럼이 PL/pgSQL 변수와 충돌
-- "column reference role_label is ambiguous" 오류 수정
-- → merged.role_label 로 테이블 한정자 지정

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
    -- 1) edu_teachers 기반
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

    -- 2) department_members 중 edu_teachers 에 없는 회원
    SELECT
      NULL::uuid                                        AS teacher_id,
      dm.user_id,
      COALESCE(mem.name, u.email)::text                AS name,
      dm.member_role::text                             AS role_label,
      dm.grade::smallint,
      true                                             AS has_dm,
      true                                             AS has_app
    FROM public.department_members dm
    LEFT JOIN auth.users       u   ON u.id            = dm.user_id
    LEFT JOIN public.members   mem ON mem.app_user_id = dm.user_id
    WHERE dm.department_id = p_dept_id
      AND dm.status        = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM public.edu_teachers t2
        WHERE  t2.department_id = p_dept_id
          AND  t2.user_id       = dm.user_id
          AND  t2.is_active     = true
      )
  ) merged
  ORDER BY
    merged.has_app DESC,
    CASE merged.role_label
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
    merged.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_dept_grade_members(uuid) TO authenticated;
