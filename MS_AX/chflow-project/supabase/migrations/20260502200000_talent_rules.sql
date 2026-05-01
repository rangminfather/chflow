-- =============================================================
-- 달란트 규칙 (Talent Rules) — 부서별 자유 정의
--   rule_kind:
--     weekly  — 매주 자동 적립 가능 항목 (출석/헌금/주보요절 등)
--     special — 특별 지급 (찬양/예배 중 5달란트 이내 등 가이드)
--     bonus   — 누적 보너스 (개근/정근/수료)
--   rule_key는 자동 매핑용 식별자 (자동계산 시 사용).
--   부서마다 자유로 항목 추가, 같은 부서 내 (kind, key) 유니크.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.edu_talent_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  rule_kind     text NOT NULL CHECK (rule_kind IN ('weekly', 'special', 'bonus')),
  rule_key      text NOT NULL,
  label         text NOT NULL,
  points        int  NOT NULL DEFAULT 0,
  notes         text,
  order_no      int  DEFAULT 0,
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  updated_by    uuid REFERENCES auth.users(id),
  UNIQUE (department_id, rule_kind, rule_key)
);

CREATE INDEX IF NOT EXISTS idx_talent_rules_dept
  ON public.edu_talent_rules(department_id, rule_kind, order_no);

ALTER TABLE public.edu_talent_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "talent_rules_rls" ON public.edu_talent_rules;
CREATE POLICY "talent_rules_rls" ON public.edu_talent_rules
  USING (public.is_edu_member_or_admin(department_id))
  WITH CHECK (public.is_edu_member_or_admin(department_id));


-- ─────────────────────────────────────────
-- RPC: 목록
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.list_talent_rules(uuid);
CREATE OR REPLACE FUNCTION public.list_talent_rules(p_dept_id uuid)
RETURNS TABLE (
  id        uuid,
  rule_kind text,
  rule_key  text,
  label     text,
  points    int,
  notes     text,
  order_no  int,
  is_active boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, rule_kind, rule_key, label, points, notes, order_no, is_active
  FROM public.edu_talent_rules
  WHERE department_id = p_dept_id
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY rule_kind, order_no, label;
$$;
GRANT EXECUTE ON FUNCTION public.list_talent_rules(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- RPC: 저장 (UPSERT)
--   p_id IS NULL → INSERT
--   p_id 있음   → UPDATE (해당 부서만)
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
  IF NOT public.can_appoint_in_dept(p_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다 (요구: grade 0~1 또는 시스템 관리자)';
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
-- RPC: 삭제
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
  IF NOT public.can_appoint_in_dept(v_dept_id) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  DELETE FROM public.edu_talent_rules WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_talent_rule(uuid) TO authenticated;
