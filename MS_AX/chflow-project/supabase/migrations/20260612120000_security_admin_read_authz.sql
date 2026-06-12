-- =============================================================
-- 보안 H-2: 관리자용 read RPC 역할 검증 추가
-- 2026-06-12 / 보안성 검토 2차 조치
--
-- 문제: 아래 SECURITY DEFINER read 함수들이 호출자 역할을 검증하지 않아
--       일반 authenticated 계정이 직접 호출하면 대기 가입자 PII·가구 주소·
--       투표 집계 등을 열람 가능했음 (쓰기 admin 함수는 검증이 있었으나
--       read 함수만 비대칭 누락).
--
-- 조치: 공통 가드 assert_staff() 를 추가하고 각 함수를 plpgsql 로 재정의해
--       본문은 그대로 유지하면서 진입부에서 staff(active + admin/office/pastor)
--       여부를 검증. #variable_conflict use_column 으로 OUT 파라미터와 컬럼
--       이름 충돌을 방지.
--
-- 재적용 안전(OR REPLACE). 반환 시그니처·본문은 기존과 동일.
-- =============================================================

-- 공통 가드: active 상태의 staff 가 아니면 예외
CREATE OR REPLACE FUNCTION public.assert_staff()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'active'
      AND role IN ('admin', 'office', 'pastor')
  ) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.assert_staff() TO authenticated;


