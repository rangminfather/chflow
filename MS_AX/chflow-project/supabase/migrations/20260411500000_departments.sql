-- =============================================================
-- 사역/부서 시스템
-- =============================================================

-- 1. 부서 마스터
CREATE TABLE IF NOT EXISTS public.departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category    text NOT NULL,            -- 대분류 (교육사역국, 예배사역국 등)
  name        text NOT NULL,            -- 부서명 (유치부, 초등1부 등)
  description text,
  icon        text,                      -- 이모지 또는 아이콘
  order_no    int DEFAULT 0,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (category, name)
);

-- 2. 부서 가입 (사용자 ↔ 부서)
CREATE TABLE IF NOT EXISTS public.department_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   uuid REFERENCES public.departments(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  member_role     text DEFAULT 'member',     -- member, leader, deputy
  status          text DEFAULT 'pending'     -- pending, approved, rejected
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at    timestamptz DEFAULT now(),
  approved_at     timestamptz,
  approved_by     uuid REFERENCES auth.users(id),
  UNIQUE (department_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dept_members_user ON public.department_members(user_id, status);
CREATE INDEX IF NOT EXISTS idx_dept_members_dept ON public.department_members(department_id, status);

-- 3. RLS
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dept_select_all" ON public.departments;
CREATE POLICY "dept_select_all"
  ON public.departments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "dept_write_admin" ON public.departments;
CREATE POLICY "dept_write_admin"
  ON public.departments FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'office'))
  WITH CHECK (public.get_user_role() IN ('admin', 'office'));

DROP POLICY IF EXISTS "dept_members_select_own_or_admin" ON public.department_members;
CREATE POLICY "dept_members_select_own_or_admin"
  ON public.department_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.get_user_role() IN ('admin', 'office', 'pastor')
  );

DROP POLICY IF EXISTS "dept_members_insert_self" ON public.department_members;
CREATE POLICY "dept_members_insert_self"
  ON public.department_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "dept_members_update_admin" ON public.department_members;
CREATE POLICY "dept_members_update_admin"
  ON public.department_members FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'office', 'pastor'))
  WITH CHECK (public.get_user_role() IN ('admin', 'office', 'pastor'));


-- =============================================================
-- 초기 데이터: 교육사역국 + 3개 부서
-- =============================================================
INSERT INTO public.departments (category, name, description, icon, order_no)
VALUES
  ('교육사역국', '유치부',  '5~7세 어린이 사역', '👶', 1),
  ('교육사역국', '초등1부', '초등 1~3학년 사역', '🧒', 2),
  ('교육사역국', '초등2부', '초등 4~6학년 사역', '🎒', 3)
ON CONFLICT (category, name) DO NOTHING;


