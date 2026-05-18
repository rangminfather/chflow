-- Bulk-confirm one-to-one name-only MDB candidates.
-- This changes review status only. It does not update public.members.

DROP FUNCTION IF EXISTS public.admin_mdb_review_confirm_name_only_candidates(integer);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_confirm_name_only_candidates(
  p_limit integer DEFAULT 5000
)
RETURNS TABLE (
  affected_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  RETURN QUERY
  WITH targets AS (
    SELECT smm.staging_id
    FROM public.staging_member_matches smm
    WHERE
      smm.match_status = 'name_only_candidate'
      AND smm.auto_rule = 'second_pass_unique_name_only_one_to_one'
      AND smm.member_id IS NOT NULL
      AND COALESCE((smm.auto_payload->>'same_member_target_count')::integer, 0) = 1
      AND COALESCE((smm.auto_payload->>'same_staging_name_count')::integer, 0) = 1
    ORDER BY smm.staging_id
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  ),
  updated AS (
    UPDATE public.staging_member_matches smm
    SET
      match_status = 'matched',
      match_score = COALESCE(smm.match_score, 60),
      confidence_score = COALESCE(smm.confidence_score, 60),
      review_note = concat_ws(
        E'\n',
        NULLIF(smm.review_note, ''),
        'Bulk confirmed name-only one-to-one candidate; members not applied'
      ),
      reviewed_by = auth.uid(),
      reviewed_at = now()
    FROM targets t
    WHERE smm.staging_id = t.staging_id
    RETURNING smm.staging_id
  )
  SELECT count(*)::bigint AS affected_count
  FROM updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_confirm_name_only_candidates(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
