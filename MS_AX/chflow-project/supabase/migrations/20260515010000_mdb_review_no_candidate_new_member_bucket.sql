-- Classify no-candidate MDB rows into new-member candidates vs hold.
-- This only changes review state. It does not insert or update public.members.

ALTER TABLE public.staging_member_matches
  DROP CONSTRAINT IF EXISTS staging_member_matches_match_status_check;

ALTER TABLE public.staging_member_matches
  ADD CONSTRAINT staging_member_matches_match_status_check
  CHECK (match_status IN (
    'unreviewed',
    'auto_matched',
    'name_only_candidate',
    'new_member_candidate',
    'needs_review',
    'matched',
    'new_member',
    'hold',
    'ignored',
    'applied'
  ));

DROP FUNCTION IF EXISTS public.admin_mdb_review_confirm_match(bigint, uuid, text, integer, text);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_confirm_match(
  p_staging_id bigint,
  p_member_id uuid DEFAULT NULL,
  p_match_status text DEFAULT 'matched',
  p_match_score integer DEFAULT NULL,
  p_review_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF p_match_status NOT IN (
    'unreviewed',
    'auto_matched',
    'name_only_candidate',
    'new_member_candidate',
    'needs_review',
    'matched',
    'new_member',
    'hold',
    'ignored',
    'applied'
  ) THEN
    RAISE EXCEPTION 'invalid match status: %', p_match_status;
  END IF;

  INSERT INTO public.staging_member_matches (
    staging_id,
    member_id,
    match_status,
    match_score,
    review_note,
    reviewed_by,
    reviewed_at
  )
  VALUES (
    p_staging_id,
    p_member_id,
    p_match_status,
    p_match_score,
    p_review_note,
    auth.uid(),
    now()
  )
  ON CONFLICT (staging_id)
  DO UPDATE SET
    member_id = EXCLUDED.member_id,
    match_status = EXCLUDED.match_status,
    match_score = EXCLUDED.match_score,
    review_note = EXCLUDED.review_note,
    reviewed_by = EXCLUDED.reviewed_by,
    reviewed_at = EXCLUDED.reviewed_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_confirm_match(bigint, uuid, text, integer, text) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_mdb_review_preview_no_candidate_new_members(integer);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_preview_no_candidate_new_members(
  p_limit integer DEFAULT 5000
)
RETURNS TABLE (
  action text,
  affected_count bigint
)
LANGUAGE plpgsql
STABLE
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
      s.id AS staging_id,
      s.name,
      regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') AS name_key,
      s.phone,
      s.birth_date,
      s.legacy_family_num,
      s.relationship_in_household,
      s.gender,
      trim(concat_ws(' ', s.address_line_1, s.address_line_2)) AS address
    FROM public.staging_members_mdb s
    JOIN public.staging_member_matches smm
      ON smm.staging_id = s.id
    WHERE
      smm.match_status = 'needs_review'
      AND smm.member_id IS NULL
      AND smm.auto_rule = 'no_candidate'
    ORDER BY s.id
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  ),
  scored AS (
    SELECT
      e.*,
      (
        CASE WHEN NULLIF(trim(coalesce(e.name, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN e.birth_date IS NOT NULL THEN 2 ELSE 0 END +
        CASE WHEN NULLIF(trim(coalesce(e.phone, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN NULLIF(trim(coalesce(e.address, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN NULLIF(trim(coalesce(e.legacy_family_num, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN NULLIF(trim(coalesce(e.relationship_in_household, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN NULLIF(trim(coalesce(e.gender, '')), '') IS NOT NULL THEN 1 ELSE 0 END
      ) AS support_score,
      EXISTS (
        SELECT 1
        FROM public.members m
        WHERE
          (NULLIF(trim(coalesce(e.phone, '')), '') IS NOT NULL AND m.phone = e.phone)
          OR regexp_replace(coalesce(m.name, ''), '\s+', '', 'g') = e.name_key
          OR (e.birth_date IS NOT NULL AND m.birth_date = e.birth_date)
          OR (
            NULLIF(trim(coalesce(e.legacy_family_num, '')), '') IS NOT NULL
            AND m.legacy_family_num = e.legacy_family_num
            AND regexp_replace(coalesce(m.name, ''), '\s+', '', 'g') = e.name_key
          )
      ) AS has_possible_existing_candidate
    FROM eligible e
  ),
  bucketed AS (
    SELECT
      CASE
        WHEN has_possible_existing_candidate THEN 'hold_possible_existing_candidate'
        WHEN NULLIF(trim(coalesce(name, '')), '') IS NOT NULL
          AND (
            birth_date IS NOT NULL
            OR NULLIF(trim(coalesce(phone, '')), '') IS NOT NULL
            OR NULLIF(trim(coalesce(address, '')), '') IS NOT NULL
          )
          AND support_score >= 3
          THEN 'new_member_candidate'
        ELSE 'hold_weak_no_candidate_data'
      END AS action
    FROM scored
  )
  SELECT b.action, count(*)::bigint
  FROM bucketed b
  GROUP BY b.action
  UNION ALL
  SELECT 'eligible_total'::text, count(*)::bigint FROM eligible
  ORDER BY 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_preview_no_candidate_new_members(integer) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_mdb_review_classify_no_candidate_new_members(integer);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_classify_no_candidate_new_members(
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
      s.id AS staging_id,
      s.name,
      regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') AS name_key,
      s.phone,
      s.birth_date,
      s.legacy_family_num,
      s.relationship_in_household,
      s.gender,
      trim(concat_ws(' ', s.address_line_1, s.address_line_2)) AS address
    FROM public.staging_members_mdb s
    JOIN public.staging_member_matches smm
      ON smm.staging_id = s.id
    WHERE
      smm.match_status = 'needs_review'
      AND smm.member_id IS NULL
      AND smm.auto_rule = 'no_candidate'
    ORDER BY s.id
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  ),
  scored AS (
    SELECT
      e.*,
      (
        CASE WHEN NULLIF(trim(coalesce(e.name, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN e.birth_date IS NOT NULL THEN 2 ELSE 0 END +
        CASE WHEN NULLIF(trim(coalesce(e.phone, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN NULLIF(trim(coalesce(e.address, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN NULLIF(trim(coalesce(e.legacy_family_num, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN NULLIF(trim(coalesce(e.relationship_in_household, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN NULLIF(trim(coalesce(e.gender, '')), '') IS NOT NULL THEN 1 ELSE 0 END
      ) AS support_score,
      EXISTS (
        SELECT 1
        FROM public.members m
        WHERE
          (NULLIF(trim(coalesce(e.phone, '')), '') IS NOT NULL AND m.phone = e.phone)
          OR regexp_replace(coalesce(m.name, ''), '\s+', '', 'g') = e.name_key
          OR (e.birth_date IS NOT NULL AND m.birth_date = e.birth_date)
          OR (
            NULLIF(trim(coalesce(e.legacy_family_num, '')), '') IS NOT NULL
            AND m.legacy_family_num = e.legacy_family_num
            AND regexp_replace(coalesce(m.name, ''), '\s+', '', 'g') = e.name_key
          )
      ) AS has_possible_existing_candidate
    FROM eligible e
  ),
  bucketed AS (
    SELECT
      s.*,
      CASE
        WHEN s.has_possible_existing_candidate THEN 'hold_possible_existing_candidate'
        WHEN NULLIF(trim(coalesce(s.name, '')), '') IS NOT NULL
          AND (
            s.birth_date IS NOT NULL
            OR NULLIF(trim(coalesce(s.phone, '')), '') IS NOT NULL
            OR NULLIF(trim(coalesce(s.address, '')), '') IS NOT NULL
          )
          AND s.support_score >= 3
          THEN 'new_member_candidate'
        ELSE 'hold_weak_no_candidate_data'
      END AS action
    FROM scored s
  ),
  updated_new_candidate AS (
    UPDATE public.staging_member_matches smm
    SET
      member_id = NULL,
      match_status = 'new_member_candidate',
      match_score = 65,
      auto_classification = 'needs_review',
      confidence_score = 65,
      auto_rule = 'no_candidate_new_member_candidate',
      auto_payload = jsonb_build_object(
        'source_rule', 'no_candidate',
        'support_score', b.support_score,
        'has_name', NULLIF(trim(coalesce(b.name, '')), '') IS NOT NULL,
        'has_birth_date', b.birth_date IS NOT NULL,
        'has_phone', NULLIF(trim(coalesce(b.phone, '')), '') IS NOT NULL,
        'has_address', NULLIF(trim(coalesce(b.address, '')), '') IS NOT NULL,
        'has_family_num', NULLIF(trim(coalesce(b.legacy_family_num, '')), '') IS NOT NULL,
        'has_relationship', NULLIF(trim(coalesce(b.relationship_in_household, '')), '') IS NOT NULL,
        'has_gender', NULLIF(trim(coalesce(b.gender, '')), '') IS NOT NULL
      ),
      auto_decided_at = now(),
      review_note = 'No existing candidate found; enough MDB data for human new-member review',
      reviewed_by = auth.uid(),
      reviewed_at = now()
    FROM bucketed b
    WHERE
      b.action = 'new_member_candidate'
      AND smm.staging_id = b.staging_id
      AND smm.match_status = 'needs_review'
    RETURNING smm.staging_id
  ),
  updated_hold_possible AS (
    UPDATE public.staging_member_matches smm
    SET
      member_id = NULL,
      match_status = 'hold',
      match_score = 20,
      auto_classification = 'hold',
      confidence_score = 20,
      auto_rule = 'no_candidate_possible_existing_candidate',
      auto_payload = jsonb_build_object(
        'source_rule', 'no_candidate',
        'reason', 'candidate check found a possible existing member',
        'support_score', b.support_score
      ),
      auto_decided_at = now(),
      review_note = 'No-candidate row rechecked: possible existing member signal found; hold for manual review',
      reviewed_by = auth.uid(),
      reviewed_at = now()
    FROM bucketed b
    WHERE
      b.action = 'hold_possible_existing_candidate'
      AND smm.staging_id = b.staging_id
      AND smm.match_status = 'needs_review'
    RETURNING smm.staging_id
  ),
  updated_hold_weak AS (
    UPDATE public.staging_member_matches smm
    SET
      member_id = NULL,
      match_status = 'hold',
      match_score = 15,
      auto_classification = 'hold',
      confidence_score = 15,
      auto_rule = 'no_candidate_weak_new_member_data',
      auto_payload = jsonb_build_object(
        'source_rule', 'no_candidate',
        'reason', 'insufficient MDB fields for direct new-member candidate bucket',
        'support_score', b.support_score
      ),
      auto_decided_at = now(),
      review_note = 'No-candidate row has weak MDB data; hold before new-member creation',
      reviewed_by = auth.uid(),
      reviewed_at = now()
    FROM bucketed b
    WHERE
      b.action = 'hold_weak_no_candidate_data'
      AND smm.staging_id = b.staging_id
      AND smm.match_status = 'needs_review'
    RETURNING smm.staging_id
  )
  SELECT 'new_member_candidate'::text, count(*)::bigint FROM updated_new_candidate
  UNION ALL
  SELECT 'hold_possible_existing_candidate'::text, count(*)::bigint FROM updated_hold_possible
  UNION ALL
  SELECT 'hold_weak_no_candidate_data'::text, count(*)::bigint FROM updated_hold_weak
  ORDER BY 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_classify_no_candidate_new_members(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
