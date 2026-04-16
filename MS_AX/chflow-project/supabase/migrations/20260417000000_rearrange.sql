-- =============================================================
-- 초원 재편성 페이지용 RPC
-- =============================================================

-- 1) 로드: 목장 리더(목자/목녀) + 사진 포함 전체 트리
DROP FUNCTION IF EXISTS public.rearrange_tree();
CREATE OR REPLACE FUNCTION public.rearrange_tree()
RETURNS TABLE (
  plain_id        uuid,
  plain_name      text,
  plain_order     int,
  grassland_id    uuid,
  grassland_name  text,
  pasture_id      uuid,
  pasture_name    text,
  leader_name     text,
  leader_photo    text,
  leader_gender   text,
  spouse_name     text,
  spouse_photo    text,
  member_count    int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH pasture_leaders AS (
    SELECT DISTINCT ON (p.id)
      p.id              AS pasture_id,
      lead.name         AS leader_name,
      lead.photo_url    AS leader_photo,
      lead.gender       AS leader_gender,
      lead.spouse_name  AS spouse_name
    FROM public.directory_pastures p
    LEFT JOIN LATERAL (
      SELECT m.name, m.photo_url, m.gender, m.spouse_name
      FROM public.members m
      JOIN public.households h ON m.household_id = h.id
      WHERE h.pasture_id = p.id
        AND NOT m.is_child
      ORDER BY
        CASE m.family_church
          WHEN '목자' THEN 0
          WHEN '목녀' THEN 1
          WHEN '목부' THEN 2
          ELSE 3
        END,
        CASE WHEN m.name = p.name THEN 0 ELSE 1 END,
        m.name
      LIMIT 1
    ) lead ON TRUE
  ),
  spouse_photos AS (
    SELECT pl.pasture_id, m.photo_url AS spouse_photo
    FROM pasture_leaders pl
    JOIN public.directory_pastures p ON p.id = pl.pasture_id
    JOIN public.households h ON h.pasture_id = p.id
    JOIN public.members m ON m.household_id = h.id AND m.name = pl.spouse_name AND NOT m.is_child
  ),
  pasture_counts AS (
    SELECT p.id AS pasture_id, COUNT(m.id)::int AS cnt
    FROM public.directory_pastures p
    LEFT JOIN public.households h ON h.pasture_id = p.id
    LEFT JOIN public.members m    ON m.household_id = h.id
    GROUP BY p.id
  )
  SELECT
    pl.id, pl.name, pl.order_no,
    g.id,  g.name,
    p.id,  p.name,
    ld.leader_name, ld.leader_photo, ld.leader_gender,
    ld.spouse_name, sp.spouse_photo,
    coalesce(pc.cnt, 0)
  FROM public.plains pl
  JOIN public.grasslands g         ON g.plain_id = pl.id
  JOIN public.directory_pastures p ON p.grassland_id = g.id
  LEFT JOIN pasture_leaders ld ON ld.pasture_id = p.id
  LEFT JOIN spouse_photos   sp ON sp.pasture_id = p.id
  LEFT JOIN pasture_counts  pc ON pc.pasture_id = p.id
  ORDER BY pl.order_no, g.order_no, p.order_no;
$$;
GRANT EXECUTE ON FUNCTION public.rearrange_tree() TO authenticated;


-- 2) 저장: 평원·초원·목장 배치 벌크 업데이트
-- Input JSON 형태:
-- {
--   "grasslands": [{"id": "...", "plain_id": "...", "order_no": 0}],
--   "pastures":   [{"id": "...", "grassland_id": "...", "order_no": 0}]
-- }
DROP FUNCTION IF EXISTS public.rearrange_save(jsonb);
CREATE OR REPLACE FUNCTION public.rearrange_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g_cnt int := 0;
  p_cnt int := 0;
  g_rec jsonb;
  p_rec jsonb;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  -- grasslands 먼저 (pastures FK 고려)
  IF p_payload ? 'grasslands' THEN
    FOR g_rec IN SELECT * FROM jsonb_array_elements(p_payload->'grasslands')
    LOOP
      UPDATE public.grasslands
        SET plain_id = (g_rec->>'plain_id')::uuid,
            order_no = coalesce((g_rec->>'order_no')::int, order_no)
        WHERE id = (g_rec->>'id')::uuid;
      g_cnt := g_cnt + 1;
    END LOOP;
  END IF;

  IF p_payload ? 'pastures' THEN
    FOR p_rec IN SELECT * FROM jsonb_array_elements(p_payload->'pastures')
    LOOP
      UPDATE public.directory_pastures
        SET grassland_id = (p_rec->>'grassland_id')::uuid,
            order_no     = coalesce((p_rec->>'order_no')::int, order_no)
        WHERE id = (p_rec->>'id')::uuid;
      p_cnt := p_cnt + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('grasslands_updated', g_cnt, 'pastures_updated', p_cnt);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rearrange_save(jsonb) TO authenticated;


-- 3) 신규 초원 생성 (재편성 중 새 초원이 필요할 때)
DROP FUNCTION IF EXISTS public.create_grassland(uuid, text);
CREATE OR REPLACE FUNCTION public.create_grassland(p_plain_id uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  INSERT INTO public.grasslands (plain_id, name, order_no)
  VALUES (p_plain_id, trim(p_name), 0)
  ON CONFLICT (plain_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_grassland(uuid, text) TO authenticated;
