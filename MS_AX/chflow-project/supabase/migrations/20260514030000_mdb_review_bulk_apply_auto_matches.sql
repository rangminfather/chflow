-- Bulk-apply confirmed high-confidence MDB matches to public.members.
-- This is intentionally separate from auto-classification and bulk confirmation.

CREATE TABLE IF NOT EXISTS public.mdb_review_bulk_apply_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  requested_limit integer NOT NULL DEFAULT 5000,
  min_confidence integer NOT NULL DEFAULT 80,
  before_matched_count bigint NOT NULL DEFAULT 0,
  target_count bigint NOT NULL DEFAULT 0,
  applied_count bigint NOT NULL DEFAULT 0,
  after_applied_count bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed'))
);

CREATE TABLE IF NOT EXISTS public.mdb_review_bulk_apply_items (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.mdb_review_bulk_apply_runs(id) ON DELETE CASCADE,
  staging_id bigint NOT NULL,
  member_id uuid NOT NULL,
  before_member jsonb NOT NULL,
  after_member jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mdb_review_bulk_apply_items_run
  ON public.mdb_review_bulk_apply_items (run_id);

CREATE INDEX IF NOT EXISTS idx_mdb_review_bulk_apply_items_staging
  ON public.mdb_review_bulk_apply_items (staging_id);

ALTER TABLE public.mdb_review_bulk_apply_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdb_review_bulk_apply_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mdb_review_bulk_apply_runs_select_admin" ON public.mdb_review_bulk_apply_runs;
CREATE POLICY "mdb_review_bulk_apply_runs_select_admin"
  ON public.mdb_review_bulk_apply_runs FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'office', 'pastor'));

DROP POLICY IF EXISTS "mdb_review_bulk_apply_items_select_admin" ON public.mdb_review_bulk_apply_items;
CREATE POLICY "mdb_review_bulk_apply_items_select_admin"
  ON public.mdb_review_bulk_apply_items FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'office', 'pastor'));

DROP FUNCTION IF EXISTS public.admin_mdb_review_bulk_apply_auto_matches(integer, integer);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_bulk_apply_auto_matches(
  p_limit integer DEFAULT 5000,
  p_min_confidence integer DEFAULT 80
)
RETURNS TABLE (
  run_id uuid,
  before_matched_count bigint,
  target_count bigint,
  applied_count bigint,
  after_applied_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_limit integer := GREATEST(COALESCE(p_limit, 5000), 1);
  v_min_confidence integer := GREATEST(COALESCE(p_min_confidence, 80), 0);
  v_before_matched_count bigint := 0;
  v_target_count bigint := 0;
  v_applied_count bigint := 0;
  v_after_applied_count bigint := 0;
  r record;
  v_before_member jsonb;
  v_after_member jsonb;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT count(*)::bigint
    INTO v_before_matched_count
  FROM public.staging_member_matches smm
  JOIN public.members m
    ON m.id = smm.member_id
  WHERE
    smm.match_status = 'matched'
    AND smm.auto_classification = 'auto_matched'
    AND smm.member_id IS NOT NULL
    AND COALESCE(smm.confidence_score, smm.match_score, 0) >= v_min_confidence;

  INSERT INTO public.mdb_review_bulk_apply_runs (
    id,
    requested_by,
    requested_limit,
    min_confidence,
    before_matched_count,
    status
  )
  VALUES (
    v_run_id,
    auth.uid(),
    v_limit,
    v_min_confidence,
    v_before_matched_count,
    'running'
  );

  FOR r IN
    SELECT
      smm.staging_id,
      smm.member_id
    FROM public.staging_member_matches smm
    JOIN public.members m
      ON m.id = smm.member_id
    WHERE
      smm.match_status = 'matched'
      AND smm.auto_classification = 'auto_matched'
      AND smm.member_id IS NOT NULL
      AND COALESCE(smm.confidence_score, smm.match_score, 0) >= v_min_confidence
    ORDER BY smm.staging_id
    LIMIT v_limit
  LOOP
    v_target_count := v_target_count + 1;

    SELECT to_jsonb(m)
      INTO v_before_member
    FROM public.members m
    WHERE m.id = r.member_id;

    PERFORM public.admin_mdb_review_apply(r.staging_id, r.member_id);

    SELECT to_jsonb(m)
      INTO v_after_member
    FROM public.members m
    WHERE m.id = r.member_id;

    INSERT INTO public.mdb_review_bulk_apply_items (
      run_id,
      staging_id,
      member_id,
      before_member,
      after_member
    )
    VALUES (
      v_run_id,
      r.staging_id,
      r.member_id,
      v_before_member,
      v_after_member
    );

    v_applied_count := v_applied_count + 1;
  END LOOP;

  SELECT count(*)::bigint
    INTO v_after_applied_count
  FROM public.staging_member_matches smm
  WHERE
    smm.match_status = 'applied'
    AND smm.auto_classification = 'auto_matched';

  UPDATE public.mdb_review_bulk_apply_runs
  SET
    completed_at = now(),
    target_count = v_target_count,
    applied_count = v_applied_count,
    after_applied_count = v_after_applied_count,
    status = 'completed'
  WHERE id = v_run_id;

  RETURN QUERY
  SELECT
    v_run_id,
    v_before_matched_count,
    v_target_count,
    v_applied_count,
    v_after_applied_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_bulk_apply_auto_matches(integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