-- =============================================================
-- RPC: 카테고리 목록
-- =============================================================
DROP FUNCTION IF EXISTS public.get_department_categories();
CREATE OR REPLACE FUNCTION public.get_department_categories()
RETURNS TABLE (category text, dept_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT category, COUNT(*) AS dept_count
  FROM public.departments
  WHERE is_active = true
  GROUP BY category
  ORDER BY MIN(order_no), category;
$$;
GRANT EXECUTE ON FUNCTION public.get_department_categories() TO authenticated;


-- =============================================================
-- RPC: 카테고리 내 부서 목록 (현재 사용자의 가입 상태 포함)
-- =============================================================
DROP FUNCTION IF EXISTS public.get_departments_by_category(text);
CREATE OR REPLACE FUNCTION public.get_departments_by_category(p_category text)
RETURNS TABLE (
  id uuid,
  category text,
  name text,
  description text,
  icon text,
  order_no int,
  member_count bigint,
  my_status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    d.id,
    d.category,
    d.name,
    d.description,
    d.icon,
    d.order_no,
    (SELECT COUNT(*) FROM public.department_members dm WHERE dm.department_id = d.id AND dm.status = 'approved') AS member_count,
    (SELECT status FROM public.department_members dm WHERE dm.department_id = d.id AND dm.user_id = auth.uid() LIMIT 1) AS my_status
  FROM public.departments d
  WHERE d.category = p_category AND d.is_active = true
  ORDER BY d.order_no, d.name;
$$;
GRANT EXECUTE ON FUNCTION public.get_departments_by_category(text) TO authenticated;


-- =============================================================
-- RPC: 내가 가입한 부서 목록 (사이드바용)
-- =============================================================
DROP FUNCTION IF EXISTS public.get_my_departments();
CREATE OR REPLACE FUNCTION public.get_my_departments()
RETURNS TABLE (
  id uuid,
  department_id uuid,
  category text,
  name text,
  icon text,
  status text,
  member_role text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    dm.id,
    d.id AS department_id,
    d.category,
    d.name,
    d.icon,
    dm.status,
    dm.member_role
  FROM public.department_members dm
  JOIN public.departments d ON dm.department_id = d.id
  WHERE dm.user_id = auth.uid()
  ORDER BY d.category, d.order_no;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_departments() TO authenticated;


-- =============================================================
-- RPC: 부서 정보 조회 (부서 메인 페이지용)
-- =============================================================
DROP FUNCTION IF EXISTS public.get_department_info(uuid);
CREATE OR REPLACE FUNCTION public.get_department_info(p_dept_id uuid)
RETURNS TABLE (
  id uuid,
  category text,
  name text,
  description text,
  icon text,
  member_count bigint,
  is_member boolean,
  my_status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    d.id,
    d.category,
    d.name,
    d.description,
    d.icon,
    (SELECT COUNT(*) FROM public.department_members dm WHERE dm.department_id = d.id AND dm.status = 'approved') AS member_count,
    EXISTS (SELECT 1 FROM public.department_members dm WHERE dm.department_id = d.id AND dm.user_id = auth.uid() AND dm.status = 'approved') AS is_member,
    (SELECT status FROM public.department_members dm WHERE dm.department_id = d.id AND dm.user_id = auth.uid() LIMIT 1) AS my_status
  FROM public.departments d
  WHERE d.id = p_dept_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_department_info(uuid) TO authenticated;


-- =============================================================
-- RPC: 부서 가입 신청
-- =============================================================
DROP FUNCTION IF EXISTS public.request_department_join(uuid);
CREATE OR REPLACE FUNCTION public.request_department_join(p_dept_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_existing_status text;
  v_join_id uuid;
  v_dept_name text;
  v_dept_category text;
  v_user_name text;
  v_admin_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;

  -- 이미 신청/가입했는지 확인
  SELECT status INTO v_existing_status
  FROM public.department_members
  WHERE department_id = p_dept_id AND user_id = v_user_id;

  IF v_existing_status = 'approved' THEN
    RAISE EXCEPTION '이미 가입된 부서입니다';
  ELSIF v_existing_status = 'pending' THEN
    RAISE EXCEPTION '이미 가입 신청 중입니다';
  ELSIF v_existing_status = 'rejected' THEN
    -- 거절됐던 경우 다시 신청 가능 (status 업데이트)
    UPDATE public.department_members
    SET status = 'pending', requested_at = now(), approved_at = NULL, approved_by = NULL
    WHERE department_id = p_dept_id AND user_id = v_user_id
    RETURNING id INTO v_join_id;
  ELSE
    -- 신규 신청
    INSERT INTO public.department_members (department_id, user_id, status)
    VALUES (p_dept_id, v_user_id, 'pending')
    RETURNING id INTO v_join_id;
  END IF;

  -- 관리자에게 알림 발송
  SELECT name, category INTO v_dept_name, v_dept_category FROM public.departments WHERE id = p_dept_id;
  SELECT name INTO v_user_name FROM public.profiles WHERE id = v_user_id;

  FOR v_admin_id IN
    SELECT id FROM public.profiles WHERE role IN ('admin', 'office', 'pastor') AND status = 'active'
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
    VALUES (
      v_admin_id,
      'dept_join_request',
      '🏢 부서 가입 신청',
      v_user_name || '님이 ' || v_dept_category || ' / ' || v_dept_name || ' 가입을 신청했습니다',
      '/admin/dept-pending',
      v_user_id
    );
  END LOOP;

  RETURN v_join_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_department_join(uuid) TO authenticated;


-- =============================================================
-- RPC: 관리자 - 부서 가입 신청 목록
-- =============================================================
DROP FUNCTION IF EXISTS public.admin_list_dept_pending();
CREATE OR REPLACE FUNCTION public.admin_list_dept_pending()
RETURNS TABLE (
  id uuid,
  department_id uuid,
  user_id uuid,
  user_name text,
  user_phone text,
  user_role text,
  user_sub_role text,
  category text,
  dept_name text,
  dept_icon text,
  requested_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    dm.id,
    dm.department_id,
    dm.user_id,
    p.name,
    p.phone,
    p.role,
    p.sub_role,
    d.category,
    d.name,
    d.icon,
    dm.requested_at
  FROM public.department_members dm
  JOIN public.departments d ON dm.department_id = d.id
  JOIN public.profiles p ON dm.user_id = p.id
  WHERE dm.status = 'pending'
  ORDER BY dm.requested_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_dept_pending() TO authenticated;


-- =============================================================
-- RPC: 관리자 - 부서 가입 승인/거절
-- =============================================================
DROP FUNCTION IF EXISTS public.admin_approve_dept_join(uuid, boolean);
CREATE OR REPLACE FUNCTION public.admin_approve_dept_join(p_join_id uuid, p_approved boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_dept_id uuid;
  v_dept_name text;
  v_dept_category text;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  -- 정보 조회
  SELECT dm.user_id, dm.department_id, d.name, d.category
  INTO v_user_id, v_dept_id, v_dept_name, v_dept_category
  FROM public.department_members dm
  JOIN public.departments d ON dm.department_id = d.id
  WHERE dm.id = p_join_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '신청을 찾을 수 없습니다';
  END IF;

  -- 상태 업데이트
  UPDATE public.department_members
  SET status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
      approved_at = now(),
      approved_by = auth.uid()
  WHERE id = p_join_id;

  -- 신청자에게 알림
  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by)
  VALUES (
    v_user_id,
    CASE WHEN p_approved THEN 'dept_join_approved' ELSE 'dept_join_rejected' END,
    CASE WHEN p_approved THEN '✅ 부서 가입 승인'
         ELSE '❌ 부서 가입 거절' END,
    CASE WHEN p_approved THEN v_dept_category || ' ' || v_dept_name || ' 가입이 승인되었습니다!'
         ELSE v_dept_category || ' ' || v_dept_name || ' 가입이 거절되었습니다' END,
    CASE WHEN p_approved THEN '/departments/d/' || v_dept_id::text ELSE '/home' END,
    auth.uid()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_approve_dept_join(uuid, boolean) TO authenticated;
