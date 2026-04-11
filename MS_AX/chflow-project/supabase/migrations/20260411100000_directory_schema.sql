-- =============================================================
-- 명성교회 요람 DB 확장
-- 평원 → 초원 → 목장 → 가족 → 회원 4단계 계층
-- =============================================================

-- 1. 평원 (Plains)
CREATE TABLE IF NOT EXISTS public.plains (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,        -- '1', '2', '3', '젊은이'
  display_name text,                         -- '1평원', '젊은이평원'
  order_no     int DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);

-- 2. 초원 (Grasslands)
CREATE TABLE IF NOT EXISTS public.grasslands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plain_id   uuid REFERENCES public.plains(id) ON DELETE CASCADE,
  name       text NOT NULL,                  -- '캄보디아', '신위식'
  order_no   int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (plain_id, name)
);

-- 3. 목장 (Pastures)
CREATE TABLE IF NOT EXISTS public.directory_pastures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grassland_id   uuid REFERENCES public.grasslands(id) ON DELETE CASCADE,
  name           text NOT NULL,              -- 보통 목자 이름
  order_no       int DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  UNIQUE (grassland_id, name)
);

-- 4. 가족 (Households)
CREATE TABLE IF NOT EXISTS public.households (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pasture_id  uuid REFERENCES public.directory_pastures(id) ON DELETE CASCADE,
  address     text,
  home_phone  text,
  order_no    int DEFAULT 0,                 -- 목장 내 순번
  created_at  timestamptz DEFAULT now()
);

-- 5. members 테이블 확장 (이미 있는 테이블)
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS household_id uuid REFERENCES public.households(id),
  ADD COLUMN IF NOT EXISTS family_church text,           -- '목자','목녀','목부','목원'
  ADD COLUMN IF NOT EXISTS spouse_id uuid REFERENCES public.members(id),
  ADD COLUMN IF NOT EXISTS spouse_name text,             -- 매칭 못한 경우
  ADD COLUMN IF NOT EXISTS guard_status text DEFAULT '비회원',  -- '회원'/'비회원'
  ADD COLUMN IF NOT EXISTS source_page int,              -- PDF 페이지
  ADD COLUMN IF NOT EXISTS app_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS is_child boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sub_role text;                -- 직분 (시무집사, 권사 등)

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_members_household ON public.members(household_id);
CREATE INDEX IF NOT EXISTS idx_members_phone     ON public.members(phone);
CREATE INDEX IF NOT EXISTS idx_members_name_phone ON public.members(name, phone);
CREATE INDEX IF NOT EXISTS idx_members_app_user  ON public.members(app_user_id) WHERE app_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_members_guard     ON public.members(guard_status);

CREATE INDEX IF NOT EXISTS idx_grasslands_plain  ON public.grasslands(plain_id);
CREATE INDEX IF NOT EXISTS idx_pastures_grass    ON public.directory_pastures(grassland_id);
CREATE INDEX IF NOT EXISTS idx_households_pasture ON public.households(pasture_id);

-- =============================================================
-- 회원가입 매칭 RPC: 이름 + 휴대폰으로 회원 찾기
-- =============================================================
DROP FUNCTION IF EXISTS public.find_member_for_signup(text, text);
CREATE OR REPLACE FUNCTION public.find_member_for_signup(
  p_name text,
  p_phone text
)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  family_church text,
  sub_role text,
  spouse_name text,
  household_id uuid,
  pasture_name text,
  grassland_name text,
  plain_name text,
  address text,
  has_account boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.name,
    m.phone,
    m.family_church,
    m.sub_role,
    m.spouse_name,
    m.household_id,
    p.name AS pasture_name,
    g.name AS grassland_name,
    pl.name AS plain_name,
    h.address,
    (m.app_user_id IS NOT NULL) AS has_account
  FROM public.members m
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures p ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g ON p.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE m.name = p_name
    AND (
      m.phone = p_phone
      OR REPLACE(REPLACE(m.phone, '-', ''), ' ', '') = REPLACE(REPLACE(p_phone, '-', ''), ' ', '')
    )
  LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION public.find_member_for_signup(text, text) TO anon, authenticated;


