-- =============================================================
-- 항존직 투표 기능
-- Tables: votes, vote_candidates, vote_ballots
-- =============================================================

-- ─────────────────────────────────────────────
-- 1. 테이블 생성
-- ─────────────────────────────────────────────

CREATE TABLE public.votes (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  title       text        NOT NULL,
  description text,
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  is_active   boolean     DEFAULT false NOT NULL,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE public.vote_candidates (
  id            uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  vote_id       uuid    REFERENCES public.votes(id) ON DELETE CASCADE NOT NULL,
  name          text    NOT NULL,
  description   text,
  display_order int     DEFAULT 0 NOT NULL,
  photo_url     text,
  created_at    timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE public.vote_ballots (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  vote_id      uuid        REFERENCES public.votes(id) ON DELETE CASCADE NOT NULL,
  candidate_id uuid        REFERENCES public.vote_candidates(id) ON DELETE CASCADE NOT NULL,
  voter_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at   timestamptz DEFAULT now() NOT NULL,
  UNIQUE (vote_id, voter_id)   -- 중복 투표 방지 (DB 레벨)
);

-- ─────────────────────────────────────────────
-- 2. RLS 활성화
-- ─────────────────────────────────────────────

ALTER TABLE public.votes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_ballots    ENABLE ROW LEVEL SECURITY;

-- votes: 인증된 사용자는 읽기, admin/office/pastor만 쓰기
CREATE POLICY "votes_read_authenticated"
  ON public.votes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "votes_write_admin"
  ON public.votes FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'office', 'pastor')
        AND status = 'active'
    )
  );

-- vote_candidates: 인증된 사용자는 읽기, admin만 쓰기
CREATE POLICY "vote_candidates_read_authenticated"
  ON public.vote_candidates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "vote_candidates_write_admin"
  ON public.vote_candidates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'office', 'pastor')
        AND status = 'active'
    )
  );

-- vote_ballots: 자신의 투표만 읽기, admin은 전체 읽기, 투표는 자신만
CREATE POLICY "vote_ballots_read_own"
  ON public.vote_ballots FOR SELECT
  TO authenticated
  USING (
    voter_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'office', 'pastor')
        AND status = 'active'
    )
  );

CREATE POLICY "vote_ballots_insert_own"
  ON public.vote_ballots FOR INSERT
  TO authenticated
  WITH CHECK (voter_id = auth.uid());

-- ─────────────────────────────────────────────
-- 3. RPC 함수
-- ─────────────────────────────────────────────

