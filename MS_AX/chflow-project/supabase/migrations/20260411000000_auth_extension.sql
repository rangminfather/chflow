-- =============================================================
-- 회원가입/로그인 기능 확장
-- =============================================================

-- profiles 테이블에 회원가입 관련 컬럼 추가
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS sub_role text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'
    CHECK (status IN ('pending','active','inactive','rejected')),
  ADD COLUMN IF NOT EXISTS failed_login_attempts int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS must_change_password boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id);

-- username 유니크 제약 (NULL 허용)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_unique
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles (status);
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles (phone);

-- =============================================================
-- 회원가입 RPC: username 중복 검사 (anon 가능)
-- =============================================================
CREATE OR REPLACE FUNCTION public.check_username_available(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = lower(p_username)
  );
$$;

GRANT EXECUTE ON FUNCTION public.check_username_available(text) TO anon, authenticated;

-- =============================================================
-- 아이디 찾기 RPC: 이름 + 전화번호로 username 조회
-- =============================================================
CREATE OR REPLACE FUNCTION public.find_username(p_name text, p_phone text)
RETURNS TABLE(username text, status text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT username, status, created_at
  FROM public.profiles
  WHERE name = p_name
    AND phone = p_phone
    AND username IS NOT NULL
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.find_username(text, text) TO anon, authenticated;

-- =============================================================
-- 사용자 상태 조회 RPC (로그인 후 사용)
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_my_status()
RETURNS TABLE(
  id uuid,
  username text,
  name text,
  phone text,
  role text,
  sub_role text,
  status text,
  must_change_password boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, username, name, phone, role, sub_role, status, must_change_password
  FROM public.profiles
  WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_status() TO authenticated;

-- =============================================================
-- 회원가입 RPC: 새 프로필 생성 (signup 직후 호출)
-- =============================================================
CREATE OR REPLACE FUNCTION public.create_profile_on_signup(
  p_username text,
  p_name text,
  p_phone text,
  p_role text,
  p_sub_role text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다';
  END IF;

  -- username 중복 체크
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(p_username)) THEN
    RAISE EXCEPTION '이미 사용 중인 아이디입니다';
  END IF;

  -- profile insert (auth.users는 이미 생성됨)
  INSERT INTO public.profiles (id, username, name, phone, role, sub_role, status, email)
  VALUES (
    v_user_id,
    lower(p_username),
    p_name,
    p_phone,
    p_role,
    p_sub_role,
    'pending',
    (SELECT email FROM auth.users WHERE id = v_user_id)
  )
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    sub_role = EXCLUDED.sub_role,
    status = 'pending';

  RETURN v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_profile_on_signup(text, text, text, text, text) TO authenticated;

-- =============================================================
-- 관리자: 가입 승인/반려
-- =============================================================
CREATE OR REPLACE FUNCTION public.approve_user(p_user_id uuid, p_approved boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() != 'admin' THEN
    RAISE EXCEPTION '관리자만 승인할 수 있습니다';
  END IF;

  UPDATE public.profiles
  SET status = CASE WHEN p_approved THEN 'active' ELSE 'rejected' END,
      approved_at = now(),
      approved_by = auth.uid()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_user(uuid, boolean) TO authenticated;

-- =============================================================
-- profiles 정책 추가: 자신의 프로필 INSERT 허용 (회원가입용)
-- (기존 profiles_insert_own 정책이 있으므로 SKIP)
-- =============================================================

-- 관리자가 모든 profile UPDATE 가능 (승인용)
CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
