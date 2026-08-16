-- 가입 본인확인 이름은 송문석이며, 정진화 목장 가족에 남은 송운석 오표기를 정정한다.
-- members_backup은 과거 시점 백업이므로 변경하지 않는다.

BEGIN;

DO $$
DECLARE
  v_songmunseok_id uuid := 'e630aa95-02c2-4693-ab41-40cef076e72e';
  v_joeunae_id     uuid := 'c38c721a-e227-4cab-97f8-9c72da502ea0';
  v_household_id   uuid := '5f54adbd-befe-4225-9ed4-278d7c9380ce';
  v_user_id        uuid := '4772a626-5506-450e-a36a-27be720611d7';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.members m
    JOIN public.profiles p ON p.id = m.app_user_id
    WHERE m.id = v_songmunseok_id
      AND m.name = '송문석'
      AND m.household_id = v_household_id
      AND m.app_user_id = v_user_id
      AND p.name = '송문석'
      AND p.member_id = m.id
  ) THEN
    RAISE EXCEPTION '가입 본인확인된 송문석 성도·프로필 연결을 확인할 수 없습니다.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.members
    WHERE id = v_joeunae_id
      AND name = '조은애'
      AND household_id = v_household_id
      AND spouse_name IN ('송운석', '송문석')
  ) THEN
    RAISE EXCEPTION '조은애 배우자 표기의 현재 상태를 확인할 수 없습니다.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.member_relations
    WHERE subject_id = v_songmunseok_id
      AND relative_id = v_joeunae_id
      AND kind = 'spouse'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.member_relations
    WHERE subject_id = v_joeunae_id
      AND relative_id = v_songmunseok_id
      AND kind = 'spouse'
  ) THEN
    RAISE EXCEPTION '송문석·조은애의 상호 배우자 관계를 확인할 수 없습니다.';
  END IF;

  UPDATE public.members
  SET spouse_name = '송문석'
  WHERE id = v_joeunae_id
    AND spouse_name = '송운석';

  IF EXISTS (SELECT 1 FROM public.members WHERE name = '송운석' OR spouse_name = '송운석') THEN
    RAISE EXCEPTION '운영 성도 정보에 송운석 오표기가 남아 있습니다.';
  END IF;
END;
$$;

COMMIT;
