-- =============================================================
-- admin_update_member / admin_create_member 확장: "어디에도 소속 안 둠" 지원
--   - p_clear_household: 현재 household 에서 빼고 어디에도 두지 않음 (NULL)
--   - admin_create_member: household_id / pasture_id 둘 다 NULL 허용 (소속 미정 회원)
-- =============================================================

-- 수정 RPC: clear_household 추가
DROP FUNCTION IF EXISTS public.admin_update_member(uuid, text, text, text, text, text, text, boolean, uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_update_member(uuid, text, text, text, text, text, text, boolean, uuid, uuid, boolean);
CREATE OR REPLACE FUNCTION public.admin_update_member(
  p_member_id        uuid,
  p_name             text DEFAULT NULL,
  p_phone            text DEFAULT NULL,
  p_family_church    text DEFAULT NULL,
  p_sub_role         text DEFAULT NULL,
  p_spouse_name      text DEFAULT NULL,
  p_gender           text DEFAULT NULL,
  p_is_child         boolean DEFAULT NULL,
  p_household_id     uuid DEFAULT NULL,
  p_split_pasture_id uuid DEFAULT NULL,
  p_clear_household  boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old_hh    uuid;
  v_new_hh    uuid;
  v_remaining int;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF (p_household_id IS NOT NULL)::int + (p_split_pasture_id IS NOT NULL)::int + (p_clear_household IS TRUE)::int > 1 THEN
    RAISE EXCEPTION '가족 합류 / 신규 가족 분리 / 소속 빼기 중 하나만 지정할 수 있습니다';
  END IF;

  -- household 이동 처리
  IF p_household_id IS NOT NULL OR p_split_pasture_id IS NOT NULL OR p_clear_household IS TRUE THEN
    SELECT household_id INTO v_old_hh FROM public.members WHERE id = p_member_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '해당 회원을 찾을 수 없습니다';
    END IF;

    IF p_clear_household IS TRUE THEN
      v_new_hh := NULL;  -- 어디에도 소속 안 둠
    ELSIF p_household_id IS NOT NULL THEN
      v_new_hh := p_household_id;
      PERFORM 1 FROM public.households WHERE id = v_new_hh;
      IF NOT FOUND THEN
        RAISE EXCEPTION '대상 가족(household)을 찾을 수 없습니다';
      END IF;
    ELSE
      INSERT INTO public.households (pasture_id, address, home_phone, order_no)
      VALUES (p_split_pasture_id, '', '', 0)
      RETURNING id INTO v_new_hh;
    END IF;

    IF v_old_hh IS DISTINCT FROM v_new_hh THEN
      UPDATE public.members SET household_id = v_new_hh WHERE id = p_member_id;

      -- 기존 가족 비었으면 정리
      IF v_old_hh IS NOT NULL THEN
        SELECT COUNT(*) INTO v_remaining FROM public.members WHERE household_id = v_old_hh;
        IF v_remaining = 0 THEN
          DELETE FROM public.households WHERE id = v_old_hh;
        END IF;
      END IF;
    END IF;
  END IF;

  -- 기본 필드 업데이트
  UPDATE public.members SET
    name          = COALESCE(p_name, name),
    phone         = COALESCE(p_phone, phone),
    family_church = COALESCE(p_family_church, family_church),
    sub_role      = COALESCE(p_sub_role, sub_role),
    spouse_name   = COALESCE(p_spouse_name, spouse_name),
    gender        = COALESCE(p_gender, gender),
    is_child      = COALESCE(p_is_child, is_child)
  WHERE id = p_member_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_update_member(uuid, text, text, text, text, text, text, boolean, uuid, uuid, boolean) TO authenticated;


-- 회원 추가 RPC: household_id / pasture_id 둘 다 NULL 허용 (소속 미정)
DROP FUNCTION IF EXISTS public.admin_create_member(text, text, text, text, text, uuid, uuid, text, boolean, date, text);
CREATE OR REPLACE FUNCTION public.admin_create_member(
  p_name          text,
  p_phone         text DEFAULT '',
  p_family_church text DEFAULT '목원',
  p_sub_role      text DEFAULT '',
  p_spouse_name   text DEFAULT '',
  p_household_id  uuid DEFAULT NULL,
  p_pasture_id    uuid DEFAULT NULL,
  p_gender        text DEFAULT NULL,
  p_is_child      boolean DEFAULT false,
  p_birth_date    date DEFAULT NULL,
  p_address       text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
  v_hh_id     uuid := p_household_id;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION '이름은 필수입니다';
  END IF;

  -- household 결정
  --   household_id 지정 → 그 가족 합류
  --   pasture_id   지정 → 새 household 생성 후 그 목장에
  --   둘 다 NULL    → household 없이 회원만 생성 (소속 미정)
  IF v_hh_id IS NULL AND p_pasture_id IS NOT NULL THEN
    INSERT INTO public.households (pasture_id, address, home_phone, order_no)
    VALUES (p_pasture_id, coalesce(p_address, ''), '', 0)
    RETURNING id INTO v_hh_id;
  END IF;

  INSERT INTO public.members (
    name, phone, birth_date, household_id,
    family_church, sub_role, spouse_name, gender, is_child,
    guard_status
  )
  VALUES (
    trim(p_name), coalesce(p_phone, ''), p_birth_date, v_hh_id,
    coalesce(p_family_church, '목원'), coalesce(p_sub_role, ''),
    coalesce(p_spouse_name, ''), p_gender, coalesce(p_is_child, false),
    '비회원'
  )
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_create_member(text, text, text, text, text, uuid, uuid, text, boolean, date, text) TO authenticated;
