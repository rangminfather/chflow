-- =============================================================
-- 부서원 임명 (Appoint) — 회원검색 기반
--   1. edu_teachers.member_id 컬럼 추가 (members FK)
--   2. admin_appoint_dept_member RPC: 부서원으로 직접 임명
--   3. dept_search_members_for_appoint RPC: 임명 대상 회원 검색
--      (시스템 admin/office/pastor 또는 부서 grade 0~1 만 호출 가능)
-- =============================================================

-- ─────────────────────────────────────────
-- 1. edu_teachers.member_id 컬럼 추가
-- ─────────────────────────────────────────
ALTER TABLE public.edu_teachers
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_edu_teachers_member ON public.edu_teachers(member_id);


-- ─────────────────────────────────────────
-- 2. 임명 권한 헬퍼: caller가 grade 0~1 또는 시스템 admin/office/pastor 인지
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_appoint_in_dept(p_dept_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.get_user_role() IN ('admin', 'office', 'pastor')
    OR EXISTS (
      SELECT 1 FROM public.department_members
      WHERE department_id = p_dept_id
        AND user_id = auth.uid()
        AND status = 'approved'
        AND grade <= 1
    )
$$;
GRANT EXECUTE ON FUNCTION public.can_appoint_in_dept(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 3. 회원검색 (임명용) — 부서 임명자(grade 0~1) 또는 시스템 admin
--    이름으로 검색, 앱 가입(app_user_id) 있는 회원만 반환
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.dept_search_members_for_appoint(uuid, text);
CREATE OR REPLACE FUNCTION public.dept_search_members_for_appoint(
  p_dept_id uuid,
  p_query   text
)
RETURNS TABLE (
  member_id      uuid,
  app_user_id    uuid,
  name           text,
  phone          text,
  gender         text,
  birth_date     date,
  photo_url      text,
  sub_role       text,
  pasture_name   text,
  grassland_name text,
  plain_name     text,
  already_member boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_appoint_in_dept(p_dept_id) THEN
    RAISE EXCEPTION '임명 권한이 없습니다 (요구: 부서 grade 0~1 또는 시스템 관리자)';
  END IF;
  IF p_query IS NULL OR length(trim(p_query)) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id          AS member_id,
    m.app_user_id,
    m.name,
    m.phone,
    m.gender,
    m.birth_date,
    m.photo_url,
    m.sub_role,
    p.name        AS pasture_name,
    g.name        AS grassland_name,
    pl.name       AS plain_name,
    EXISTS (
      SELECT 1 FROM public.department_members dm
      WHERE dm.department_id = p_dept_id
        AND dm.user_id = m.app_user_id
        AND dm.status = 'approved'
    ) AS already_member
  FROM public.members m
  LEFT JOIN public.households h         ON m.household_id = h.id
  LEFT JOIN public.directory_pastures p ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g         ON p.grassland_id = g.id
  LEFT JOIN public.plains pl            ON g.plain_id = pl.id
  WHERE m.app_user_id IS NOT NULL
    AND (m.name ILIKE '%' || p_query || '%' OR m.phone ILIKE '%' || p_query || '%')
  ORDER BY m.name
  LIMIT 20;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dept_search_members_for_appoint(uuid, text) TO authenticated;


-- ─────────────────────────────────────────
-- 4. 임명 RPC: department_members + edu_teachers(교육사역국이면) + 알림
--    p_grade: 0~4 (전도사/부장/부부장/교사/학부모)
--    p_teacher_role: edu 부서일 때 직분 라벨 ('부장','부부장','총무','서기','교사','학부모')
--                    NULL이면 grade 기준으로 자동 매핑
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_appoint_dept_member(uuid, uuid, smallint, text);
CREATE OR REPLACE FUNCTION public.admin_appoint_dept_member(
  p_dept_id      uuid,
  p_member_id    uuid,
  p_grade        smallint,
  p_teacher_role text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app_user_id   uuid;
  v_member_name   text;
  v_dept_name     text;
  v_dept_category text;
  v_dm_id         uuid;
  v_role_label    text;
BEGIN
  -- 권한 체크
  IF NOT public.can_appoint_in_dept(p_dept_id) THEN
    RAISE EXCEPTION '임명 권한이 없습니다';
  END IF;
  IF p_grade IS NULL OR p_grade < 0 OR p_grade > 4 THEN
    RAISE EXCEPTION 'grade는 0~4 이어야 합니다';
  END IF;

  -- 회원 정보 조회
  SELECT m.app_user_id, m.name INTO v_app_user_id, v_member_name
  FROM public.members m
  WHERE m.id = p_member_id;

  IF v_member_name IS NULL THEN
    RAISE EXCEPTION '회원을 찾을 수 없습니다';
  END IF;
  IF v_app_user_id IS NULL THEN
    RAISE EXCEPTION '회원이 앱 가입을 하지 않은 상태입니다 (먼저 앱 가입 필요)';
  END IF;

  -- 부서 정보
  SELECT name, category INTO v_dept_name, v_dept_category
  FROM public.departments WHERE id = p_dept_id;

  -- 직분 라벨 결정
  v_role_label := COALESCE(
    NULLIF(trim(p_teacher_role), ''),
    CASE p_grade
      WHEN 0 THEN '전도사'
      WHEN 1 THEN '부장'
      WHEN 2 THEN '부부장'
      WHEN 3 THEN '교사'
      WHEN 4 THEN '학부모'
    END
  );

  -- department_members upsert (status='approved', grade)
  INSERT INTO public.department_members (
    department_id, user_id, member_role, status, grade,
    requested_at, approved_at, approved_by
  ) VALUES (
    p_dept_id, v_app_user_id, v_role_label, 'approved', p_grade,
    now(), now(), auth.uid()
  )
  ON CONFLICT (department_id, user_id) DO UPDATE
    SET status      = 'approved',
        grade       = EXCLUDED.grade,
        member_role = EXCLUDED.member_role,
        approved_at = now(),
        approved_by = auth.uid()
  RETURNING id INTO v_dm_id;

  -- 교육사역국이면 edu_teachers에도 upsert
  IF v_dept_category = '교육사역국' THEN
    -- 같은 member_id의 row가 있으면 업데이트, 없으면 insert
    IF EXISTS (
      SELECT 1 FROM public.edu_teachers
      WHERE department_id = p_dept_id AND member_id = p_member_id
    ) THEN
      UPDATE public.edu_teachers
        SET name         = v_member_name,
            user_id      = v_app_user_id,
            teacher_role = v_role_label,
            is_active    = true
        WHERE department_id = p_dept_id AND member_id = p_member_id;
    ELSE
      INSERT INTO public.edu_teachers (
        department_id, member_id, user_id, name, teacher_role, is_active
      ) VALUES (
        p_dept_id, p_member_id, v_app_user_id, v_member_name, v_role_label, true
      );
    END IF;
  END IF;

  -- 본인에게 알림
  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
  VALUES (
    v_app_user_id,
    'dept_appointed',
    '🎖️ 부서 임명',
    v_dept_category || ' ' || v_dept_name || ' ' || v_role_label || '(으)로 임명되셨습니다',
    '/departments/d/' || p_dept_id::text,
    auth.uid()
  );

  RETURN v_dm_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_appoint_dept_member(uuid, uuid, smallint, text) TO authenticated;
