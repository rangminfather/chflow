-- 회원가입 신청 보완 정보:
-- 기존 성도는 누락/수정 요청 정보를 profiles에 보관하고 승인 시 members/households에 반영한다.
-- DB 미등록 신규 성도는 승인 시 members 및 필요 시 households를 생성한다.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signup_birth_date date,
  ADD COLUMN IF NOT EXISTS signup_gender text,
  ADD COLUMN IF NOT EXISTS signup_address text,
  ADD COLUMN IF NOT EXISTS signup_pasture_id uuid REFERENCES public.directory_pastures(id),
  ADD COLUMN IF NOT EXISTS signup_parent_member_id uuid REFERENCES public.members(id),
  ADD COLUMN IF NOT EXISTS signup_household_id uuid REFERENCES public.households(id),
  ADD COLUMN IF NOT EXISTS signup_guardian_name text,
  ADD COLUMN IF NOT EXISTS signup_guardian_phone text,
  ADD COLUMN IF NOT EXISTS signup_is_child boolean DEFAULT false;

DROP FUNCTION IF EXISTS public.list_signup_pastures();
CREATE OR REPLACE FUNCTION public.list_signup_pastures()
RETURNS TABLE (
  pasture_id uuid,
  pasture_name text,
  grassland_id uuid,
  grassland_name text,
  plain_id uuid,
  plain_name text,
  label text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    g.id,
    g.name,
    pl.id,
    COALESCE(pl.display_name, pl.name),
    COALESCE(pl.display_name, pl.name) || ' / ' || g.name || ' / ' || p.name
  FROM public.directory_pastures p
  JOIN public.grasslands g ON p.grassland_id = g.id
  JOIN public.plains pl ON g.plain_id = pl.id
  ORDER BY pl.order_no, g.order_no, p.order_no, p.name;
$$;
GRANT EXECUTE ON FUNCTION public.list_signup_pastures() TO anon, authenticated;

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
  has_account boolean,
  photo_url text,
  birth_date date,
  gender text,
  pasture_id uuid,
  grassland_id uuid,
  plain_id uuid
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
    p.name as pasture_name,
    g.name as grassland_name,
    COALESCE(pl.display_name, pl.name) as plain_name,
    COALESCE(h.address, m.address) as address,
    (m.app_user_id is not null) as has_account,
    m.photo_url,
    m.birth_date,
    m.gender,
    p.id as pasture_id,
    g.id as grassland_id,
    pl.id as plain_id
  FROM public.members m
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures p ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g ON p.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE m.status = 'active'
    AND m.name = p_name
    AND (
      m.phone = p_phone
      OR regexp_replace(coalesce(m.phone, ''), '\D', '', 'g')
         = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
    )
  LIMIT 5;
$$;
GRANT EXECUTE ON FUNCTION public.find_member_for_signup(text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.find_child_for_signup(text, text, text);
CREATE OR REPLACE FUNCTION public.find_child_for_signup(
  p_child_name text,
  p_parent_name text,
  p_parent_phone text
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
  has_account boolean,
  parent_id uuid,
  parent_name text,
  parent_phone text,
  photo_url text,
  birth_date date,
  gender text,
  pasture_id uuid,
  grassland_id uuid,
  plain_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_hh uuid;
  v_parent_id uuid;
  v_parent_name text;
  v_parent_phone text;
BEGIN
  SELECT m.id, m.household_id, m.name, m.phone
    INTO v_parent_id, v_parent_hh, v_parent_name, v_parent_phone
  FROM public.members m
  WHERE m.name = p_parent_name
    AND regexp_replace(coalesce(m.phone, ''), '\D', '', 'g')
        = regexp_replace(coalesce(p_parent_phone, ''), '\D', '', 'g')
    AND coalesce(m.is_child, false) = false
  LIMIT 1;

  IF v_parent_hh IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.phone,
    m.family_church,
    m.sub_role,
    m.spouse_name,
    m.household_id,
    p.name as pasture_name,
    g.name as grassland_name,
    COALESCE(pl.display_name, pl.name) as plain_name,
    COALESCE(h.address, m.address) as address,
    (m.app_user_id is not null) as has_account,
    v_parent_id as parent_id,
    v_parent_name as parent_name,
    v_parent_phone as parent_phone,
    m.photo_url,
    m.birth_date,
    m.gender,
    p.id as pasture_id,
    g.id as grassland_id,
    pl.id as plain_id
  FROM public.members m
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures p ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g ON p.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE m.household_id = v_parent_hh
    AND m.name = p_child_name
    AND coalesce(m.is_child, false) = true
  LIMIT 5;
END;
$$;
GRANT EXECUTE ON FUNCTION public.find_child_for_signup(text, text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.find_parent_for_child_signup(text, text);
CREATE OR REPLACE FUNCTION public.find_parent_for_child_signup(
  p_parent_name text,
  p_parent_phone text
)
RETURNS TABLE (
  parent_id uuid,
  parent_name text,
  parent_phone text,
  household_id uuid,
  pasture_name text,
  grassland_name text,
  plain_name text,
  address text,
  pasture_id uuid,
  grassland_id uuid,
  plain_id uuid
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
    m.household_id,
    p.name as pasture_name,
    g.name as grassland_name,
    COALESCE(pl.display_name, pl.name) as plain_name,
    h.address,
    p.id as pasture_id,
    g.id as grassland_id,
    pl.id as plain_id
  FROM public.members m
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures p ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g ON p.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE m.name = p_parent_name
    AND regexp_replace(coalesce(m.phone, ''), '\D', '', 'g')
        = regexp_replace(coalesce(p_parent_phone, ''), '\D', '', 'g')
    AND coalesce(m.is_child, false) = false
  LIMIT 5;
$$;
GRANT EXECUTE ON FUNCTION public.find_parent_for_child_signup(text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.admin_list_pending_signups();
CREATE OR REPLACE FUNCTION public.admin_list_pending_signups()
RETURNS TABLE (
  id uuid,
  username text,
  name text,
  phone text,
  role text,
  sub_role text,
  status text,
  created_at timestamptz,
  matched_member_id uuid,
  matched_member_name text,
  matched_pasture text,
  matched_plain text,
  signup_birth_date date,
  signup_gender text,
  signup_address text,
  signup_pasture text,
  signup_plain text,
  signup_is_child boolean,
  signup_guardian_name text,
  signup_guardian_phone text,
  signup_parent_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.username,
    p.name,
    p.phone,
    p.role,
    p.sub_role,
    p.status,
    p.created_at,
    m.id AS matched_member_id,
    m.name AS matched_member_name,
    COALESCE(req_pa.name, pa.name) AS matched_pasture,
    COALESCE(COALESCE(req_pl.display_name, req_pl.name), COALESCE(pl.display_name, pl.name)) AS matched_plain,
    p.signup_birth_date,
    p.signup_gender,
    p.signup_address,
    req_pa.name AS signup_pasture,
    COALESCE(req_pl.display_name, req_pl.name) AS signup_plain,
    COALESCE(p.signup_is_child, false),
    p.signup_guardian_name,
    p.signup_guardian_phone,
    parent.name AS signup_parent_name
  FROM public.profiles p
  LEFT JOIN public.members m ON m.app_user_id = p.id
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures pa ON h.pasture_id = pa.id
  LEFT JOIN public.grasslands g ON pa.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  LEFT JOIN public.directory_pastures req_pa ON p.signup_pasture_id = req_pa.id
  LEFT JOIN public.grasslands req_g ON req_pa.grassland_id = req_g.id
  LEFT JOIN public.plains req_pl ON req_g.plain_id = req_pl.id
  LEFT JOIN public.members parent ON p.signup_parent_member_id = parent.id
  WHERE p.status = 'pending'
  ORDER BY p.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_signups() TO authenticated;

DROP FUNCTION IF EXISTS public.approve_user(uuid, boolean);
CREATE OR REPLACE FUNCTION public.approve_user(p_user_id uuid, p_approved boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
  v_profile public.profiles%ROWTYPE;
  v_member_id uuid;
  v_household_id uuid;
BEGIN
  IF public.get_user_role() != 'admin' AND public.get_user_role() NOT IN ('office', 'pastor') THEN
    RAISE EXCEPTION '관리자만 승인할 수 있습니다';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  v_user_name := v_profile.name;

  IF p_approved THEN
    SELECT id, household_id INTO v_member_id, v_household_id
    FROM public.members
    WHERE app_user_id = p_user_id
    LIMIT 1;

    IF v_member_id IS NULL THEN
      v_household_id := v_profile.signup_household_id;

      IF v_household_id IS NULL THEN
        INSERT INTO public.households (pasture_id, address, home_phone, order_no)
        VALUES (v_profile.signup_pasture_id, COALESCE(v_profile.signup_address, ''), '', 0)
        RETURNING id INTO v_household_id;
      ELSIF v_profile.signup_address IS NOT NULL OR v_profile.signup_pasture_id IS NOT NULL THEN
        UPDATE public.households
        SET address = COALESCE(NULLIF(v_profile.signup_address, ''), address),
            pasture_id = COALESCE(v_profile.signup_pasture_id, pasture_id)
        WHERE id = v_household_id;
      END IF;

      INSERT INTO public.members (
        name, phone, birth_date, gender, address, household_id,
        family_church, sub_role, is_child, app_user_id, guard_status, status
      )
      VALUES (
        v_profile.name,
        v_profile.phone,
        v_profile.signup_birth_date,
        CASE v_profile.signup_gender
          WHEN '남' THEN 'M'
          WHEN '여' THEN 'F'
          ELSE v_profile.signup_gender
        END,
        v_profile.signup_address,
        v_household_id,
        CASE WHEN COALESCE(v_profile.signup_is_child, false) THEN '자녀' ELSE '목원' END,
        v_profile.sub_role,
        COALESCE(v_profile.signup_is_child, false),
        p_user_id,
        '회원',
        'active'
      )
      RETURNING id INTO v_member_id;
    ELSE
      UPDATE public.members
      SET phone = COALESCE(NULLIF(v_profile.phone, ''), phone),
          birth_date = COALESCE(v_profile.signup_birth_date, birth_date),
          gender = COALESCE(
            NULLIF(
              CASE v_profile.signup_gender
                WHEN '남' THEN 'M'
                WHEN '여' THEN 'F'
                ELSE v_profile.signup_gender
              END,
              ''
            ),
            gender
          ),
          address = COALESCE(NULLIF(v_profile.signup_address, ''), address),
          sub_role = COALESCE(NULLIF(v_profile.sub_role, ''), sub_role),
          guard_status = '회원'
      WHERE id = v_member_id;

      IF v_household_id IS NOT NULL AND (v_profile.signup_address IS NOT NULL OR v_profile.signup_pasture_id IS NOT NULL) THEN
        UPDATE public.households
        SET address = COALESCE(NULLIF(v_profile.signup_address, ''), address),
            pasture_id = COALESCE(v_profile.signup_pasture_id, pasture_id)
        WHERE id = v_household_id;
      END IF;
    END IF;

    IF COALESCE(v_profile.signup_is_child, false)
       AND v_member_id IS NOT NULL
       AND v_profile.signup_parent_member_id IS NOT NULL THEN
      INSERT INTO public.member_relations (subject_id, relative_id, kind, role, created_by)
      SELECT
        v_member_id,
        parent.id,
        'parent',
        CASE parent.gender WHEN 'M' THEN 'father' WHEN 'F' THEN 'mother' ELSE NULL END,
        auth.uid()
      FROM public.members parent
      WHERE parent.id = v_profile.signup_parent_member_id
        AND parent.id <> v_member_id
      ON CONFLICT (subject_id, relative_id, kind)
      DO UPDATE SET role = COALESCE(EXCLUDED.role, public.member_relations.role);
    END IF;

    UPDATE public.profiles
    SET member_id = v_member_id
    WHERE id = p_user_id;
  END IF;

  UPDATE public.profiles
  SET status = CASE WHEN p_approved THEN 'active' ELSE 'rejected' END,
      approved_at = now(),
      approved_by = auth.uid()
  WHERE id = p_user_id;

  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by, metadata)
  VALUES (
    p_user_id,
    CASE WHEN p_approved THEN 'signup_approved' ELSE 'signup_rejected' END,
    CASE WHEN p_approved THEN '🎉 회원가입 승인 완료'
         ELSE '❌ 회원가입 거절' END,
    CASE WHEN p_approved THEN '회원가입이 승인되었습니다. 이제 모든 서비스를 이용하실 수 있습니다.'
         ELSE '회원가입이 거절되었습니다. 자세한 사항은 관리자에게 문의하세요.' END,
    CASE WHEN p_approved THEN '/home' ELSE '/login' END,
    auth.uid(),
    jsonb_build_object('approved', p_approved)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_user(uuid, boolean) TO authenticated;
