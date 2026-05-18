-- MDB review auto-classification pipeline.
-- This does not update public.members. It only stores review recommendations.

ALTER TABLE public.staging_member_matches
  DROP CONSTRAINT IF EXISTS staging_member_matches_match_status_check;

ALTER TABLE public.staging_member_matches
  ADD CONSTRAINT staging_member_matches_match_status_check
  CHECK (match_status IN (
    'unreviewed',
    'auto_matched',
    'needs_review',
    'matched',
    'new_member',
    'hold',
    'ignored',
    'applied'
  ));

ALTER TABLE public.staging_member_matches
  ADD COLUMN IF NOT EXISTS auto_classification text,
  ADD COLUMN IF NOT EXISTS confidence_score integer,
  ADD COLUMN IF NOT EXISTS auto_rule text,
  ADD COLUMN IF NOT EXISTS auto_payload jsonb,
  ADD COLUMN IF NOT EXISTS auto_decided_at timestamptz;

ALTER TABLE public.staging_member_matches
  DROP CONSTRAINT IF EXISTS staging_member_matches_auto_classification_check;

ALTER TABLE public.staging_member_matches
  ADD CONSTRAINT staging_member_matches_auto_classification_check
  CHECK (
    auto_classification IS NULL
    OR auto_classification IN ('auto_matched', 'needs_review', 'hold')
  );

