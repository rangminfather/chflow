-- Split signup/member/household addresses into searchable base address and user-entered detail.
-- Keep the existing address columns as compatibility fields for current screens and RPCs.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signup_address_base text,
  ADD COLUMN IF NOT EXISTS signup_address_detail text,
  ADD COLUMN IF NOT EXISTS signup_address_zonecode text;

ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS address_base text,
  ADD COLUMN IF NOT EXISTS address_detail text,
  ADD COLUMN IF NOT EXISTS address_zonecode text;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS address_base text,
  ADD COLUMN IF NOT EXISTS address_detail text,
  ADD COLUMN IF NOT EXISTS address_zonecode text;

UPDATE public.households
SET address_base = address
WHERE address_base IS NULL AND address IS NOT NULL;

UPDATE public.members
SET address_base = address
WHERE address_base IS NULL AND address IS NOT NULL;

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
  v_address_base text;
  v_address_detail text;
  v_address_zonecode text;
  v_full_address text;
BEGIN
  IF public.get_user_role() != 'admin' AND public.get_user_role() NOT IN ('office', 'pastor') THEN
    RAISE EXCEPTION '관리자만 승인할 수 있습니다';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  v_user_name := v_profile.name;

  v_address_base := NULLIF(trim(COALESCE(v_profile.signup_address_base, '')), '');
  v_address_detail := NULLIF(trim(COALESCE(v_profile.signup_address_detail, '')), '');
  v_address_zonecode := NULLIF(trim(COALESCE(v_profile.signup_address_zonecode, '')), '');
  v_full_address := NULLIF(trim(COALESCE(v_profile.signup_address, concat_ws(' ', v_address_base, v_address_detail))), '');

  IF p_approved THEN
    SELECT id, household_id INTO v_member_id, v_household_id
    FROM public.members
    WHERE app_user_id = p_user_id
    LIMIT 1;

    IF v_member_id IS NULL THEN
      v_household_id := v_profile.signup_household_id;

      IF v_household_id IS NULL THEN
        INSERT INTO public.households (
          pasture_id, address, address_base, address_detail, address_zonecode, home_phone, order_no
        )
        VALUES (
          v_profile.signup_pasture_id,
          COALESCE(v_full_address, ''),
          COALESCE(v_address_base, v_full_address),
          v_address_detail,
          v_address_zonecode,
          '',
          0
        )
        RETURNING id INTO v_household_id;
      ELSIF v_full_address IS NOT NULL OR v_profile.signup_pasture_id IS NOT NULL THEN
        UPDATE public.households
        SET address = COALESCE(v_full_address, address),
            address_base = COALESCE(v_address_base, address_base),
            address_detail = COALESCE(v_address_detail, address_detail),
            address_zonecode = COALESCE(v_address_zonecode, address_zonecode),
            pasture_id = COALESCE(v_profile.signup_pasture_id, pasture_id)
        WHERE id = v_household_id;
      END IF;

      INSERT INTO public.members (
        name, phone, birth_date, gender,
        address, address_base, address_detail, address_zonecode, household_id,
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
        v_full_address,
        COALESCE(v_address_base, v_full_address),
        v_address_detail,
        v_address_zonecode,
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
          address = COALESCE(v_full_address, address),
          address_base = COALESCE(v_address_base, address_base),
          address_detail = COALESCE(v_address_detail, address_detail),
          address_zonecode = COALESCE(v_address_zonecode, address_zonecode),
          sub_role = COALESCE(NULLIF(v_profile.sub_role, ''), sub_role),
          guard_status = '회원'
      WHERE id = v_member_id;

      IF v_household_id IS NOT NULL AND (v_full_address IS NOT NULL OR v_profile.signup_pasture_id IS NOT NULL) THEN
        UPDATE public.households
        SET address = COALESCE(v_full_address, address),
            address_base = COALESCE(v_address_base, address_base),
            address_detail = COALESCE(v_address_detail, address_detail),
            address_zonecode = COALESCE(v_address_zonecode, address_zonecode),
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
