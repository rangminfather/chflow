-- Separate one-to-one name-only candidates from needs_review.
-- This does not update public.members and does not mark rows as fully matched.

ALTER TABLE public.staging_member_matches
  DROP CONSTRAINT IF EXISTS staging_member_matches_match_status_check;

ALTER TABLE public.staging_member_matches
  ADD CONSTRAINT staging_member_matches_match_status_check
  CHECK (match_status IN (
    'unreviewed',
    'auto_matched',
    'name_only_candidate',
    'needs_review',
    'matched',
    'new_member',
    'hold',
    'ignored',
    'applied'
  ));

DROP FUNCTION IF EXISTS public.admin_mdb_review_separate_name_only_candidates(integer);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_separate_name_only_candidates(
  p_limit integer DEFAULT 5000
)
RETURNS TABLE (
  action text,
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
  WITH eligible AS (
    SELECT
      smm.staging_id,
      smm.member_id,
      regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') AS staging_name_key
    FROM public.staging_member_matches smm
    JOIN public.staging_members_mdb s
      ON s.id = smm.staging_id
    WHERE
      smm.match_status = 'needs_review'
      AND smm.auto_rule = 'second_pass_unique_name_only'
      AND smm.member_id IS NOT NULL
    ORDER BY smm.staging_id
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  ),
  scored AS (
    SELECT
      e.*,
      count(*) OVER (PARTITION BY e.member_id) AS same_member_target_count,
      count(*) OVER (PARTITION BY e.staging_name_key) AS same_staging_name_count
    FROM eligible e
  ),
  separated AS (
    UPDATE public.staging_member_matches smm
    SET
      match_status = 'name_only_candidate',
      match_score = 60,
      auto_classification = 'needs_review',
      confidence_score = 60,
      auto_rule = 'second_pass_unique_name_only_one_to_one',
      auto_payload = coalesce(smm.auto_payload, '{}'::jsonb) || jsonb_build_object(
        'same_member_target_count', s.same_member_target_count,
        'same_staging_name_count', s.same_staging_name_count
      ),
      auto_decided_at = now(),
      review_note = 'Name-only one-to-one candidate; quick human confirmation recommended',
      reviewed_by = auth.uid(),
      reviewed_at = now()
    FROM scored s
    WHERE
      smm.staging_id = s.staging_id
      AND s.same_member_target_count = 1
      AND s.same_staging_name_count = 1
      AND smm.match_status = 'needs_review'
    RETURNING smm.staging_id
  ),
  held_collisions AS (
    UPDATE public.staging_member_matches smm
    SET
      match_status = 'hold',
      match_score = 35,
      auto_classification = 'hold',
      confidence_score = 35,
      auto_rule = 'second_pass_name_only_collision',
      auto_payload = coalesce(smm.auto_payload, '{}'::jsonb) || jsonb_build_object(
        'same_member_target_count', s.same_member_target_count,
        'same_staging_name_count', s.same_staging_name_count
      ),
      auto_decided_at = now(),
      review_note = 'Name-only collision; multiple MDB rows point to the same unique live member name',
      reviewed_by = auth.uid(),
      reviewed_at = now()
    FROM scored s
    WHERE
      smm.staging_id = s.staging_id
      AND (s.same_member_target_count > 1 OR s.same_staging_name_count > 1)
      AND smm.match_status = 'needs_review'
    RETURNING smm.staging_id
  )
  SELECT 'name_only_candidate_one_to_one'::text, count(*)::bigint FROM separated
  UNION ALL
  SELECT 'name_only_collision_held'::text, count(*)::bigint FROM held_collisions
  ORDER BY 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_separate_name_only_candidates(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
