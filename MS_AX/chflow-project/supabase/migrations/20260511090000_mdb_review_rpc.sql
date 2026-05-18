-- =============================================================
-- MDB merge review schema and RPC
-- Purpose:
-- - compare public.members with public.staging_members_mdb
-- - let admins confirm match / hold / new member
-- - store field-by-field merge decisions
-- - apply only reviewed fields to live members
-- =============================================================

-- =============================================================
-- 1. members extension for legacy MDB tracking
-- =============================================================
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS legacy_kyoin_id text,
  ADD COLUMN IF NOT EXISTS legacy_family_num text,
  ADD COLUMN IF NOT EXISTS relationship_in_household text;

CREATE INDEX IF NOT EXISTS idx_members_legacy_kyoin_id
  ON public.members (legacy_kyoin_id);

CREATE INDEX IF NOT EXISTS idx_members_legacy_family_num
  ON public.members (legacy_family_num);


-- =============================================================
-- 2. review tables
-- =============================================================
CREATE TABLE IF NOT EXISTS public.staging_member_matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_id    bigint NOT NULL REFERENCES public.staging_members_mdb(id) ON DELETE CASCADE,
  member_id     uuid REFERENCES public.members(id) ON DELETE SET NULL,
  match_status  text NOT NULL DEFAULT 'unreviewed'
               CHECK (match_status IN ('unreviewed', 'matched', 'new_member', 'hold', 'ignored', 'applied')),
  match_score   integer,
  review_note   text,
  reviewed_by   uuid REFERENCES auth.users(id),
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staging_id)
);

CREATE INDEX IF NOT EXISTS idx_smm_status
  ON public.staging_member_matches (match_status);

CREATE INDEX IF NOT EXISTS idx_smm_member_id
  ON public.staging_member_matches (member_id);


CREATE TABLE IF NOT EXISTS public.staging_member_field_decisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_id     bigint NOT NULL REFERENCES public.staging_members_mdb(id) ON DELETE CASCADE,
  member_id      uuid REFERENCES public.members(id) ON DELETE CASCADE,
  field_name     text NOT NULL,
  decision       text NOT NULL DEFAULT 'not_applicable'
                CHECK (decision IN ('use_mdb', 'keep_supabase', 'manual_edit', 'not_applicable')),
  mdb_value      jsonb,
  supabase_value jsonb,
  final_value    jsonb,
  reviewed_by    uuid REFERENCES auth.users(id),
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staging_id, member_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_smfd_staging_member
  ON public.staging_member_field_decisions (staging_id, member_id);


-- =============================================================
-- 3. row-level security
-- =============================================================
ALTER TABLE public.staging_member_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_member_field_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staging_member_matches_select_admin" ON public.staging_member_matches;
CREATE POLICY "staging_member_matches_select_admin"
  ON public.staging_member_matches FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'office', 'pastor'));

DROP POLICY IF EXISTS "staging_member_matches_write_admin" ON public.staging_member_matches;
CREATE POLICY "staging_member_matches_write_admin"
  ON public.staging_member_matches FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'office', 'pastor'))
  WITH CHECK (public.get_user_role() IN ('admin', 'office', 'pastor'));

DROP POLICY IF EXISTS "staging_member_field_decisions_select_admin" ON public.staging_member_field_decisions;
CREATE POLICY "staging_member_field_decisions_select_admin"
  ON public.staging_member_field_decisions FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'office', 'pastor'));

DROP POLICY IF EXISTS "staging_member_field_decisions_write_admin" ON public.staging_member_field_decisions;
CREATE POLICY "staging_member_field_decisions_write_admin"
  ON public.staging_member_field_decisions FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'office', 'pastor'))
  WITH CHECK (public.get_user_role() IN ('admin', 'office', 'pastor'));


-- =============================================================
-- 4. candidate list RPC
-- Returns staging rows plus best current member candidate.
-- Scoring:
--  - exact phone: +60
--  - exact name: +25
--  - exact birth_date: +10
--  - exact legacy family: +10
-- =============================================================
DROP FUNCTION IF EXISTS public.admin_mdb_review_candidates(text, text, integer);
CREATE OR REPLACE FUNCTION public.admin_mdb_review_candidates(
  p_status text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 100
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
  review_note text
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
  )
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
  ORDER BY COALESCE(r.match_status, 'unreviewed'), COALESCE(r.match_score, r.computed_score) DESC, r.staging_id
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_candidates(text, text, integer) TO authenticated;