-- 1) admin_list_pending_signups ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_pending_signups()
RETURNS TABLE (
  id uuid,
  username text,
  name text,
  phone text,
  role text,
  sub_role text,
  status text,
  created_at timestamptz,
  matched_member_id uuid,
  matched_member_name text,
  matched_pasture text,
  matched_plain text,
  signup_birth_date date,
  signup_gender text,
  signup_address text,
  signup_pasture text,
  signup_plain text,
  signup_is_child boolean,
  signup_guardian_name text,
  signup_guardian_phone text,
  signup_parent_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.assert_staff();
  RETURN QUERY
  SELECT
    p.id,
    p.username,
    p.name,
    p.phone,
    p.role,
    p.sub_role,
    p.status,
    p.created_at,
    m.id AS matched_member_id,
    m.name AS matched_member_name,
    COALESCE(req_pa.name, pa.name) AS matched_pasture,
    COALESCE(COALESCE(req_pl.display_name, req_pl.name), COALESCE(pl.display_name, pl.name)) AS matched_plain,
    p.signup_birth_date,
    p.signup_gender,
    p.signup_address,
    req_pa.name AS signup_pasture,
    COALESCE(req_pl.display_name, req_pl.name) AS signup_plain,
    COALESCE(p.signup_is_child, false),
    p.signup_guardian_name,
    p.signup_guardian_phone,
    parent.name AS signup_parent_name
  FROM public.profiles p
  LEFT JOIN public.members m ON m.app_user_id = p.id
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures pa ON h.pasture_id = pa.id
  LEFT JOIN public.grasslands g ON pa.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  LEFT JOIN public.directory_pastures req_pa ON p.signup_pasture_id = req_pa.id
  LEFT JOIN public.grasslands req_g ON req_pa.grassland_id = req_g.id
  LEFT JOIN public.plains req_pl ON req_g.plain_id = req_pl.id
  LEFT JOIN public.members parent ON p.signup_parent_member_id = parent.id
  WHERE p.status = 'pending'
  ORDER BY p.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_signups() TO authenticated;


-- 2) admin_list_dept_members ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_dept_members(p_dept_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_name text,
  user_phone text,
  user_sub_role text,
  user_avatar_url text,
  member_role text,
  status text,
  joined_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.assert_staff();
  RETURN QUERY
  SELECT
    dm.id,
    dm.user_id,
    p.name,
    p.phone,
    p.sub_role,
    p.avatar_url,
    dm.member_role,
    dm.status,
    dm.approved_at
  FROM public.department_members dm
  JOIN public.profiles p ON dm.user_id = p.id
  WHERE dm.department_id = p_dept_id
    AND dm.status = 'approved'
  ORDER BY
    CASE dm.member_role
      WHEN '부장' THEN 1
      WHEN '부부장' THEN 2
      WHEN '총무' THEN 3
      WHEN '서기' THEN 4
      WHEN '부총무' THEN 5
      WHEN '부서기' THEN 6
      WHEN '교사' THEN 7
      ELSE 99
    END,
    p.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_dept_members(uuid) TO authenticated;


-- 3) admin_members_relations ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_members_relations(p_ids uuid[])
RETURNS TABLE (
  member_id uuid,
  parents_text  text,
  children_text text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.assert_staff();
  RETURN QUERY
  WITH parents AS (
    SELECT
      r.subject_id AS mid,
      string_agg(
        CASE r.role
          WHEN 'father' THEN '부 '
          WHEN 'mother' THEN '모 '
          WHEN 'grandfather' THEN '조부 '
          WHEN 'grandmother' THEN '조모 '
          WHEN 'paternal_grandfather' THEN '친조부 '
          WHEN 'paternal_grandmother' THEN '친조모 '
          WHEN 'maternal_grandfather' THEN '외조부 '
          WHEN 'maternal_grandmother' THEN '외조모 '
          WHEN 'great_grandfather' THEN '증조부 '
          WHEN 'great_grandmother' THEN '증조모 '
          ELSE ''
        END || m.name,
        ', '
        ORDER BY
          CASE r.kind
            WHEN 'parent' THEN 0
            WHEN 'grandparent' THEN 1
            WHEN 'great_grandparent' THEN 2
            ELSE 3
          END,
          r.role NULLS LAST
      ) AS txt
    FROM public.member_relations r
    JOIN public.members m ON m.id = r.relative_id
    WHERE r.subject_id = ANY(p_ids)
      AND r.kind IN ('parent','grandparent','great_grandparent')
    GROUP BY r.subject_id
  ),
  kids AS (
    SELECT
      r.relative_id AS mid,
      string_agg(m.name, ', ' ORDER BY m.name) AS txt
    FROM public.member_relations r
    JOIN public.members m ON m.id = r.subject_id
    WHERE r.relative_id = ANY(p_ids)
      AND r.kind IN ('parent','grandparent','great_grandparent')
    GROUP BY r.relative_id
  )
  SELECT
    id::uuid AS member_id,
    p.txt AS parents_text,
    k.txt AS children_text
  FROM unnest(p_ids) AS id
  LEFT JOIN parents p ON p.mid = id
  LEFT JOIN kids k    ON k.mid = id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_members_relations(uuid[]) TO authenticated;


-- 4) households_by_pasture ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.households_by_pasture(p_pasture_id uuid)
RETURNS TABLE (
  id uuid, address text, home_phone text, order_no int,
  members_summary text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.assert_staff();
  RETURN QUERY
  SELECT
    h.id, h.address, h.home_phone, h.order_no,
    (SELECT string_agg(m.name, ', ' ORDER BY m.is_child, m.name)
       FROM public.members m WHERE m.household_id = h.id) AS members_summary
  FROM public.households h
  WHERE h.pasture_id = p_pasture_id
  ORDER BY h.order_no, h.address;
END;
$$;
GRANT EXECUTE ON FUNCTION public.households_by_pasture(uuid) TO authenticated;


-- 5) admin_list_dept_pending ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_dept_pending()
RETURNS TABLE (
  id uuid,
  department_id uuid,
  user_id uuid,
  user_name text,
  user_phone text,
  user_role text,
  user_sub_role text,
  category text,
  dept_name text,
  dept_icon text,
  requested_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.assert_staff();
  RETURN QUERY
  SELECT
    dm.id,
    dm.department_id,
    dm.user_id,
    p.name,
    p.phone,
    p.role,
    p.sub_role,
    d.category,
    d.name,
    d.icon,
    dm.requested_at
  FROM public.department_members dm
  JOIN public.departments d ON dm.department_id = d.id
  JOIN public.profiles p ON dm.user_id = p.id
  WHERE dm.status = 'pending'
  ORDER BY dm.requested_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_dept_pending() TO authenticated;


-- 6) admin_get_votes ────────────────────────────────────────
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.assert_staff();
  RETURN QUERY
  SELECT
    v.id, v.title, v.description, v.start_at, v.end_at, v.is_active, v.created_at,
    (SELECT COUNT(*) FROM vote_candidates vc WHERE vc.vote_id = v.id) AS candidate_count,
    (SELECT COUNT(*) FROM vote_ballots   vb WHERE vb.vote_id = v.id) AS ballot_count
  FROM votes v
  ORDER BY v.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_votes() TO authenticated;


-- 7) admin_get_vote_results ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_vote_results(p_vote_id uuid)
RETURNS TABLE (
  candidate_id    uuid,
  candidate_name  text,
  display_order   int,
  vote_count      bigint,
  total_ballots   bigint,
  vote_rate_pct   numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.assert_staff();
  RETURN QUERY
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
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_vote_results(uuid) TO authenticated;
