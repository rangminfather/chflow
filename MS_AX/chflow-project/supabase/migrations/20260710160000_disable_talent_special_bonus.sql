-- Disable special/bonus talent rules for active use.
-- Keep legacy rows in place, but only weekly rules can be saved or deleted.

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
DECLARE
  v_id uuid;
  v_existing_kind text;
BEGIN
  IF public.get_user_grade(p_dept_id) > 2 THEN
    RAISE EXCEPTION 'Permission denied (grade 0-2 required)';
  END IF;

  IF p_kind <> 'weekly' THEN
    RAISE EXCEPTION 'Only weekly talent rules are supported';
  END IF;

  IF p_label IS NULL OR length(trim(p_label)) = 0 THEN
    RAISE EXCEPTION 'label is required';
  END IF;

  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'rule_key is required';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT rule_kind INTO v_existing_kind
    FROM public.edu_talent_rules
    WHERE id = p_id AND department_id = p_dept_id;

    IF v_existing_kind IS NULL THEN
      RAISE EXCEPTION 'Rule not found';
    END IF;

    IF v_existing_kind <> 'weekly' THEN
      RAISE EXCEPTION 'Only weekly talent rules can be edited';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.edu_talent_rules (
      department_id, rule_kind, rule_key, label, points, notes, order_no, is_active, updated_by
    ) VALUES (
      p_dept_id, 'weekly', p_key, p_label,
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
      rule_kind  = 'weekly',
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

DROP FUNCTION IF EXISTS public.delete_talent_rule(uuid);
CREATE OR REPLACE FUNCTION public.delete_talent_rule(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dept_id uuid;
  v_kind text;
BEGIN
  SELECT department_id, rule_kind
    INTO v_dept_id, v_kind
  FROM public.edu_talent_rules
  WHERE id = p_id;

  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION 'Rule not found';
  END IF;

  IF public.get_user_grade(v_dept_id) > 2 THEN
    RAISE EXCEPTION 'Permission denied (grade 0-2 required)';
  END IF;

  IF v_kind <> 'weekly' THEN
    RAISE EXCEPTION 'Only weekly talent rules can be deleted';
  END IF;

  DELETE FROM public.edu_talent_rules WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_talent_rule(uuid) TO authenticated;