-- 관리자: 투표 목록 전체 조회
CREATE OR REPLACE FUNCTION public.admin_get_votes()
RETURNS TABLE (
  id          uuid,
  title       text,
  description text,
  start_at    timestamptz,
  end_at      timestamptz,
  is_active   boolean,
  created_at  timestamptz,
  candidate_count bigint,
  ballot_count    bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id, v.title, v.description, v.start_at, v.end_at, v.is_active, v.created_at,
    (SELECT COUNT(*) FROM vote_candidates vc WHERE vc.vote_id = v.id) AS candidate_count,
    (SELECT COUNT(*) FROM vote_ballots   vb WHERE vb.vote_id = v.id) AS ballot_count
  FROM votes v
  ORDER BY v.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_votes() TO authenticated;

-- 관리자: 투표 생성
CREATE OR REPLACE FUNCTION public.admin_create_vote(
  p_title       text,
  p_description text DEFAULT NULL,
  p_start_at    timestamptz DEFAULT NULL,
  p_end_at      timestamptz DEFAULT NULL
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

  INSERT INTO votes (title, description, start_at, end_at, is_active, created_by)
  VALUES (
    p_title,
    p_description,
    COALESCE(p_start_at, now()),
    COALESCE(p_end_at, now() + interval '7 days'),
    false,
    auth.uid()
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_create_vote(text, text, timestamptz, timestamptz) TO authenticated;

-- 관리자: 투표 수정
CREATE OR REPLACE FUNCTION public.admin_update_vote(
  p_vote_id     uuid,
  p_title       text,
  p_description text DEFAULT NULL,
  p_start_at    timestamptz DEFAULT NULL,
  p_end_at      timestamptz DEFAULT NULL,
  p_is_active   boolean DEFAULT NULL
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

  UPDATE votes SET
    title       = COALESCE(p_title, title),
    description = COALESCE(p_description, description),
    start_at    = COALESCE(p_start_at, start_at),
    end_at      = COALESCE(p_end_at, end_at),
    is_active   = COALESCE(p_is_active, is_active)
  WHERE id = p_vote_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_update_vote(uuid, text, text, timestamptz, timestamptz, boolean) TO authenticated;

-- 관리자: 투표 삭제
CREATE OR REPLACE FUNCTION public.admin_delete_vote(p_vote_id uuid)
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
  DELETE FROM votes WHERE id = p_vote_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_delete_vote(uuid) TO authenticated;

-- 관리자: 후보자 추가
CREATE OR REPLACE FUNCTION public.admin_add_vote_candidate(
  p_vote_id       uuid,
  p_name          text,
  p_description   text DEFAULT NULL,
  p_display_order int  DEFAULT 0
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

  INSERT INTO vote_candidates (vote_id, name, description, display_order)
  VALUES (p_vote_id, p_name, p_description, p_display_order)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_add_vote_candidate(uuid, text, text, int) TO authenticated;

-- 관리자: 후보자 삭제
CREATE OR REPLACE FUNCTION public.admin_delete_vote_candidate(p_candidate_id uuid)
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
  DELETE FROM vote_candidates WHERE id = p_candidate_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_delete_vote_candidate(uuid) TO authenticated;

-- 관리자: 투표 결과 집계
CREATE OR REPLACE FUNCTION public.admin_get_vote_results(p_vote_id uuid)
RETURNS TABLE (
  candidate_id    uuid,
  candidate_name  text,
  display_order   int,
  vote_count      bigint,
  total_ballots   bigint,
  vote_rate_pct   numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH totals AS (
    SELECT COUNT(*) AS total FROM vote_ballots WHERE vote_id = p_vote_id
  )
  SELECT
    vc.id   AS candidate_id,
    vc.name AS candidate_name,
    vc.display_order,
    COUNT(vb.id)   AS vote_count,
    (SELECT total FROM totals) AS total_ballots,
    CASE WHEN (SELECT total FROM totals) = 0 THEN 0
         ELSE ROUND(COUNT(vb.id)::numeric / (SELECT total FROM totals) * 100, 1)
    END AS vote_rate_pct
  FROM vote_candidates vc
  LEFT JOIN vote_ballots vb ON vb.candidate_id = vc.id AND vb.vote_id = p_vote_id
  WHERE vc.vote_id = p_vote_id
  GROUP BY vc.id, vc.name, vc.display_order
  ORDER BY vote_count DESC, vc.display_order;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_vote_results(uuid) TO authenticated;

-- 교인: 현재 진행 중인 투표 목록
CREATE OR REPLACE FUNCTION public.get_active_votes()
RETURNS TABLE (
  id          uuid,
  title       text,
  description text,
  start_at    timestamptz,
  end_at      timestamptz,
  already_voted boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id, v.title, v.description, v.start_at, v.end_at,
    EXISTS (
      SELECT 1 FROM vote_ballots vb
      WHERE vb.vote_id = v.id AND vb.voter_id = auth.uid()
    ) AS already_voted
  FROM votes v
  WHERE v.is_active = true
    AND now() BETWEEN v.start_at AND v.end_at
  ORDER BY v.start_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_active_votes() TO authenticated;

-- 교인: 특정 투표 상세 (후보 목록 + 내 투표 여부)
CREATE OR REPLACE FUNCTION public.get_vote_detail(p_vote_id uuid)
RETURNS TABLE (
  vote_id         uuid,
  vote_title      text,
  vote_desc       text,
  start_at        timestamptz,
  end_at          timestamptz,
  is_active       boolean,
  already_voted   boolean,
  my_candidate_id uuid,
  candidate_id    uuid,
  candidate_name  text,
  candidate_desc  text,
  display_order   int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id           AS vote_id,
    v.title        AS vote_title,
    v.description  AS vote_desc,
    v.start_at,
    v.end_at,
    v.is_active,
    EXISTS (
      SELECT 1 FROM vote_ballots vb
      WHERE vb.vote_id = v.id AND vb.voter_id = auth.uid()
    ) AS already_voted,
    (
      SELECT vb.candidate_id FROM vote_ballots vb
      WHERE vb.vote_id = v.id AND vb.voter_id = auth.uid()
    ) AS my_candidate_id,
    vc.id          AS candidate_id,
    vc.name        AS candidate_name,
    vc.description AS candidate_desc,
    vc.display_order
  FROM votes v
  JOIN vote_candidates vc ON vc.vote_id = v.id
  WHERE v.id = p_vote_id
  ORDER BY vc.display_order, vc.name;
$$;
GRANT EXECUTE ON FUNCTION public.get_vote_detail(uuid) TO authenticated;

-- 교인: 투표 제출
CREATE OR REPLACE FUNCTION public.cast_vote(
  p_vote_id      uuid,
  p_candidate_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vote votes%ROWTYPE;
BEGIN
  SELECT * INTO v_vote FROM votes WHERE id = p_vote_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '투표를 찾을 수 없습니다.';
  END IF;

  IF NOT v_vote.is_active THEN
    RAISE EXCEPTION '투표가 활성화되지 않았습니다.';
  END IF;

  IF now() < v_vote.start_at THEN
    RAISE EXCEPTION '투표 기간이 아직 시작되지 않았습니다.';
  END IF;

  IF now() > v_vote.end_at THEN
    RAISE EXCEPTION '투표 기간이 종료되었습니다.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vote_candidates WHERE id = p_candidate_id AND vote_id = p_vote_id) THEN
    RAISE EXCEPTION '유효하지 않은 후보입니다.';
  END IF;

  INSERT INTO vote_ballots (vote_id, candidate_id, voter_id)
  VALUES (p_vote_id, p_candidate_id, auth.uid());

  RETURN 'ok';
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION '이미 투표하셨습니다.';
END;
$$;
GRANT EXECUTE ON FUNCTION public.cast_vote(uuid, uuid) TO authenticated;
