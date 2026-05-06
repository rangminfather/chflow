-- 마이페이지(/myinfo) 용 RPC
-- 본인 정보 조회 + 연락처(전화/주소) 본인 수정

-- =============================================================
-- 1. 마이페이지용 전체 프로필 조회
-- =============================================================
DROP FUNCTION IF EXISTS public.get_my_profile_full();
CREATE OR REPLACE FUNCTION public.get_my_profile_full()
RETURNS TABLE (
  -- 계정 정보
  user_id uuid,
  username text,
  role text,
  status text,
  approved_at timestamptz,
  must_change_password boolean,
  -- 회원 정보
  member_id uuid,
  name text,
  phone text,
  birth_date date,
  gender text,
  family_church text,
  sub_role text,
  spouse_name text,
  is_child boolean,
  photo_url text,
  -- 가구/소속
  household_id uuid,
  address text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  -- 검수
  review_status text,
  review_note text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.id, p.username, p.role, p.status, p.approved_at, p.must_change_password,
    m.id, m.name, COALESCE(p.phone, m.phone), m.birth_date, m.gender,
    m.family_church, COALESCE(p.sub_role, m.sub_role), m.spouse_name, m.is_child, m.photo_url,
    m.household_id, h.address,
    pa.name, g.name, pl.name,
    m.review_status, m.review_note
  FROM public.profiles p
  LEFT JOIN public.members m ON m.app_user_id = p.id
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures pa ON h.pasture_id = pa.id
  LEFT JOIN public.grasslands g ON pa.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE p.id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.get_my_profile_full() TO authenticated;

-- =============================================================
-- 2. 본인 연락처(전화·주소) 수정
--    phone NULL 또는 빈값 → 변경 안 함, 비어있게 만들고 싶으면 별도 처리
-- =============================================================
DROP FUNCTION IF EXISTS public.update_my_contact(text, text);
CREATE OR REPLACE FUNCTION public.update_my_contact(
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_member_id uuid;
  v_household_id uuid;
  v_phone text := NULLIF(TRIM(p_phone), '');
  v_address text := NULLIF(TRIM(p_address), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;

  -- 핸드폰 형식 검증 (입력 시에만)
  IF v_phone IS NOT NULL AND v_phone !~ '^01[016789]-?[0-9]{3,4}-?[0-9]{4}$' THEN
    RAISE EXCEPTION '핸드폰 번호 형식이 올바르지 않습니다 (예: 010-1234-5678)';
  END IF;

  -- 회원 / 가구 ID 조회
  SELECT m.id, m.household_id INTO v_member_id, v_household_id
  FROM public.members m WHERE m.app_user_id = v_uid;

  -- 핸드폰: profiles + members 동기화
  IF p_phone IS NOT NULL THEN
    UPDATE public.profiles SET phone = v_phone WHERE id = v_uid;
    IF v_member_id IS NOT NULL THEN
      UPDATE public.members SET phone = v_phone WHERE id = v_member_id;
    END IF;
  END IF;

  -- 주소: households 갱신 (가구 전체 영향)
  IF p_address IS NOT NULL THEN
    IF v_household_id IS NULL THEN
      RAISE EXCEPTION '소속 가구가 없습니다. 관리자에게 문의하세요.';
    END IF;
    UPDATE public.households SET address = v_address WHERE id = v_household_id;
  END IF;

  RETURN jsonb_build_object(
    'phone', v_phone,
    'address', v_address,
    'household_id', v_household_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_my_contact(text, text) TO authenticated;
