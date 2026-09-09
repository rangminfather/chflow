-- 목장탐방 리더 소속 정정
--
-- 1) 김신혜: 김권수 가정에 잘못 합쳐진 회원을 젊은이평원 김신혜목장으로 이동
-- 2) 박정이·성영순: 본인 이름의 목장에 정상 소속되어 있으나 목원으로 잘못 저장된 역할을 목자로 정정
--
-- 운영 DB에는 2026-09-09 선반영했다. 아래 조건은 이미 정정된 DB에서는 아무 작업도 하지 않으며,
-- 미적용 환경에서도 이름만으로 갱신하지 않고 회원·전화번호·현재 목장까지 일치할 때만 변경한다.

DO $$
DECLARE
  v_member_id uuid;
  v_source_household_id uuid;
  v_target_pasture_id uuid;
  v_target_household_id uuid;
BEGIN
  SELECT m.id, m.household_id
    INTO v_member_id, v_source_household_id
  FROM public.members m
  JOIN public.households h ON h.id = m.household_id
  JOIN public.directory_pastures p ON p.id = h.pasture_id
  WHERE m.name = '김신혜'
    AND replace(m.phone, '-', '') = '01045013747'
    AND m.family_church = '목자'
    AND p.name = '김권수'
  LIMIT 1;

  SELECT p.id INTO v_target_pasture_id
  FROM public.directory_pastures p
  JOIN public.grasslands g ON g.id = p.grassland_id
  JOIN public.plains pl ON pl.id = g.plain_id
  WHERE p.name = '김신혜'
    AND pl.name = '젊은이'
  LIMIT 1;

  IF v_member_id IS NOT NULL AND v_target_pasture_id IS NOT NULL THEN
    INSERT INTO public.households (pasture_id, address, home_phone, order_no)
    SELECT v_target_pasture_id, h.address, h.home_phone, 691
    FROM public.households h
    WHERE h.id = v_source_household_id
    RETURNING id INTO v_target_household_id;

    UPDATE public.members
    SET household_id = v_target_household_id
    WHERE id = v_member_id
      AND household_id = v_source_household_id;
  END IF;

  UPDATE public.members m
  SET family_church = '목자'
  FROM public.households h, public.directory_pastures p
  WHERE m.id = 'ba87c4b0-9290-4b07-b0ef-548d246c24c3'::uuid
    AND m.name = '박정이'
    AND replace(m.phone, '-', '') = '01072483369'
    AND m.family_church = '목원'
    AND h.id = m.household_id
    AND p.id = h.pasture_id
    AND p.name = '박정이';

  UPDATE public.members m
  SET family_church = '목자'
  FROM public.households h, public.directory_pastures p
  WHERE m.id = '398bc5f5-6c1e-4c84-8ac7-d1488e9706ef'::uuid
    AND m.name = '성영순'
    AND replace(m.phone, '-', '') = '01029276256'
    AND m.family_church = '목원'
    AND h.id = m.household_id
    AND p.id = h.pasture_id
    AND p.name = '성영순';
END;
$$;
