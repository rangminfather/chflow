-- =============================================================
-- 달란트 Phase A — 초등1부 규칙 정리 + 규칙편집 권한 확장
--   1. save_talent_rule / delete_talent_rule 권한: 부장(0~1) → 임원진(0~2, 총무·서기 포함)
--   2. 초등1부 weekly 규칙 점수/항목 정리 (사용자 정의 기준)
--      출석2·성경1·요절2·요절발표5·주보퀴즈2(신규)·숙제2·전도5·대표기도5·새친구등반5
--   ※ 적용: npx supabase db query --linked --file supabase\migrations\20260625120000_talent_elementary1_rules.sql
-- =============================================================


-- ─────────────────────────────────────────
-- 1. 규칙 저장 (UPSERT) — 권한 grade 0~2
--    get_user_grade: 부서원 아니면 99, 시스템 역할(admin/office/pastor)은 0
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.save_talent_rule(uuid, uuid, text, text, text, int, text, int, boolean);
CREATE OR REPLACE FUNCTION public.save_talent_rule(
  p_id        uuid,
  p_dept_id   uuid,
  p_kind      text,
  p_key       text,
  p_label     text,
  p_points    int,
  p_notes     text,
  p_order     int,
  p_active    boolean
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF public.get_user_grade(p_dept_id) > 2 THEN
    RAISE EXCEPTION '권한이 없습니다 (요구: 임원진 등급 0~2)';
  END IF;
  IF p_kind NOT IN ('weekly','special','bonus') THEN
    RAISE EXCEPTION 'rule_kind 가 잘못되었습니다';
  END IF;
  IF p_label IS NULL OR length(trim(p_label)) = 0 THEN
    RAISE EXCEPTION 'label 은 필수';
  END IF;
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'rule_key 는 필수 (자동매핑용 영문 식별자)';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.edu_talent_rules (
      department_id, rule_kind, rule_key, label, points, notes, order_no, is_active, updated_by
    ) VALUES (
      p_dept_id, p_kind, p_key, p_label,
      COALESCE(p_points, 0), p_notes, COALESCE(p_order, 0),
      COALESCE(p_active, true), auth.uid()
    )
    ON CONFLICT (department_id, rule_kind, rule_key) DO UPDATE SET
      label      = EXCLUDED.label,
      points     = EXCLUDED.points,
      notes      = EXCLUDED.notes,
      order_no   = EXCLUDED.order_no,
      is_active  = EXCLUDED.is_active,
      updated_at = now(),
      updated_by = auth.uid()
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.edu_talent_rules SET
      rule_kind  = p_kind,
      rule_key   = p_key,
      label      = p_label,
      points     = COALESCE(p_points, 0),
      notes      = p_notes,
      order_no   = COALESCE(p_order, 0),
      is_active  = COALESCE(p_active, true),
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = p_id AND department_id = p_dept_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_talent_rule(uuid, uuid, text, text, text, int, text, int, boolean) TO authenticated;


-- ─────────────────────────────────────────
-- 2. 규칙 삭제 — 권한 grade 0~2
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.delete_talent_rule(uuid);
CREATE OR REPLACE FUNCTION public.delete_talent_rule(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dept_id uuid;
BEGIN
  SELECT department_id INTO v_dept_id FROM public.edu_talent_rules WHERE id = p_id;
  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION '규칙을 찾을 수 없습니다';
  END IF;
  IF public.get_user_grade(v_dept_id) > 2 THEN
    RAISE EXCEPTION '권한이 없습니다 (요구: 임원진 등급 0~2)';
  END IF;
  DELETE FROM public.edu_talent_rules WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_talent_rule(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 3. 초등1부 weekly 규칙 정리 (idempotent upsert)
--    attendance 만 출석부 자동연동(system), 나머지는 통장 수동 체크(custom)
-- ─────────────────────────────────────────
DO $$
DECLARE v_dept uuid;
BEGIN
  SELECT id INTO v_dept
  FROM public.departments
  WHERE category = '교육사역국' AND name = '초등1부'
  LIMIT 1;

  IF v_dept IS NULL THEN
    RAISE NOTICE '초등1부 부서를 찾지 못해 규칙 시드를 건너뜁니다';
    RETURN;
  END IF;

  INSERT INTO public.edu_talent_rules
    (department_id, rule_kind, rule_key, label, points, order_no, is_active)
  VALUES
    (v_dept, 'weekly', 'attendance',           '출석',         2, 0, true),
    (v_dept, 'weekly', 'bible_book',           '성경책 지참',   1, 1, true),
    (v_dept, 'weekly', 'verse_memory',         '요절암송',      2, 2, true),
    (v_dept, 'weekly', 'verse_presentation',   '요절암송발표',  5, 3, true),
    (v_dept, 'weekly', 'bulletin_quiz',        '주보퀴즈',      2, 4, true),
    (v_dept, 'weekly', 'lesson_homework',      '숙제',         2, 5, true),
    (v_dept, 'weekly', 'evangelism',           '전도',         5, 6, true),
    (v_dept, 'weekly', 'representative_prayer', '대표기도',      5, 7, true),
    (v_dept, 'weekly', 'new_friend_promotion', '새친구등반',    5, 8, true)
  ON CONFLICT (department_id, rule_kind, rule_key) DO UPDATE SET
    label      = EXCLUDED.label,
    points     = EXCLUDED.points,
    order_no   = EXCLUDED.order_no,
    is_active  = true,
    updated_at = now();
END $$;
