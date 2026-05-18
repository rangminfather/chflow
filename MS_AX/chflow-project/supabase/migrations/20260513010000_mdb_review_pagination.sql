-- MDB review pagination and status counts

DROP FUNCTION IF EXISTS public.admin_mdb_review_candidates(text, text, integer);
DROP FUNCTION IF EXISTS public.admin_mdb_review_candidates(text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_candidates(
  p_status text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  staging_id bigint,
  staging_source_row_no int,
  match_status text,
  matched_member_id uuid,
  match_score integer,
  staging_name text,
  staging_phone text,
  staging_birth_date date,
  staging_birth_raw text,
  staging_address text,
  staging_family_num text,
  staging_relationship text,
  staging_gender text,
  member_id uuid,
  member_name text,
  member_phone text,
  member_birth_date date,
  member_address text,
  member_spouse_name text,
  member_family_church text,
  member_sub_role text,
  member_household_id uuid,
  member_review_status text,
  member_photo_url text,
  member_notes text,
  phone_equal boolean,
  birth_equal boolean,
  name_equal boolean,
  family_equal boolean,
  review_note text,
  total_count bigint
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
  WITH candidate_base AS (
    SELECT
      s.id AS staging_id,
      s.source_row_no AS staging_source_row_no,
      s.name AS staging_name,
      s.phone AS staging_phone,
      s.birth_date AS staging_birth_date,
      s.birth_raw AS staging_birth_raw,
      trim(concat_ws(' ', s.address_line_1, s.address_line_2)) AS staging_address,
      s.legacy_family_num AS staging_family_num,
      s.relationship_in_household AS staging_relationship,
      s.gender AS staging_gender,
      smm.match_status,
      smm.member_id AS matched_member_id,
      smm.match_score,
      smm.review_note
    FROM public.staging_members_mdb s
    LEFT JOIN public.staging_member_matches smm
      ON smm.staging_id = s.id
    WHERE
      (p_status IS NULL OR COALESCE(smm.match_status, 'unreviewed') = p_status)
      AND (
        p_query IS NULL
        OR s.name ILIKE '%' || p_query || '%'
        OR COALESCE(s.phone, '') ILIKE '%' || p_query || '%'
        OR COALESCE(s.legacy_family_num, '') ILIKE '%' || p_query || '%'
      )
  ),
  ranked AS (
    SELECT
      cb.*,
      m.id AS member_id,
      m.name AS member_name,
      m.phone AS member_phone,
      m.birth_date AS member_birth_date,
      m.address AS member_address,
      m.spouse_name AS member_spouse_name,
      m.family_church AS member_family_church,
      m.sub_role AS member_sub_role,
      m.household_id AS member_household_id,
      m.review_status AS member_review_status,
      m.photo_url AS member_photo_url,
      m.notes AS member_notes,
      (
        CASE WHEN cb.staging_phone IS NOT NULL AND m.phone = cb.staging_phone THEN 60 ELSE 0 END +
        CASE WHEN m.name = cb.staging_name THEN 25 ELSE 0 END +
        CASE WHEN cb.staging_birth_date IS NOT NULL AND m.birth_date = cb.staging_birth_date THEN 10 ELSE 0 END +
        CASE WHEN cb.staging_family_num IS NOT NULL AND m.legacy_family_num = cb.staging_family_num THEN 10 ELSE 0 END
      ) AS computed_score,
      row_number() OVER (
        PARTITION BY cb.staging_id
        ORDER BY
          (
            CASE WHEN cb.staging_phone IS NOT NULL AND m.phone = cb.staging_phone THEN 60 ELSE 0 END +
            CASE WHEN m.name = cb.staging_name THEN 25 ELSE 0 END +
            CASE WHEN cb.staging_birth_date IS NOT NULL AND m.birth_date = cb.staging_birth_date THEN 10 ELSE 0 END +
            CASE WHEN cb.staging_family_num IS NOT NULL AND m.legacy_family_num = cb.staging_family_num THEN 10 ELSE 0 END
          ) DESC,
          m.created_at ASC
      ) AS rn
    FROM candidate_base cb
    LEFT JOIN public.members m
      ON (
        (cb.staging_phone IS NOT NULL AND m.phone = cb.staging_phone)
        OR m.name = cb.staging_name
      )
  ),
  filtered AS (
    SELECT
      r.staging_id,
      r.staging_source_row_no,
      COALESCE(r.match_status, 'unreviewed') AS match_status,
      r.matched_member_id,
      COALESCE(r.match_score, r.computed_score) AS match_score,
      r.staging_name,
      r.staging_phone,
      r.staging_birth_date,
      r.staging_birth_raw,
      r.staging_address,
      r.staging_family_num,
      r.staging_relationship,
      r.staging_gender,
      r.member_id,
      r.member_name,
      r.member_phone,
      r.member_birth_date,
      r.member_address,
      r.member_spouse_name,
      r.member_family_church,
      r.member_sub_role,
      r.member_household_id,
      r.member_review_status,
      r.member_photo_url,
      r.member_notes,
      (r.staging_phone IS NOT NULL AND r.member_phone = r.staging_phone) AS phone_equal,
      (r.staging_birth_date IS NOT NULL AND r.member_birth_date = r.staging_birth_date) AS birth_equal,
      (r.member_name = r.staging_name) AS name_equal,
      (r.staging_family_num IS NOT NULL AND r.staging_family_num = (
        SELECT m2.legacy_family_num FROM public.members m2 WHERE m2.id = r.member_id
      )) AS family_equal,
      r.review_note
    FROM ranked r
    WHERE r.rn = 1 OR r.member_id IS NULL
  )
  SELECT
    f.*,
    count(*) OVER () AS total_count
  FROM filtered f
  ORDER BY f.match_status, f.match_score DESC, f.staging_id
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  LIMIT GREATEST(COALESCE(p_limit, 100), 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_candidates(text, text, integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_mdb_review_status_counts(text);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_status_counts(
  p_query text DEFAULT NULL
)
RETURNS TABLE (
  match_status text,
  total_count bigint
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
  SELECT
    COALESCE(smm.match_status, 'unreviewed') AS match_status,
    count(*) AS total_count
  FROM public.staging_members_mdb s
  LEFT JOIN public.staging_member_matches smm
    ON smm.staging_id = s.id
  WHERE
    p_query IS NULL
    OR s.name ILIKE '%' || p_query || '%'
    OR COALESCE(s.phone, '') ILIKE '%' || p_query || '%'
    OR COALESCE(s.legacy_family_num, '') ILIKE '%' || p_query || '%'
  GROUP BY COALESCE(smm.match_status, 'unreviewed')
  ORDER BY COALESCE(smm.match_status, 'unreviewed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_status_counts(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
