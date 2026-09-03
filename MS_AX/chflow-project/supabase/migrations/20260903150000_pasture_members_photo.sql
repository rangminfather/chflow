-- 목장 홈의 구성원 얼굴 모음에 기존 프로필/요람 사진을 표시한다.
-- 본인이 올린 앱 프로필 사진을 우선하고, 없으면 요람 사진을 사용한다.

DROP FUNCTION IF EXISTS public.pasture_list_members(uuid);

CREATE OR REPLACE FUNCTION public.pasture_list_members(p_pasture_id uuid DEFAULT null)
RETURNS TABLE (
  member_id       uuid,
  name            text,
  family_church   text,
  sub_role        text,
  is_child        boolean,
  gender          text,
  birth_date      date,
  household_id    uuid,
  household_no    int,
  relationship    text,
  has_app         boolean,
  is_me           boolean,
  dup_in_household boolean,
  photo_url       text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH target AS (SELECT coalesce(p_pasture_id, public.pasture_my_id()) AS pid),
  roster AS (
    SELECT
      m.id, m.name, m.family_church, m.sub_role,
      coalesce(m.is_child, false) AS is_child,
      m.gender, m.birth_date,
      m.household_id, h.order_no AS household_no,
      m.relationship_in_household,
      m.app_user_id, m.child_order,
      coalesce(pr.avatar_url, m.photo_url) AS photo_url,
      count(*) OVER (PARTITION BY m.household_id, m.name) > 1 AS dup_in_household
    FROM target t
    JOIN public.households h ON h.pasture_id = t.pid
    JOIN public.members m ON m.household_id = h.id
    LEFT JOIN public.profiles pr ON pr.id = m.app_user_id
    WHERE public.pasture_can_view(t.pid)
      AND coalesce(m.account_state, 'active') <> 'withdrawn'
  )
  SELECT
    r.id, r.name, r.family_church, r.sub_role, r.is_child,
    r.gender, r.birth_date,
    r.household_id, r.household_no, r.relationship_in_household,
    r.app_user_id IS NOT NULL,
    r.app_user_id = auth.uid(),
    r.dup_in_household,
    r.photo_url
  FROM roster r
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1 FROM roster x
      WHERE x.household_id = r.household_id
        AND x.family_church IN ('목자','목녀')
    ) THEN 0 ELSE 1 END,
    r.household_no NULLS LAST,
    r.household_id,
    r.is_child,
    r.child_order NULLS FIRST,
    r.name;
$$;

REVOKE ALL ON FUNCTION public.pasture_list_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pasture_list_members(uuid) TO authenticated;
