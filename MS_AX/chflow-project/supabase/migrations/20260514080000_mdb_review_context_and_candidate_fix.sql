-- Tighten MDB review context and make per-row candidate lookup fast.
-- This does not update member data.

DROP FUNCTION IF EXISTS public.admin_mdb_review_candidate_options(bigint, integer);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_candidate_options(
  p_staging_id bigint,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  member_id uuid,
  member_name text,
  member_phone text,
  member_birth_date date,
  member_address text,
  member_spouse_name text,
  member_family_church text,
  member_sub_role text,
  member_review_status text,
  score integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.staging_members_mdb%ROWTYPE;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT * INTO s
  FROM public.staging_members_mdb
  WHERE id = p_staging_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'staging row not found: %', p_staging_id;
  END IF;

  RETURN QUERY
  WITH raw_candidates AS (
    SELECT m.*
    FROM public.members m
    WHERE s.phone IS NOT NULL
      AND m.phone = s.phone
    UNION
    SELECT m.*
    FROM public.members m
    WHERE m.name = s.name
    UNION
    SELECT m.*
    FROM public.members m
    WHERE s.birth_date IS NOT NULL
      AND m.birth_date = s.birth_date
    UNION
    SELECT m.*
    FROM public.members m
    WHERE s.legacy_family_num IS NOT NULL
      AND m.legacy_family_num = s.legacy_family_num
      AND m.name = s.name
  ),
  scored AS (
    SELECT
      m.id,
      m.name,
      m.phone,
      m.birth_date,
      m.address,
      m.spouse_name,
      m.family_church,
      m.sub_role,
      m.review_status,
      m.created_at,
      (
        CASE WHEN s.phone IS NOT NULL AND m.phone = s.phone THEN 60 ELSE 0 END +
        CASE WHEN m.name = s.name THEN 25 ELSE 0 END +
        CASE WHEN s.birth_date IS NOT NULL AND m.birth_date = s.birth_date THEN 10 ELSE 0 END +
        CASE WHEN s.legacy_family_num IS NOT NULL AND m.legacy_family_num = s.legacy_family_num THEN 10 ELSE 0 END
      ) AS computed_score
    FROM raw_candidates m
  )
  SELECT
    scored.id,
    scored.name,
    scored.phone,
    scored.birth_date,
    scored.address,
    scored.spouse_name,
    scored.family_church,
    scored.sub_role,
    scored.review_status,
    scored.computed_score
  FROM scored
  ORDER BY scored.computed_score DESC, scored.created_at ASC, scored.id
  LIMIT GREATEST(COALESCE(p_limit, 5), 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_candidate_options(bigint, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_mdb_review_family_context(bigint);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_family_context(
  p_staging_id bigint
)
RETURNS TABLE (
  row_kind text,
  sort_order integer,
  staging_id bigint,
  staging_name text,
  staging_relationship text,
  staging_phone text,
  staging_birth_date date,
  staging_family_num text,
  match_status text,
  matched_member_id uuid,
  member_id uuid,
  member_name text,
  member_phone text,
  member_birth_date date,
  member_relationship text,
  member_household_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_num text;
  v_current_household_id uuid;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT s.legacy_family_num, m.household_id
    INTO v_family_num, v_current_household_id
  FROM public.staging_members_mdb s
  LEFT JOIN public.staging_member_matches smm
    ON smm.staging_id = s.id
  LEFT JOIN public.members m
    ON m.id = smm.member_id
  WHERE s.id = p_staging_id;

  IF v_family_num IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH family_staging AS (
    SELECT
      s.id,
      s.name,
      s.relationship_in_household,
      s.phone,
      s.birth_date,
      s.legacy_family_num,
      smm.match_status,
      smm.member_id AS matched_member_id,
      m.name AS matched_member_name,
      m.phone AS matched_member_phone,
      m.birth_date AS matched_member_birth_date,
      m.relationship_in_household AS matched_member_relationship,
      m.household_id AS matched_member_household_id
    FROM public.staging_members_mdb s
    LEFT JOIN public.staging_member_matches smm
      ON smm.staging_id = s.id
    LEFT JOIN public.members m
      ON m.id = smm.member_id
    WHERE s.legacy_family_num = v_family_num
  )
  SELECT
    'mdb_family'::text AS row_kind,
    1 AS sort_order,
    fs.id AS staging_id,
    fs.name AS staging_name,
    fs.relationship_in_household AS staging_relationship,
    fs.phone AS staging_phone,
    fs.birth_date AS staging_birth_date,
    fs.legacy_family_num AS staging_family_num,
    COALESCE(fs.match_status, 'unreviewed') AS match_status,
    fs.matched_member_id,
    fs.matched_member_id AS member_id,
    fs.matched_member_name AS member_name,
    fs.matched_member_phone AS member_phone,
    fs.matched_member_birth_date AS member_birth_date,
    fs.matched_member_relationship AS member_relationship,
    fs.matched_member_household_id AS member_household_id
  FROM family_staging fs
  UNION ALL
  SELECT
    'live_household'::text AS row_kind,
    2 AS sort_order,
    NULL::bigint AS staging_id,
    NULL::text AS staging_name,
    NULL::text AS staging_relationship,
    NULL::text AS staging_phone,
    NULL::date AS staging_birth_date,
    v_family_num AS staging_family_num,
    NULL::text AS match_status,
    NULL::uuid AS matched_member_id,
    m.id AS member_id,
    m.name AS member_name,
    m.phone AS member_phone,
    m.birth_date AS member_birth_date,
    m.relationship_in_household AS member_relationship,
    m.household_id AS member_household_id
  FROM public.members m
  WHERE v_current_household_id IS NOT NULL
    AND m.household_id = v_current_household_id
  ORDER BY sort_order, staging_id NULLS LAST, member_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_family_context(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
