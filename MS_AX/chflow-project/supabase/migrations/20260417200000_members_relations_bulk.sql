-- 회원 목록용 bulk 관계 조회 RPC
-- 입력: member id 배열
-- 반환: 각 member에 대한 부모(조부모 포함) 목록과 자녀(손주 포함) 목록을 문자열로 요약
DROP FUNCTION IF EXISTS public.admin_members_relations(uuid[]);
CREATE OR REPLACE FUNCTION public.admin_members_relations(p_ids uuid[])
RETURNS TABLE (
  member_id uuid,
  parents_text  text,
  children_text text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.admin_members_relations(uuid[]) TO authenticated;
