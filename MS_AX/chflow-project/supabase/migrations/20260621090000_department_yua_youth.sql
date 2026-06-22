-- 교육사역국 부서 보정
-- - 기존 "유년부"가 있으면 "유아부"로 변경
-- - "청소년부"를 14세~19세 부서로 추가

DO $$
DECLARE
  v_category text := '교육사역국';
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.departments
    WHERE category = v_category AND name = '유아부'
  ) THEN
    UPDATE public.departments
    SET is_active = false
    WHERE category = v_category
      AND name = '유년부';
  ELSE
    UPDATE public.departments
    SET
      name = '유아부',
      icon = '👶',
      is_active = true
    WHERE category = v_category
      AND name = '유년부';
  END IF;

  INSERT INTO public.departments (category, name, description, icon, order_no, is_active)
  VALUES (v_category, '유아부', '4세~5세', '👶', 2, true)
  ON CONFLICT (category, name) DO UPDATE
    SET
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      order_no = EXCLUDED.order_no,
      is_active = true;

  INSERT INTO public.departments (category, name, description, icon, order_no, is_active)
  VALUES (v_category, '청소년부', '14세~19세 청소년 사역', '🎓', 6, true)
  ON CONFLICT (category, name) DO UPDATE
    SET
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      order_no = EXCLUDED.order_no,
      is_active = true;
END $$;
