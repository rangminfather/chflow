-- Family context for MDB review.
-- Shows MDB rows with the same legacy family number and any linked live household members.

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
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT s.legacy_family_num
    INTO v_family_num
  FROM public.staging_members_mdb s
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
  ),
  linked_households AS (
    SELECT DISTINCT fs.matched_member_household_id AS household_id
    FROM family_staging fs
    WHERE fs.matched_member_household_id IS NOT NULL
  ),
  live_household_members AS (
    SELECT
      m.id,
      m.name,
      m.phone,
      m.birth_date,
      m.relationship_in_household,
      m.household_id
    FROM public.members m
    JOIN linked_households lh
      ON lh.household_id = m.household_id
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
    lhm.id AS member_id,
    lhm.name AS member_name,
    lhm.phone AS member_phone,
    lhm.birth_date AS member_birth_date,
    lhm.relationship_in_household AS member_relationship,
    lhm.household_id AS member_household_id
  FROM live_household_members lhm
  ORDER BY sort_order, staging_id NULLS LAST, member_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_family_context(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