CREATE INDEX IF NOT EXISTS idx_smm_auto_classification
  ON public.staging_member_matches (auto_classification);


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
  auto_classification text,
  confidence_score integer,
  auto_rule text,
  auto_decided_at timestamptz,
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
      smm.auto_classification,
      smm.confidence_score,
      smm.auto_rule,
      smm.auto_decided_at,
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
        OR (
          cb.staging_family_num IS NOT NULL
          AND m.legacy_family_num = cb.staging_family_num
          AND m.name = cb.staging_name
        )
      )
  ),
  filtered AS (
    SELECT
      r.staging_id,
      r.staging_source_row_no,
      COALESCE(r.match_status, 'unreviewed') AS match_status,
      r.matched_member_id,
      COALESCE(r.match_score, r.computed_score) AS match_score,
      r.auto_classification,
      r.confidence_score,
      r.auto_rule,
      r.auto_decided_at,
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


DROP FUNCTION IF EXISTS public.admin_mdb_review_run_auto_classification(integer);

CREATE OR REPLACE FUNCTION public.admin_mdb_review_run_auto_classification(
  p_limit integer DEFAULT 5000
)
RETURNS TABLE (
  match_status text,
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
      s.*
    FROM public.staging_members_mdb s
    LEFT JOIN public.staging_member_matches smm
      ON smm.staging_id = s.id
    WHERE COALESCE(smm.match_status, 'unreviewed') = 'unreviewed'
    ORDER BY s.id
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  ),
  scored AS (
    SELECT
      e.id AS staging_id,
      e.name AS staging_name,
      e.phone AS staging_phone,
      e.birth_date AS staging_birth_date,
      e.gender AS staging_gender,
      e.legacy_kyoin_id AS staging_legacy_kyoin_id,
      e.legacy_family_num AS staging_family_num,
      e.relationship_in_household AS staging_relationship,
      trim(concat_ws(' ', e.address_line_1, e.address_line_2)) AS staging_address,
      m.id AS member_id,
      m.name AS member_name,
      m.phone AS member_phone,
      m.birth_date AS member_birth_date,
      m.gender AS member_gender,
      m.address AS member_address,
      m.legacy_kyoin_id AS member_legacy_kyoin_id,
      m.legacy_family_num AS member_family_num,
      m.relationship_in_household AS member_relationship,
      (e.legacy_kyoin_id IS NOT NULL AND m.legacy_kyoin_id = e.legacy_kyoin_id) AS legacy_equal,
      (e.phone IS NOT NULL AND m.phone = e.phone) AS phone_equal,
      (m.name = e.name) AS name_equal,
      (e.birth_date IS NOT NULL AND m.birth_date = e.birth_date) AS birth_equal,
      (e.legacy_family_num IS NOT NULL AND m.legacy_family_num = e.legacy_family_num) AS family_equal,
      (
        CASE WHEN e.legacy_kyoin_id IS NOT NULL AND m.legacy_kyoin_id = e.legacy_kyoin_id THEN 100 ELSE 0 END +
        CASE WHEN e.phone IS NOT NULL AND m.phone = e.phone THEN 45 ELSE 0 END +
        CASE WHEN m.name = e.name THEN 25 ELSE 0 END +
        CASE WHEN e.birth_date IS NOT NULL AND m.birth_date = e.birth_date THEN 20 ELSE 0 END +
        CASE WHEN e.legacy_family_num IS NOT NULL AND m.legacy_family_num = e.legacy_family_num THEN 10 ELSE 0 END
      ) AS score
    FROM eligible e
    LEFT JOIN public.members m
      ON (
        (e.legacy_kyoin_id IS NOT NULL AND m.legacy_kyoin_id = e.legacy_kyoin_id)
        OR (e.phone IS NOT NULL AND m.phone = e.phone)
        OR m.name = e.name
        OR (
          e.legacy_family_num IS NOT NULL
          AND m.legacy_family_num = e.legacy_family_num
          AND m.name = e.name
        )
      )
  ),
  scored_with_max AS (
    SELECT
      s.*,
      max(s.score) OVER (PARTITION BY s.staging_id) AS best_score,
      count(s.member_id) OVER (PARTITION BY s.staging_id) AS candidate_count
    FROM scored s
  ),
  ranked AS (
    SELECT
      s.*,
      count(*) FILTER (
        WHERE s.member_id IS NOT NULL AND s.score = s.best_score
      ) OVER (PARTITION BY s.staging_id) AS top_candidate_count,
      row_number() OVER (
        PARTITION BY s.staging_id
        ORDER BY s.score DESC, s.member_id
      ) AS rn
    FROM scored_with_max s
  ),
  classified AS (
    SELECT
      r.*,
      CASE
        WHEN r.member_id IS NOT NULL
          AND r.top_candidate_count = 1
          AND (
            r.legacy_equal
            OR (r.phone_equal AND r.name_equal AND r.birth_equal)
            OR (r.phone_equal AND r.name_equal AND r.family_equal)
          )
          THEN 'auto_matched'
        WHEN r.member_id IS NOT NULL
          AND r.top_candidate_count > 1
          AND r.best_score >= 70
          THEN 'hold'
        ELSE 'needs_review'
      END AS next_status,
      CASE
        WHEN r.member_id IS NOT NULL
          AND r.top_candidate_count = 1
          AND r.legacy_equal
          THEN 'legacy_id_exact'
        WHEN r.member_id IS NOT NULL
          AND r.top_candidate_count = 1
          AND r.phone_equal AND r.name_equal AND r.birth_equal
          THEN 'phone_name_birth_exact'
        WHEN r.member_id IS NOT NULL
          AND r.top_candidate_count = 1
          AND r.phone_equal AND r.name_equal AND r.family_equal
          THEN 'phone_name_family_exact'
        WHEN r.member_id IS NOT NULL
          AND r.top_candidate_count > 1
          AND r.best_score >= 70
          THEN 'ambiguous_top_candidates'
        WHEN r.member_id IS NULL
          THEN 'no_candidate'
        ELSE 'candidate_needs_review'
      END AS rule_code
    FROM ranked r
    WHERE r.rn = 1
  ),
  upserted AS (
    INSERT INTO public.staging_member_matches (
      staging_id,
      member_id,
      match_status,
      match_score,
      auto_classification,
      confidence_score,
      auto_rule,
      auto_payload,
      auto_decided_at,
      review_note,
      reviewed_by,
      reviewed_at
    )
    SELECT
      c.staging_id,
      CASE WHEN c.next_status = 'auto_matched' THEN c.member_id ELSE NULL END,
      c.next_status,
      COALESCE(c.best_score, 0),
      c.next_status,
      COALESCE(c.best_score, 0),
      c.rule_code,
      jsonb_build_object(
        'candidate_count', c.candidate_count,
        'top_candidate_count', c.top_candidate_count,
        'candidate_member_id', c.member_id,
        'phone_equal', COALESCE(c.phone_equal, false),
        'name_equal', COALESCE(c.name_equal, false),
        'birth_equal', COALESCE(c.birth_equal, false),
        'family_equal', COALESCE(c.family_equal, false),
        'legacy_equal', COALESCE(c.legacy_equal, false)
      ),
      now(),
      CASE c.next_status
        WHEN 'auto_matched' THEN '자동 고신뢰 매칭: 실제 members 반영 전 검토 가능'
        WHEN 'hold' THEN '자동 보류: 동점/충돌 후보가 있어 사람 검수 필요'
        ELSE '자동 분류: 사람 검수 필요'
      END,
      auth.uid(),
      now()
    FROM classified c
    ON CONFLICT (staging_id)
    DO UPDATE SET
      member_id = EXCLUDED.member_id,
      match_status = EXCLUDED.match_status,
      match_score = EXCLUDED.match_score,
      auto_classification = EXCLUDED.auto_classification,
      confidence_score = EXCLUDED.confidence_score,
      auto_rule = EXCLUDED.auto_rule,
      auto_payload = EXCLUDED.auto_payload,
      auto_decided_at = EXCLUDED.auto_decided_at,
      review_note = EXCLUDED.review_note,
      reviewed_by = EXCLUDED.reviewed_by,
      reviewed_at = EXCLUDED.reviewed_at
    WHERE public.staging_member_matches.match_status = 'unreviewed'
    RETURNING
      public.staging_member_matches.staging_id,
      public.staging_member_matches.member_id,
      public.staging_member_matches.match_status
  ),
  decision_rows AS (
    SELECT
      c.staging_id,
      c.member_id,
      field_name,
      CASE field_name
        WHEN 'name' THEN
          CASE WHEN c.staging_name = c.member_name THEN 'keep_supabase' ELSE 'use_mdb' END
        WHEN 'birth_date' THEN
          CASE
            WHEN c.staging_birth_date IS NULL THEN 'keep_supabase'
            WHEN c.staging_birth_date = c.member_birth_date THEN 'keep_supabase'
            ELSE 'use_mdb'
          END
        WHEN 'phone' THEN
          CASE
            WHEN c.staging_phone IS NULL THEN 'keep_supabase'
            WHEN c.staging_phone = c.member_phone THEN 'keep_supabase'
            ELSE 'use_mdb'
          END
        WHEN 'address' THEN
          CASE
            WHEN NULLIF(c.staging_address, '') IS NULL THEN 'keep_supabase'
            WHEN NULLIF(c.member_address, '') IS NULL THEN 'use_mdb'
            WHEN c.staging_address = c.member_address THEN 'keep_supabase'
            ELSE 'use_mdb'
          END
        WHEN 'gender' THEN
          CASE
            WHEN c.staging_gender IS NULL THEN 'keep_supabase'
            WHEN c.staging_gender = c.member_gender THEN 'keep_supabase'
            ELSE 'use_mdb'
          END
        WHEN 'relationship_in_household' THEN
          CASE
            WHEN c.staging_relationship IS NULL THEN 'keep_supabase'
            WHEN c.staging_relationship = c.member_relationship THEN 'keep_supabase'
            ELSE 'use_mdb'
          END
        ELSE 'not_applicable'
      END AS decision,
      CASE field_name
        WHEN 'name' THEN to_jsonb(c.staging_name)
        WHEN 'birth_date' THEN to_jsonb(c.staging_birth_date)
        WHEN 'phone' THEN to_jsonb(c.staging_phone)
        WHEN 'address' THEN to_jsonb(c.staging_address)
        WHEN 'gender' THEN to_jsonb(c.staging_gender)
        WHEN 'relationship_in_household' THEN to_jsonb(c.staging_relationship)
        ELSE NULL
      END AS mdb_value,
      CASE field_name
        WHEN 'name' THEN to_jsonb(c.member_name)
        WHEN 'birth_date' THEN to_jsonb(c.member_birth_date)
        WHEN 'phone' THEN to_jsonb(c.member_phone)
        WHEN 'address' THEN to_jsonb(c.member_address)
        WHEN 'gender' THEN to_jsonb(c.member_gender)
        WHEN 'relationship_in_household' THEN to_jsonb(c.member_relationship)
        ELSE NULL
      END AS supabase_value
    FROM classified c
    JOIN upserted u
      ON u.staging_id = c.staging_id
      AND u.member_id = c.member_id
      AND u.match_status = 'auto_matched'
    CROSS JOIN (
      VALUES
        ('name'),
        ('birth_date'),
        ('phone'),
        ('address'),
        ('gender'),
        ('relationship_in_household')
    ) AS fields(field_name)
    WHERE c.next_status = 'auto_matched'
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
  SELECT
    u.match_status,
    count(*) AS affected_count
  FROM upserted u
  GROUP BY u.match_status
  ORDER BY u.match_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_run_auto_classification(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