-- =============================================================
-- 가입 시 회원-앱 계정 연결 RPC
-- =============================================================
CREATE OR REPLACE FUNCTION public.link_member_to_signup(
  p_member_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다';
  END IF;

  UPDATE public.members
  SET app_user_id = auth.uid(),
      guard_status = '회원'
  WHERE id = p_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_member_to_signup(uuid) TO authenticated;


-- =============================================================
-- 관리자: 회원 검색
-- =============================================================
CREATE OR REPLACE FUNCTION public.admin_search_members(
  p_query text DEFAULT NULL,
  p_plain text DEFAULT NULL,
  p_grassland text DEFAULT NULL,
  p_pasture text DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  family_church text,
  sub_role text,
  spouse_name text,
  address text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  guard_status text,
  has_account boolean,
  source_page int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id, m.name, m.phone, m.family_church, m.sub_role, m.spouse_name,
    h.address,
    p.name AS pasture_name,
    g.name AS grassland_name,
    pl.name AS plain_name,
    m.guard_status,
    (m.app_user_id IS NOT NULL) AS has_account,
    m.source_page
  FROM public.members m
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures p ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g ON p.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE
    (p_query IS NULL OR m.name ILIKE '%' || p_query || '%' OR m.phone ILIKE '%' || p_query || '%')
    AND (p_plain IS NULL OR pl.name = p_plain)
    AND (p_grassland IS NULL OR g.name = p_grassland)
    AND (p_pasture IS NULL OR p.name = p_pasture)
  ORDER BY pl.order_no, g.order_no, p.order_no, h.order_no, m.name
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.admin_search_members(text, text, text, text, int) TO authenticated;


-- =============================================================
-- 관리자: 회원 정보 수정
-- =============================================================
CREATE OR REPLACE FUNCTION public.admin_update_member(
  p_member_id uuid,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_family_church text DEFAULT NULL,
  p_sub_role text DEFAULT NULL,
  p_spouse_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  UPDATE public.members SET
    name = COALESCE(p_name, name),
    phone = COALESCE(p_phone, phone),
    family_church = COALESCE(p_family_church, family_church),
    sub_role = COALESCE(p_sub_role, sub_role),
    spouse_name = COALESCE(p_spouse_name, spouse_name)
  WHERE id = p_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_member(uuid, text, text, text, text, text) TO authenticated;


-- =============================================================
-- RLS 정책
-- =============================================================
ALTER TABLE public.plains              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grasslands          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directory_pastures  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.households          ENABLE ROW LEVEL SECURITY;

-- 모두 인증된 사용자가 읽기 가능
CREATE POLICY "plains_select_all"
  ON public.plains FOR SELECT TO authenticated USING (true);

CREATE POLICY "grasslands_select_all"
  ON public.grasslands FOR SELECT TO authenticated USING (true);

CREATE POLICY "pastures_select_all"
  ON public.directory_pastures FOR SELECT TO authenticated USING (true);

CREATE POLICY "households_select_all"
  ON public.households FOR SELECT TO authenticated USING (true);

-- 관리자/사무는 쓰기 가능
CREATE POLICY "plains_write_admin"
  ON public.plains FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'office'))
  WITH CHECK (public.get_user_role() IN ('admin', 'office'));

CREATE POLICY "grasslands_write_admin"
  ON public.grasslands FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'office'))
  WITH CHECK (public.get_user_role() IN ('admin', 'office'));

CREATE POLICY "pastures_write_admin"
  ON public.directory_pastures FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'office'))
  WITH CHECK (public.get_user_role() IN ('admin', 'office'));

CREATE POLICY "households_write_admin"
  ON public.households FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'office'))
  WITH CHECK (public.get_user_role() IN ('admin', 'office'));
