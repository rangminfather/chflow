-- 후보자: photo_url 저장 + 수정 RPC 추가
-- ─────────────────────────────────────────────

-- 1. admin_add_vote_candidate: photo_url 파라미터 추가
DROP FUNCTION IF EXISTS public.admin_add_vote_candidate(uuid, text, text, int);

CREATE OR REPLACE FUNCTION public.admin_add_vote_candidate(
  p_vote_id       uuid,
  p_name          text,
  p_description   text DEFAULT NULL,
  p_display_order int  DEFAULT 0,
  p_photo_url     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_new_id uuid;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid() AND status = 'active';
  IF v_role NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO vote_candidates (vote_id, name, description, display_order, photo_url)
  VALUES (p_vote_id, p_name, p_description, p_display_order, p_photo_url)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_add_vote_candidate(uuid, text, text, int, text) TO authenticated;

-- 2. admin_update_vote_candidate: 후보 수정 (이름/설명/사진)
CREATE OR REPLACE FUNCTION public.admin_update_vote_candidate(
  p_candidate_id uuid,
  p_name         text,
  p_description  text DEFAULT NULL,
  p_photo_url    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid() AND status = 'active';
  IF v_role NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE vote_candidates
  SET name = p_name,
      description = p_description,
      photo_url = p_photo_url
  WHERE id = p_candidate_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_update_vote_candidate(uuid, text, text, text) TO authenticated;
