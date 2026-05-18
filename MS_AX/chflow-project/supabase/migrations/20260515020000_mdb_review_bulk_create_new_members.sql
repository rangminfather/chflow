-- Bulk-create members from reviewed new-member candidates.
-- This is intentionally limited and logged. It creates public.members rows.

CREATE TABLE IF NOT EXISTS public.mdb_review_new_member_create_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_limit integer NOT NULL,
  target_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  error_message text,
  created_by uuid REFERENCES auth.users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.mdb_review_new_member_create_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.mdb_review_new_member_create_runs(id) ON DELETE CASCADE,
  staging_id bigint NOT NULL REFERENCES public.staging_members_mdb(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  status text NOT NULL,
  reason text,
  staging_snapshot jsonb NOT NULL,
  member_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mdb_review_new_member_create_items_run
  ON public.mdb_review_new_member_create_items (run_id);

CREATE INDEX IF NOT EXISTS idx_mdb_review_new_member_create_items_staging
  ON public.mdb_review_new_member_create_items (staging_id);

ALTER TABLE public.mdb_review_new_member_create_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdb_review_new_member_create_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mdb_review_new_member_create_runs_select_admin" ON public.mdb_review_new_member_create_runs;
CREATE POLICY "mdb_review_new_member_create_runs_select_admin"
  ON public.mdb_review_new_member_create_runs FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'office', 'pastor'));

DROP POLICY IF EXISTS "mdb_review_new_member_create_items_select_admin" ON public.mdb_review_new_member_create_items;
CREATE POLICY "mdb_review_new_member_create_items_select_admin"
  ON public.mdb_review_new_member_create_items FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'office', 'pastor'));

DROP FUNCTION IF EXISTS public.admin_mdb_review_bulk_create_new_member_candidates(integer);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_bulk_create_new_member_candidates(
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  run_id uuid,
  target_count integer,
  created_count integer,
  skipped_count integer,
  remaining_candidate_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_target_count integer := 0;
  v_created_count integer := 0;
  v_skipped_count integer := 0;
  v_member_id uuid;
  v_gender text;
  r record;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  INSERT INTO public.mdb_review_new_member_create_runs (
    requested_limit,
    created_by
  )
  VALUES (
    GREATEST(COALESCE(p_limit, 10), 1),
    auth.uid()
  )
  RETURNING id INTO v_run_id;

  SELECT count(*)::integer
    INTO v_target_count
  FROM (
    SELECT s.id
    FROM public.staging_members_mdb s
    JOIN public.staging_member_matches smm
      ON smm.staging_id = s.id
    WHERE
      smm.match_status = 'new_member_candidate'
      AND smm.member_id IS NULL
      AND smm.auto_rule = 'no_candidate_new_member_candidate'
    ORDER BY s.id
    LIMIT GREATEST(COALESCE(p_limit, 10), 1)
  ) target;

  UPDATE public.mdb_review_new_member_create_runs
  SET target_count = v_target_count
  WHERE id = v_run_id;

  FOR r IN
    SELECT
      s.*,
      trim(concat_ws(' ', s.address_line_1, s.address_line_2)) AS full_address
    FROM public.staging_members_mdb s
    JOIN public.staging_member_matches smm
      ON smm.staging_id = s.id
    WHERE
      smm.match_status = 'new_member_candidate'
      AND smm.member_id IS NULL
      AND smm.auto_rule = 'no_candidate_new_member_candidate'
    ORDER BY s.id
    LIMIT GREATEST(COALESCE(p_limit, 10), 1)
  LOOP
    IF r.legacy_kyoin_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.legacy_kyoin_id = r.legacy_kyoin_id
      )
    THEN
      v_skipped_count := v_skipped_count + 1;

      INSERT INTO public.mdb_review_new_member_create_items (
        run_id,
        staging_id,
        status,
        reason,
        staging_snapshot
      )
      VALUES (
        v_run_id,
        r.id,
        'skipped',
        'legacy_kyoin_id already exists in members',
        to_jsonb(r)
      );

      UPDATE public.staging_member_matches smm
      SET
        match_status = 'hold',
        auto_classification = 'hold',
        confidence_score = 10,
        auto_rule = 'new_member_candidate_duplicate_legacy_kyoin_id',
        auto_payload = jsonb_build_object(
          'run_id', v_run_id,
          'legacy_kyoin_id', r.legacy_kyoin_id
        ),
        review_note = 'Skipped bulk new-member creation: duplicate legacy_kyoin_id already exists',
        reviewed_by = auth.uid(),
        reviewed_at = now()
      WHERE smm.staging_id = r.id;

      CONTINUE;
    END IF;

    v_gender := CASE
      WHEN r.gender IN ('M', 'F') THEN r.gender
      WHEN r.gender = '남' THEN 'M'
      WHEN r.gender = '여' THEN 'F'
      ELSE NULL
    END;

    INSERT INTO public.members (
      name,
      phone,
      birth_date,
      address,
      gender,
      status,
      legacy_kyoin_id,
      legacy_family_num,
      relationship_in_household,
      review_status,
      review_note,
      reviewed_by,
      reviewed_at
    )
    VALUES (
      r.name,
      r.phone,
      r.birth_date,
      NULLIF(r.full_address, ''),
      v_gender,
      'active',
      r.legacy_kyoin_id,
      r.legacy_family_num,
      r.relationship_in_household,
      'unreviewed',
      'Created from MDB new_member_candidate bulk run ' || v_run_id::text,
      auth.uid(),
      now()
    )
    RETURNING id INTO v_member_id;

    UPDATE public.staging_member_matches smm
    SET
      member_id = v_member_id,
      match_status = 'applied',
      match_score = 100,
      auto_classification = 'needs_review',
      confidence_score = 100,
      auto_rule = 'new_member_candidate_created',
      auto_payload = COALESCE(smm.auto_payload, '{}'::jsonb) || jsonb_build_object(
        'run_id', v_run_id,
        'created_member_id', v_member_id
      ),
      review_note = 'Created new member from MDB new_member_candidate bulk run',
      reviewed_by = auth.uid(),
      reviewed_at = now()
    WHERE smm.staging_id = r.id;

    INSERT INTO public.mdb_review_new_member_create_items (
      run_id,
      staging_id,
      member_id,
      status,
      reason,
      staging_snapshot,
      member_snapshot
    )
    SELECT
      v_run_id,
      r.id,
      m.id,
      'created',
      'created from new_member_candidate',
      to_jsonb(r),
      to_jsonb(m)
    FROM public.members m
    WHERE m.id = v_member_id;

    v_created_count := v_created_count + 1;
  END LOOP;

  UPDATE public.mdb_review_new_member_create_runs
  SET
    created_count = v_created_count,
    skipped_count = v_skipped_count,
    status = 'completed',
    completed_at = now()
  WHERE id = v_run_id;

  RETURN QUERY
  SELECT
    v_run_id,
    v_target_count,
    v_created_count,
    v_skipped_count,
    (
      SELECT count(*)::integer
      FROM public.staging_member_matches smm
      WHERE
        smm.match_status = 'new_member_candidate'
        AND smm.member_id IS NULL
        AND smm.auto_rule = 'no_candidate_new_member_candidate'
    ) AS remaining_candidate_count;
EXCEPTION WHEN OTHERS THEN
  IF v_run_id IS NOT NULL THEN
    UPDATE public.mdb_review_new_member_create_runs
    SET
      status = 'failed',
      error_message = SQLERRM,
      created_count = v_created_count,
      skipped_count = v_skipped_count,
      completed_at = now()
    WHERE id = v_run_id;
  END IF;
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_bulk_create_new_member_candidates(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
