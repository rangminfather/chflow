-- =============================================================
-- admin_update_member 확장: 주소 변경 + 가족 단위 이동
--   p_address          : 새 주소 (NULL = 변경 안 함, '' = 빈 주소로 저장)
--   p_move_member_ids  : 같이 이동시킬 멤버 ID 배열 (반드시 본인 포함)
--                        - NULL          : 가족 단위 이동 안 함 (기존 동작)
--                        - 배열, 가족 전원 : 같은 household 의 주소/목장 update
--                        - 배열, 가족 일부 : 새 household 만들어서 그 멤버들만 옮김
--   p_split_pasture_id : 함께 사용 가능 — 가족 전원/일부를 새 목장으로
-- =============================================================

DROP FUNCTION IF EXISTS public.admin_update_member(uuid, text, text, text, text, text, text, boolean, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.admin_update_member(uuid, text, text, text, text, text, text, boolean, uuid, uuid, boolean, text, uuid[]);

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
  p_clear_household  boolean DEFAULT false,
  p_address          text DEFAULT NULL,
  p_move_member_ids  uuid[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old_hh          uuid;
  v_old_pasture     uuid;
  v_old_address     text;
  v_new_hh          uuid;
  v_remaining       int;
  v_household_count int;
  v_move_count      int;
  v_invalid_count   int;
  v_target_pasture  uuid;
  v_target_address  text;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF (p_household_id IS NOT NULL)::int + (p_split_pasture_id IS NOT NULL)::int + (p_clear_household IS TRUE)::int > 1 THEN
    RAISE EXCEPTION '가족 합류 / 신규 가족 분리 / 소속 빼기 중 하나만 지정할 수 있습니다';
  END IF;

  IF p_move_member_ids IS NOT NULL AND (p_household_id IS NOT NULL OR p_clear_household IS TRUE) THEN
    RAISE EXCEPTION '가족 합류 / 소속 빼기와 가족 단위 이동은 같이 사용할 수 없습니다';
  END IF;

  -- ============================================================
  -- 케이스 A: 본인만 가족 합류 / 어디에도 소속 안 둠
  -- ============================================================
  IF p_household_id IS NOT NULL OR p_clear_household IS TRUE THEN
    SELECT household_id INTO v_old_hh FROM public.members WHERE id = p_member_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '해당 회원을 찾을 수 없습니다';
    END IF;

    IF p_clear_household IS TRUE THEN
      v_new_hh := NULL;
    ELSE
      v_new_hh := p_household_id;
      PERFORM 1 FROM public.households WHERE id = v_new_hh;
      IF NOT FOUND THEN
        RAISE EXCEPTION '대상 가족(household)을 찾을 수 없습니다';
      END IF;
    END IF;

    IF v_old_hh IS DISTINCT FROM v_new_hh THEN
      UPDATE public.members SET household_id = v_new_hh WHERE id = p_member_id;

      IF v_old_hh IS NOT NULL THEN
        SELECT COUNT(*) INTO v_remaining FROM public.members WHERE household_id = v_old_hh;
        IF v_remaining = 0 THEN
          DELETE FROM public.households WHERE id = v_old_hh;
        END IF;
      END IF;
    END IF;

  -- ============================================================
  -- 케이스 B: 가족 단위 이동 / 주소 변경
  --   p_move_member_ids 가 지정된 경우. 본인 포함 + 모두 같은 household.
  --   전원이면 같은 household update, 일부면 새 household 분리.
  -- ============================================================
  ELSIF p_move_member_ids IS NOT NULL THEN
    IF array_length(p_move_member_ids, 1) IS NULL THEN
      RAISE EXCEPTION '이동 대상 멤버가 비어 있습니다';
    END IF;

    IF NOT (p_member_id = ANY(p_move_member_ids)) THEN
      RAISE EXCEPTION '이동 대상에 본인이 포함되어야 합니다';
    END IF;

    SELECT household_id INTO v_old_hh FROM public.members WHERE id = p_member_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '해당 회원을 찾을 수 없습니다';
    END IF;
    IF v_old_hh IS NULL THEN
      RAISE EXCEPTION '소속(가족)이 없는 회원은 가족 단위 이동을 할 수 없습니다';
    END IF;

    -- 모두 같은 household 인지 확인
    SELECT COUNT(*) INTO v_invalid_count
    FROM public.members
    WHERE id = ANY(p_move_member_ids)
      AND (household_id IS DISTINCT FROM v_old_hh);
    IF v_invalid_count > 0 THEN
      RAISE EXCEPTION '이동 대상은 모두 같은 가족이어야 합니다';
    END IF;

    SELECT pasture_id, address INTO v_old_pasture, v_old_address
    FROM public.households WHERE id = v_old_hh;

    v_target_pasture := COALESCE(p_split_pasture_id, v_old_pasture);
    v_target_address := COALESCE(p_address, v_old_address);

    SELECT COUNT(*) INTO v_household_count FROM public.members WHERE household_id = v_old_hh;
    v_move_count := array_length(p_move_member_ids, 1);

    IF v_household_count = v_move_count THEN
      -- 전원 이동: 같은 household 의 목장/주소 update
      UPDATE public.households
        SET pasture_id = v_target_pasture,
            address    = v_target_address
        WHERE id = v_old_hh;
    ELSE
      -- 일부 이동: 새 household 만들어 분리
      INSERT INTO public.households (pasture_id, address, home_phone, order_no)
      VALUES (v_target_pasture, v_target_address, '', 0)
      RETURNING id INTO v_new_hh;

      UPDATE public.members SET household_id = v_new_hh
        WHERE id = ANY(p_move_member_ids);

      -- 기존 household 비었으면 정리 (가족 일부만 이동했으니 보통 안 비지만 안전장치)
      SELECT COUNT(*) INTO v_remaining FROM public.members WHERE household_id = v_old_hh;
      IF v_remaining = 0 THEN
        DELETE FROM public.households WHERE id = v_old_hh;
      END IF;
    END IF;

  -- ============================================================
  -- 케이스 C: 본인만 신규 가족으로 분리 (기존 동작 호환)
  -- ============================================================
  ELSIF p_split_pasture_id IS NOT NULL THEN
    SELECT household_id INTO v_old_hh FROM public.members WHERE id = p_member_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '해당 회원을 찾을 수 없습니다';
    END IF;

    INSERT INTO public.households (pasture_id, address, home_phone, order_no)
    VALUES (p_split_pasture_id, COALESCE(p_address, ''), '', 0)
    RETURNING id INTO v_new_hh;

    IF v_old_hh IS DISTINCT FROM v_new_hh THEN
      UPDATE public.members SET household_id = v_new_hh WHERE id = p_member_id;

      IF v_old_hh IS NOT NULL THEN
        SELECT COUNT(*) INTO v_remaining FROM public.members WHERE household_id = v_old_hh;
        IF v_remaining = 0 THEN
          DELETE FROM public.households WHERE id = v_old_hh;
        END IF;
      END IF;
    END IF;
  END IF;

  -- ============================================================
  -- 기본 필드 업데이트
  -- ============================================================
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
GRANT EXECUTE ON FUNCTION public.admin_update_member(uuid, text, text, text, text, text, text, boolean, uuid, uuid, boolean, text, uuid[]) TO authenticated;
