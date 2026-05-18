-- Second-pass MDB review classification.
-- The first pass was intentionally conservative because most existing members
-- lack legacy IDs, family numbers, and birth dates. This pass separates safer
-- name/birth matches from name-only and duplicate-name cases.

DROP FUNCTION IF EXISTS public.admin_mdb_review_run_second_pass(integer);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_run_second_pass(
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
      s.name AS staging_name,
      regexp_replace(coalesce(s.name, ''), '\s+', '', 'g') AS staging_name_key,
      s.phone AS staging_phone,
      s.birth_date AS staging_birth_date,
      s.gender AS staging_gender,
      s.legacy_family_num AS staging_family_num,
      s.relationship_in_household AS staging_relationship,
      trim(concat_ws(' ', s.address_line_1, s.address_line_2)) AS staging_address
    FROM public.staging_members_mdb s
    JOIN public.staging_member_matches smm
      ON smm.staging_id = s.id
    WHERE smm.match_status = 'needs_review'
    ORDER BY s.id
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  ),
  name_candidates AS (
    SELECT
      e.*,
      m.id AS member_id,
      m.name AS member_name,
      m.phone AS member_phone,
      m.birth_date AS member_birth_date,
      m.gender AS member_gender,
      m.address AS member_address,
      m.relationship_in_household AS member_relationship,
      row_number() OVER (
        PARTITION BY e.staging_id
        ORDER BY
          CASE WHEN e.staging_birth_date IS NOT NULL AND m.birth_date = e.staging_birth_date THEN 0 ELSE 1 END,
          m.created_at ASC,
          m.id
      ) AS rn
    FROM eligible e
    JOIN public.members m
      ON regexp_replace(coalesce(m.name, ''), '\s+', '', 'g') = e.staging_name_key
  ),
  stats AS (
    SELECT
      nc.*,
      count(*) OVER (PARTITION BY nc.staging_id) AS name_candidate_count,
      count(*) FILTER (
        WHERE nc.staging_birth_date IS NOT NULL AND nc.member_birth_date = nc.staging_birth_date
      ) OVER (PARTITION BY nc.staging_id) AS name_birth_candidate_count
    FROM name_candidates nc
  ),
  classified AS (
    SELECT
      s.*,
      CASE
        WHEN s.name_birth_candidate_count = 1
          AND s.staging_birth_date IS NOT NULL
          AND s.member_birth_date = s.staging_birth_date
          THEN 'unique_name_birth'
        WHEN s.name_candidate_count = 1
          THEN 'unique_name_only'
        WHEN s.name_candidate_count > 1
          THEN 'multiple_same_name'
        ELSE 'no_candidate'
      END AS bucket
    FROM stats s
    WHERE s.rn = 1
  ),
  updated_name_birth AS (
    UPDATE public.staging_member_matches smm
    SET
      member_id = c.member_id,
      match_status = 'auto_matched',
      match_score = 85,
      auto_classification = 'auto_matched',
      confidence_score = 85,
      auto_rule = 'second_pass_unique_name_birth',
      auto_payload = jsonb_build_object(
        'name_candidate_count', c.name_candidate_count,
        'name_birth_candidate_count', c.name_birth_candidate_count,
        'candidate_member_id', c.member_id
      ),
      auto_decided_at = now(),
      review_note = 'Second pass: unique normalized name and exact birth date',
      reviewed_by = auth.uid(),
      reviewed_at = now()
    FROM classified c
    WHERE
      c.bucket = 'unique_name_birth'
      AND smm.staging_id = c.staging_id
      AND smm.match_status = 'needs_review'
    RETURNING
      c.staging_id,
      c.member_id,
      c.staging_name,
      c.staging_phone,
      c.staging_birth_date,
      c.staging_gender,
      c.staging_family_num,
      c.staging_relationship,
      c.staging_address,
      c.member_name,
      c.member_phone,
      c.member_birth_date,
      c.member_gender,
      c.member_address,
      c.member_relationship
  ),
  updated_name_only AS (
    UPDATE public.staging_member_matches smm
    SET
      member_id = c.member_id,
      match_status = 'needs_review',
      match_score = 55,
      auto_classification = 'needs_review',
      confidence_score = 55,
      auto_rule = 'second_pass_unique_name_only',
      auto_payload = jsonb_build_object(
        'name_candidate_count', c.name_candidate_count,
        'candidate_member_id', c.member_id
      ),
      auto_decided_at = now(),
      review_note = 'Second pass: unique normalized name only; quick human confirmation recommended',
      reviewed_by = auth.uid(),
      reviewed_at = now()
    FROM classified c
    WHERE
      c.bucket = 'unique_name_only'
      AND smm.staging_id = c.staging_id
      AND smm.match_status = 'needs_review'
    RETURNING smm.staging_id
  ),
  updated_multiple_name AS (
    UPDATE public.staging_member_matches smm
    SET
      member_id = NULL,
      match_status = 'hold',
      match_score = 25,
      auto_classification = 'hold',
      confidence_score = 25,
      auto_rule = 'second_pass_multiple_same_name',
      auto_payload = jsonb_build_object(
        'name_candidate_count', c.name_candidate_count
      ),
      auto_decided_at = now(),
      review_note = 'Second pass: duplicate normalized names; manual disambiguation required',
      reviewed_by = auth.uid(),
      reviewed_at = now()
    FROM classified c
    WHERE
      c.bucket = 'multiple_same_name'
      AND smm.staging_id = c.staging_id
      AND smm.match_status = 'needs_review'
    RETURNING smm.staging_id
  ),
  decision_rows AS (
    SELECT
      u.staging_id,
      u.member_id,
      field_name,
      CASE field_name
        WHEN 'name' THEN
          CASE WHEN u.staging_name = u.member_name THEN 'keep_supabase' ELSE 'use_mdb' END
        WHEN 'birth_date' THEN
          CASE
            WHEN u.staging_birth_date IS NULL THEN 'keep_supabase'
            WHEN u.staging_birth_date = u.member_birth_date THEN 'keep_supabase'
            ELSE 'use_mdb'
          END
        WHEN 'phone' THEN
          CASE
            WHEN u.staging_phone IS NULL THEN 'keep_supabase'
            WHEN u.staging_phone = u.member_phone THEN 'keep_supabase'
            ELSE 'use_mdb'
          END
        WHEN 'address' THEN
          CASE
            WHEN NULLIF(u.staging_address, '') IS NULL THEN 'keep_supabase'
            WHEN NULLIF(u.member_address, '') IS NULL THEN 'use_mdb'
            WHEN u.staging_address = u.member_address THEN 'keep_supabase'
            ELSE 'use_mdb'
          END
        WHEN 'gender' THEN
          CASE
            WHEN u.staging_gender IS NULL THEN 'keep_supabase'
            WHEN u.staging_gender = u.member_gender THEN 'keep_supabase'
            ELSE 'use_mdb'
          END
        WHEN 'relationship_in_household' THEN
          CASE
            WHEN u.staging_relationship IS NULL THEN 'keep_supabase'
            WHEN u.staging_relationship = u.member_relationship THEN 'keep_supabase'
            ELSE 'use_mdb'
          END
        ELSE 'not_applicable'
      END AS decision,
      CASE field_name
        WHEN 'name' THEN to_jsonb(u.staging_name)
        WHEN 'birth_date' THEN to_jsonb(u.staging_birth_date)
        WHEN 'phone' THEN to_jsonb(u.staging_phone)
        WHEN 'address' THEN to_jsonb(u.staging_address)
        WHEN 'gender' THEN to_jsonb(u.staging_gender)
        WHEN 'relationship_in_household' THEN to_jsonb(u.staging_relationship)
        ELSE NULL
      END AS mdb_value,
      CASE field_name
        WHEN 'name' THEN to_jsonb(u.member_name)
        WHEN 'birth_date' THEN to_jsonb(u.member_birth_date)
        WHEN 'phone' THEN to_jsonb(u.member_phone)
        WHEN 'address' THEN to_jsonb(u.member_address)
        WHEN 'gender' THEN to_jsonb(u.member_gender)
        WHEN 'relationship_in_household' THEN to_jsonb(u.member_relationship)
        ELSE NULL
      END AS supabase_value
    FROM updated_name_birth u
    CROSS JOIN (
      VALUES
        ('name'),
        ('birth_date'),
        ('phone'),
        ('address'),
        ('gender'),
        ('relationship_in_household')
    ) AS fields(field_name)
  ),
  inserted_decisions AS (
    INSERT INTO public.staging_member_field_decisions (
      staging_id,
      member_id,
      field_name,
      decision,
      mdb_value,
      supabase_value,
      final_value,
      reviewed_by,
      reviewed_at
    )
    SELECT
      d.staging_id,
      d.member_id,
      d.field_name,
      d.decision,
      d.mdb_value,
      d.supabase_value,
      NULL,
      auth.uid(),
      now()
    FROM decision_rows d
    ON CONFLICT (staging_id, member_id, field_name)
    DO UPDATE SET
      decision = EXCLUDED.decision,
      mdb_value = EXCLUDED.mdb_value,
      supabase_value = EXCLUDED.supabase_value,
      final_value = EXCLUDED.final_value,
      reviewed_by = EXCLUDED.reviewed_by,
      reviewed_at = EXCLUDED.reviewed_at
    RETURNING staging_id
  )
  SELECT 'auto_matched_unique_name_birth'::text, count(*)::bigint FROM updated_name_birth
  UNION ALL
  SELECT 'recommended_unique_name_only'::text, count(*)::bigint FROM updated_name_only
  UNION ALL
  SELECT 'held_multiple_same_name'::text, count(*)::bigint FROM updated_multiple_name
  UNION ALL
  SELECT 'field_decisions_inserted'::text, count(*)::bigint FROM inserted_decisions
  ORDER BY 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_run_second_pass(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
