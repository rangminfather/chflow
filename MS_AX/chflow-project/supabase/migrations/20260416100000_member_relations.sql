-- =============================================================
-- 가족 관계(부모/조부모/배우자) + 성별
-- 가입 플로우: 청소년 이하가 부모·조부모 직접 등록하기 위한 기반
-- =============================================================

-- 1) 성별
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('M','F'));

CREATE INDEX IF NOT EXISTS idx_members_gender ON public.members(gender);


-- 2) 관계 테이블 (유향 엣지: subject → relative)
-- kind: 관계 단계(parent=1촌, grandparent=2촌, great_grandparent=3촌, spouse, sibling)
-- role: 성별/계통까지 명시
CREATE TABLE IF NOT EXISTS public.member_relations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  relative_id  uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('parent','grandparent','great_grandparent','spouse','sibling')),
  role         text CHECK (role IN (
                  'father','mother',
                  'grandfather','grandmother',
                  'paternal_grandfather','paternal_grandmother',
                  'maternal_grandfather','maternal_grandmother',
                  'great_grandfather','great_grandmother',
                  'husband','wife',
                  'brother','sister'
                )),
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz DEFAULT now(),
  UNIQUE (subject_id, relative_id, kind),
  CHECK (subject_id <> relative_id)
);

CREATE INDEX IF NOT EXISTS idx_mr_subject  ON public.member_relations(subject_id);
CREATE INDEX IF NOT EXISTS idx_mr_relative ON public.member_relations(relative_id);
CREATE INDEX IF NOT EXISTS idx_mr_kind     ON public.member_relations(kind);

ALTER TABLE public.member_relations ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자는 조회 가능
DROP POLICY IF EXISTS "member_relations_select_all" ON public.member_relations;
CREATE POLICY "member_relations_select_all"
  ON public.member_relations FOR SELECT TO authenticated USING (true);

-- 관리자는 전부 가능
DROP POLICY IF EXISTS "member_relations_write_admin" ON public.member_relations;
CREATE POLICY "member_relations_write_admin"
  ON public.member_relations FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin','office','pastor'))
  WITH CHECK (public.get_user_role() IN ('admin','office','pastor'));


-- =============================================================
-- RPC: 후보 검색 (이름 + 선택적 휴대폰)
-- 가입 UI에서 "부모 이름" 입력 → 후보 리스트 → "ㅇㅇㅇ(010-xxxx) 맞습니까?" 확인용
-- =============================================================
DROP FUNCTION IF EXISTS public.search_member_candidates(text, text, int);
CREATE OR REPLACE FUNCTION public.search_member_candidates(
  p_name  text,
  p_phone text DEFAULT NULL,
  p_limit int  DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  gender text,
  family_church text,
  sub_role text,
  address text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  is_child boolean,
  match_score int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id, m.name, m.phone, m.gender, m.family_church, m.sub_role,
    h.address,
    p.name  AS pasture_name,
    g.name  AS grassland_name,
    pl.name AS plain_name,
    m.is_child,
    CASE
      WHEN p_phone IS NOT NULL AND regexp_replace(coalesce(m.phone,''), '\D','','g')
           = regexp_replace(p_phone, '\D','','g') THEN 100
      WHEN p_phone IS NOT NULL AND right(regexp_replace(coalesce(m.phone,''), '\D','','g'), 4)
           = right(regexp_replace(p_phone, '\D','','g'), 4) THEN 80
      WHEN m.name = p_name THEN 50
      ELSE 10
    END AS match_score
  FROM public.members m
  LEFT JOIN public.households h          ON m.household_id = h.id
  LEFT JOIN public.directory_pastures p  ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g          ON p.grassland_id = g.id
  LEFT JOIN public.plains pl             ON g.plain_id = pl.id
  WHERE m.name = p_name
  ORDER BY match_score DESC, m.is_child ASC, m.name
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_member_candidates(text, text, int) TO anon, authenticated;


-- =============================================================
-- RPC: 관계 추천 (기존 관계 있으면 그 값, 없으면 성별/is_child 기반 추정)
-- 가입 UI에서 default 선택값으로 사용
-- =============================================================
CREATE OR REPLACE FUNCTION public.suggest_relation_role(
  p_subject_id  uuid,
  p_relative_id uuid
)
RETURNS TABLE (kind text, role text, source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_kind text;
  v_existing_role text;
  v_rel_gender    text;
  v_subj_ischild  boolean;
BEGIN
  -- 1) 이미 저장된 관계가 있으면 우선
  SELECT r.kind, r.role
    INTO v_existing_kind, v_existing_role
  FROM public.member_relations r
  WHERE r.subject_id = p_subject_id AND r.relative_id = p_relative_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_kind IS NOT NULL THEN
    kind := v_existing_kind;
    role := v_existing_role;
    source := 'existing';
    RETURN NEXT;
    RETURN;
  END IF;

  -- 2) 성별·연령 기반 추정 (기본값: 부모)
  SELECT gender INTO v_rel_gender   FROM public.members WHERE id = p_relative_id;
  SELECT is_child INTO v_subj_ischild FROM public.members WHERE id = p_subject_id;

  kind := 'parent';
  IF v_rel_gender = 'M' THEN role := 'father';
  ELSIF v_rel_gender = 'F' THEN role := 'mother';
  ELSE role := NULL;
  END IF;
  source := 'inferred';
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_relation_role(uuid, uuid) TO authenticated;


