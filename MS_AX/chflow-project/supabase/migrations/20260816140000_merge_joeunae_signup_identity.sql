-- 정진화 목장의 조은혜 오기록을 가입 본인확인 이름 조은애로 바로잡고,
-- 가입 중 생성된 중복 성도 레코드를 기존 가족 레코드에 병합한다.

BEGIN;

DO $$
DECLARE
  v_existing_id        uuid := 'c38c721a-e227-4cab-97f8-9c72da502ea0';
  v_signup_id          uuid := 'fde73f12-0bc4-40c7-983b-65e16bad78b1';
  v_user_id            uuid := 'c6c0826f-5ca8-46ff-9f74-ec47aef5e2d9';
  v_existing_household uuid := '5f54adbd-befe-4225-9ed4-278d7c9380ce';
  v_signup_household   uuid := '5de56404-9540-41e1-a8f7-f229f17b8376';
  v_pasture_id         uuid := 'c6b53f12-b895-49b3-8504-3ab4a1c5e352';
  v_signup             public.members%ROWTYPE;
BEGIN
  -- 재실행 시에는 이미 병합된 최종 상태만 검증하고 종료한다.
  IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = v_signup_id) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.members m
      JOIN public.households h ON h.id = m.household_id
      JOIN public.directory_pastures p ON p.id = h.pasture_id
      WHERE m.id = v_existing_id
        AND m.name = '조은애'
        AND m.app_user_id = v_user_id
        AND p.id = v_pasture_id
        AND p.name = '정진화'
    ) THEN
      RAISE EXCEPTION '조은애 병합의 최종 상태가 일치하지 않습니다.';
    END IF;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.members m
    JOIN public.households h ON h.id = m.household_id
    JOIN public.directory_pastures p ON p.id = h.pasture_id
    WHERE m.id = v_existing_id
      AND m.name = '조은혜'
      AND m.household_id = v_existing_household
      AND p.id = v_pasture_id
      AND p.name = '정진화'
  ) THEN
    RAISE EXCEPTION '정진화 목장의 기존 조은혜 레코드를 확인할 수 없습니다.';
  END IF;

  SELECT * INTO STRICT v_signup
  FROM public.members
  WHERE id = v_signup_id
    AND name = '조은애'
    AND household_id = v_signup_household
    AND app_user_id = v_user_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_user_id
      AND name = '조은애'
      AND member_id = v_signup_id
      AND signup_pasture_id = v_pasture_id
  ) THEN
    RAISE EXCEPTION '조은애 가입 프로필의 본인확인 정보를 확인할 수 없습니다.';
  END IF;

  -- 가입 본인확인 정보를 기존 가족 레코드에 반영한다.
  UPDATE public.members
  SET app_user_id = NULL
  WHERE id = v_signup_id;

  UPDATE public.members
  SET name = v_signup.name,
      phone = COALESCE(v_signup.phone, phone),
      email = COALESCE(v_signup.email, email),
      birth_date = COALESCE(v_signup.birth_date, birth_date),
      address = COALESCE(v_signup.address, address),
      address_base = COALESCE(v_signup.address_base, address_base),
      address_detail = COALESCE(v_signup.address_detail, address_detail),
      address_zonecode = COALESCE(v_signup.address_zonecode, address_zonecode),
      gender = COALESCE(v_signup.gender, gender),
      sub_role = COALESCE(v_signup.sub_role, sub_role),
      guard_status = COALESCE(v_signup.guard_status, guard_status),
      app_user_id = v_user_id,
      account_state = 'active',
      withdrawn_at = NULL,
      withdrawn_by = NULL,
      withdrawal_reason = NULL
  WHERE id = v_existing_id;

  -- 배우자 화면에 보관된 비정규화 이름도 함께 수정한다.
  UPDATE public.members
  SET spouse_name = '조은애'
  WHERE household_id = v_existing_household
    AND spouse_name = '조은혜';

  -- 가입 이후 중복 레코드에 생긴 모든 성도 참조를 기존 가족 레코드로 옮긴다.
  UPDATE public.attendance_location_candidates SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.church_attendance SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.directory_photo_crops SET expected_member_id = v_existing_id WHERE expected_member_id = v_signup_id;
  UPDATE public.edu_student_history SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.edu_students SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.edu_teachers SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.education_import_match_candidates SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.education_import_rows SET matched_member_id = v_existing_id WHERE matched_member_id = v_signup_id;
  UPDATE public.education_import_rows SET suggested_member_id = v_existing_id WHERE suggested_member_id = v_signup_id;
  UPDATE public.life_study_enrollments SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.mdb_review_new_member_create_items SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.member_education_history SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.member_identity_aliases SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.member_ministries SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.member_phone_cleanup_items SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.member_relations SET subject_id = v_existing_id WHERE subject_id = v_signup_id;
  UPDATE public.member_relations SET relative_id = v_existing_id WHERE relative_id = v_signup_id;
  UPDATE public.members SET spouse_id = v_existing_id WHERE spouse_id = v_signup_id;
  UPDATE public.offerings SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.pasture_members SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.pastures SET leader_id = v_existing_id WHERE leader_id = v_signup_id;
  UPDATE public.profiles SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.profiles SET signup_parent_member_id = v_existing_id WHERE signup_parent_member_id = v_signup_id;
  UPDATE public.schedule_responses SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.staging_member_field_decisions SET member_id = v_existing_id WHERE member_id = v_signup_id;
  UPDATE public.staging_member_matches SET member_id = v_existing_id WHERE member_id = v_signup_id;

  DELETE FROM public.members WHERE id = v_signup_id;

  -- 가입 과정에서 만들어진 빈 임시 가구만 제거한다.
  DELETE FROM public.households h
  WHERE h.id = v_signup_household
    AND h.pasture_id = v_pasture_id
    AND NOT EXISTS (SELECT 1 FROM public.members m WHERE m.household_id = h.id);
END;
$$;

COMMIT;