-- =============================================================
-- 5. set row match result
-- =============================================================
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

  IF p_match_status NOT IN ('unreviewed', 'matched', 'new_member', 'hold', 'ignored', 'applied') THEN
    RAISE EXCEPTION 'invalid match status: %', p_match_status;
  END IF;

  INSERT INTO public.staging_member_matches (
    staging_id, member_id, match_status, match_score, review_note, reviewed_by, reviewed_at
  )
  VALUES (
    p_staging_id, p_member_id, p_match_status, p_match_score, p_review_note, auth.uid(), now()
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


-- =============================================================
-- 6. set field decision
-- =============================================================
DROP FUNCTION IF EXISTS public.admin_mdb_review_set_field_decision(bigint, uuid, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.admin_mdb_review_set_field_decision(
  p_staging_id bigint,
  p_member_id uuid,
  p_field_name text,
  p_decision text,
  p_final_value jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mdb jsonb;
  v_supabase jsonb;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF p_decision NOT IN ('use_mdb', 'keep_supabase', 'manual_edit', 'not_applicable') THEN
    RAISE EXCEPTION 'invalid field decision: %', p_decision;
  END IF;

  SELECT
    CASE p_field_name
      WHEN 'name' THEN to_jsonb(s.name)
      WHEN 'birth_date' THEN to_jsonb(s.birth_date)
      WHEN 'phone' THEN to_jsonb(s.phone)
      WHEN 'address' THEN to_jsonb(trim(concat_ws(' ', s.address_line_1, s.address_line_2)))
      WHEN 'gender' THEN to_jsonb(s.gender)
      WHEN 'legacy_kyoin_id' THEN to_jsonb(s.legacy_kyoin_id)
      WHEN 'legacy_family_num' THEN to_jsonb(s.legacy_family_num)
      WHEN 'relationship_in_household' THEN to_jsonb(s.relationship_in_household)
      ELSE NULL
    END
  INTO v_mdb
  FROM public.staging_members_mdb s
  WHERE s.id = p_staging_id;

  SELECT
    CASE p_field_name
      WHEN 'name' THEN to_jsonb(m.name)
      WHEN 'birth_date' THEN to_jsonb(m.birth_date)
      WHEN 'phone' THEN to_jsonb(m.phone)
      WHEN 'address' THEN to_jsonb(m.address)
      WHEN 'gender' THEN to_jsonb(m.gender)
      WHEN 'legacy_kyoin_id' THEN to_jsonb(m.legacy_kyoin_id)
      WHEN 'legacy_family_num' THEN to_jsonb(m.legacy_family_num)
      WHEN 'relationship_in_household' THEN to_jsonb(m.relationship_in_household)
      ELSE NULL
    END
  INTO v_supabase
  FROM public.members m
  WHERE m.id = p_member_id;

  INSERT INTO public.staging_member_field_decisions (
    staging_id, member_id, field_name, decision, mdb_value, supabase_value, final_value, reviewed_by, reviewed_at
  )
  VALUES (
    p_staging_id, p_member_id, p_field_name, p_decision, v_mdb, v_supabase, p_final_value, auth.uid(), now()
  )
  ON CONFLICT (staging_id, member_id, field_name)
  DO UPDATE SET
    decision = EXCLUDED.decision,
    mdb_value = EXCLUDED.mdb_value,
    supabase_value = EXCLUDED.supabase_value,
    final_value = EXCLUDED.final_value,
    reviewed_by = EXCLUDED.reviewed_by,
    reviewed_at = EXCLUDED.reviewed_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_set_field_decision(bigint, uuid, text, text, jsonb) TO authenticated;


-- =============================================================
-- 7. create new member from staging
-- Used when review confirms no existing member should be matched.
-- =============================================================
DROP FUNCTION IF EXISTS public.admin_mdb_review_create_member(bigint, text);
CREATE OR REPLACE FUNCTION public.admin_mdb_review_create_member(
  p_staging_id bigint,
  p_review_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.staging_members_mdb%ROWTYPE;
  v_member_id uuid;
  v_gender text;
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

  v_gender := CASE
    WHEN s.gender IN ('M', 'F') THEN s.gender
    WHEN s.gender = '남' THEN 'M'
    WHEN s.gender = '여' THEN 'F'
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
    relationship_in_household
  )
  VALUES (
    s.name,
    s.phone,
    s.birth_date,
    trim(concat_ws(' ', s.address_line_1, s.address_line_2)),
    v_gender,
    'active',
    s.legacy_kyoin_id,
    s.legacy_family_num,
    s.relationship_in_household
  )
  RETURNING id INTO v_member_id;

  PERFORM public.admin_mdb_review_confirm_match(
    p_staging_id,
    v_member_id,
    'applied',
    100,
    COALESCE(p_review_note, 'created via admin_mdb_review_create_member')
  );

  RETURN v_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_create_member(bigint, text) TO authenticated;


-- =============================================================
-- 8. apply reviewed member update
-- Applies only approved personal identity fields.
-- Operational fields like household/photo/review remain untouched.
-- =============================================================
DROP FUNCTION IF EXISTS public.admin_mdb_review_apply(bigint, uuid);
CREATE OR REPLACE FUNCTION public.admin_mdb_review_apply(
  p_staging_id bigint,
  p_member_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.staging_members_mdb%ROWTYPE;
  v_gender text;
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

  v_gender := CASE
    WHEN s.gender IN ('M', 'F') THEN s.gender
    WHEN s.gender = '남' THEN 'M'
    WHEN s.gender = '여' THEN 'F'
    ELSE NULL
  END;

  UPDATE public.members m
  SET
    name = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.staging_member_field_decisions d
        WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id
          AND d.field_name = 'name' AND d.decision IN ('use_mdb', 'manual_edit')
      ) THEN COALESCE(
        (SELECT trim(both '"' from d.final_value::text) FROM public.staging_member_field_decisions d
         WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id AND d.field_name = 'name'
         ORDER BY d.reviewed_at DESC NULLS LAST LIMIT 1),
        s.name
      )
      ELSE m.name
    END,
    birth_date = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.staging_member_field_decisions d
        WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id
          AND d.field_name = 'birth_date' AND d.decision IN ('use_mdb', 'manual_edit')
      ) THEN COALESCE(
        (SELECT NULLIF(trim(both '"' from d.final_value::text), '')::date FROM public.staging_member_field_decisions d
         WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id AND d.field_name = 'birth_date'
         ORDER BY d.reviewed_at DESC NULLS LAST LIMIT 1),
        s.birth_date
      )
      ELSE m.birth_date
    END,
    phone = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.staging_member_field_decisions d
        WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id
          AND d.field_name = 'phone' AND d.decision IN ('use_mdb', 'manual_edit')
      ) THEN COALESCE(
        (SELECT trim(both '"' from d.final_value::text) FROM public.staging_member_field_decisions d
         WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id AND d.field_name = 'phone'
         ORDER BY d.reviewed_at DESC NULLS LAST LIMIT 1),
        s.phone
      )
      ELSE m.phone
    END,
    address = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.staging_member_field_decisions d
        WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id
          AND d.field_name = 'address' AND d.decision IN ('use_mdb', 'manual_edit')
      ) THEN COALESCE(
        (SELECT trim(both '"' from d.final_value::text) FROM public.staging_member_field_decisions d
         WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id AND d.field_name = 'address'
         ORDER BY d.reviewed_at DESC NULLS LAST LIMIT 1),
        trim(concat_ws(' ', s.address_line_1, s.address_line_2))
      )
      ELSE m.address
    END,
    gender = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.staging_member_field_decisions d
        WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id
          AND d.field_name = 'gender' AND d.decision IN ('use_mdb', 'manual_edit')
      ) THEN COALESCE(
        (SELECT CASE
            WHEN trim(both '"' from d.final_value::text) IN ('M', 'F') THEN trim(both '"' from d.final_value::text)
            WHEN trim(both '"' from d.final_value::text) = '남' THEN 'M'
            WHEN trim(both '"' from d.final_value::text) = '여' THEN 'F'
            ELSE NULL
          END
         FROM public.staging_member_field_decisions d
         WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id AND d.field_name = 'gender'
         ORDER BY d.reviewed_at DESC NULLS LAST LIMIT 1),
        v_gender
      )
      ELSE m.gender
    END,
    legacy_kyoin_id = COALESCE(s.legacy_kyoin_id, m.legacy_kyoin_id),
    legacy_family_num = COALESCE(s.legacy_family_num, m.legacy_family_num),
    relationship_in_household = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.staging_member_field_decisions d
        WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id
          AND d.field_name = 'relationship_in_household' AND d.decision IN ('use_mdb', 'manual_edit')
      ) THEN COALESCE(
        (SELECT trim(both '"' from d.final_value::text) FROM public.staging_member_field_decisions d
         WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id AND d.field_name = 'relationship_in_household'
         ORDER BY d.reviewed_at DESC NULLS LAST LIMIT 1),
        s.relationship_in_household
      )
      WHEN EXISTS (
        SELECT 1 FROM public.staging_member_field_decisions d
        WHERE d.staging_id = p_staging_id AND d.member_id = p_member_id
          AND d.field_name = 'relationship_in_household' AND d.decision = 'keep_supabase'
      ) THEN m.relationship_in_household
      ELSE COALESCE(s.relationship_in_household, m.relationship_in_household)
    END
  WHERE m.id = p_member_id;

  PERFORM public.admin_mdb_review_confirm_match(
    p_staging_id,
    p_member_id,
    'applied',
    NULL,
    'applied via admin_mdb_review_apply'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_apply(bigint, uuid) TO authenticated;


-- =============================================================
-- 9. optional candidate search by staging row
-- Returns top N candidates for manual review when best match is uncertain.
-- =============================================================
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
    (
      CASE WHEN s.phone IS NOT NULL AND m.phone = s.phone THEN 60 ELSE 0 END +
      CASE WHEN m.name = s.name THEN 25 ELSE 0 END +
      CASE WHEN s.birth_date IS NOT NULL AND m.birth_date = s.birth_date THEN 10 ELSE 0 END +
      CASE WHEN s.legacy_family_num IS NOT NULL AND m.legacy_family_num = s.legacy_family_num THEN 10 ELSE 0 END
    ) AS score
  FROM public.members m
  WHERE
    (s.phone IS NOT NULL AND m.phone = s.phone)
    OR m.name = s.name
    OR (s.birth_date IS NOT NULL AND m.birth_date = s.birth_date)
  ORDER BY score DESC, m.created_at ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_candidate_options(bigint, integer) TO authenticated;