-- =============================================================
-- RPC: 관계 추가 (UPSERT)
-- 이미 (subject, relative, kind) 있으면 role만 업데이트
-- =============================================================
CREATE OR REPLACE FUNCTION public.add_member_relation(
  p_subject_id  uuid,
  p_relative_id uuid,
  p_kind        text,
  p_role        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_subject_id = p_relative_id THEN
    RAISE EXCEPTION '자기 자신과 관계를 맺을 수 없습니다';
  END IF;

  INSERT INTO public.member_relations (subject_id, relative_id, kind, role, created_by)
  VALUES (p_subject_id, p_relative_id, p_kind, p_role, auth.uid())
  ON CONFLICT (subject_id, relative_id, kind)
  DO UPDATE SET role = COALESCE(EXCLUDED.role, public.member_relations.role)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_member_relation(uuid, uuid, text, text) TO authenticated;


-- =============================================================
-- RPC: 특정 회원의 가족 관계 전체 조회 (3대)
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_family_tree(p_member_id uuid)
RETURNS TABLE (
  relative_id uuid,
  relative_name text,
  relative_phone text,
  kind text,
  role text,
  direction text  -- 'ancestor' | 'descendant' | 'spouse' | 'sibling'
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- 내가 subject인 경우: 상대는 조상/배우자
  SELECT
    m.id, m.name, m.phone, r.kind, r.role,
    CASE r.kind
      WHEN 'spouse' THEN 'spouse'
      WHEN 'sibling' THEN 'sibling'
      ELSE 'ancestor'
    END
  FROM public.member_relations r
  JOIN public.members m ON m.id = r.relative_id
  WHERE r.subject_id = p_member_id

  UNION ALL

  -- 내가 relative인 경우: 상대는 자손
  SELECT
    m.id, m.name, m.phone, r.kind, r.role,
    CASE r.kind
      WHEN 'spouse' THEN 'spouse'
      WHEN 'sibling' THEN 'sibling'
      ELSE 'descendant'
    END
  FROM public.member_relations r
  JOIN public.members m ON m.id = r.subject_id
  WHERE r.relative_id = p_member_id
    AND r.kind <> 'spouse'  -- 배우자는 중복 방지 (양방향 저장 안 하면 문제 없지만 안전)
;
$$;

GRANT EXECUTE ON FUNCTION public.get_family_tree(uuid) TO authenticated;
