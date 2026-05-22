-- =============================================================
-- 불편신고 게시판: 연번 컬럼 + 페이지네이션 (total 포함 반환)
-- =============================================================

-- 1) 연번 컬럼 추가 (기존 row 자동 채워짐 - bigserial)
ALTER TABLE public.feedback_posts
  ADD COLUMN IF NOT EXISTS seq bigserial;

CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_posts_seq
  ON public.feedback_posts (seq);

-- 2) list_feedback_posts 재정의 (total + rows jsonb 반환)
DROP FUNCTION IF EXISTS public.list_feedback_posts(int, int, text, text);
CREATE OR REPLACE FUNCTION public.list_feedback_posts(
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0,
  p_status text DEFAULT NULL,
  p_scope text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_is_admin boolean;
  v_total int;
  v_rows jsonb;
BEGIN
  v_role := public.get_user_role();
  v_is_admin := v_role IN ('admin','office','pastor');

  SELECT COUNT(*)::int INTO v_total
  FROM public.feedback_posts p
  WHERE (p_status IS NULL OR p.status::text = p_status)
    AND (p_scope <> 'mine' OR p.author_id = auth.uid());

  WITH page AS (
    SELECT
      p.id, p.seq, p.title, p.status, p.is_private,
      p.author_id, p.created_at, p.updated_at,
      pr.name AS author_name,
      pr.sub_role AS author_sub_role
    FROM public.feedback_posts p
    LEFT JOIN public.profiles pr ON pr.id = p.author_id
    WHERE (p_status IS NULL OR p.status::text = p_status)
      AND (p_scope <> 'mine' OR p.author_id = auth.uid())
    ORDER BY p.created_at DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', page.id,
        'seq', page.seq,
        'title', page.title,
        'status', page.status,
        'is_private', page.is_private,
        'is_locked', (page.is_private AND page.author_id <> auth.uid() AND NOT v_is_admin),
        'is_mine', page.author_id = auth.uid(),
        'author_name', page.author_name,
        'author_sub_role', page.author_sub_role,
        'comment_count', (SELECT COUNT(*)::int FROM public.feedback_comments c WHERE c.post_id = page.id),
        'attachment_count', (SELECT COUNT(*)::int FROM public.feedback_attachments a WHERE a.post_id = page.id),
        'created_at', page.created_at,
        'updated_at', page.updated_at
      )
      ORDER BY page.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_rows
  FROM page;

  RETURN jsonb_build_object(
    'total', v_total,
    'rows', v_rows
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_feedback_posts(int, int, text, text) TO authenticated;

-- 3) get_feedback_post 에 seq 포함
DROP FUNCTION IF EXISTS public.get_feedback_post(uuid);
CREATE OR REPLACE FUNCTION public.get_feedback_post(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post public.feedback_posts;
  v_role text;
  v_is_admin boolean;
  v_can_read boolean;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;

  SELECT * INTO v_post FROM public.feedback_posts WHERE id = p_post_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_role := public.get_user_role();
  v_is_admin := v_role IN ('admin','office','pastor');
  v_can_read := (v_post.author_id = auth.uid()) OR v_is_admin OR (NOT v_post.is_private);

  IF NOT v_can_read THEN RAISE EXCEPTION '비공개 글입니다'; END IF;

  SELECT jsonb_build_object(
    'id', v_post.id,
    'seq', v_post.seq,
    'title', v_post.title,
    'body', v_post.body,
    'status', v_post.status,
    'is_private', v_post.is_private,
    'is_mine', v_post.author_id = auth.uid(),
    'is_admin', v_is_admin,
    'created_at', v_post.created_at,
    'updated_at', v_post.updated_at,
    'author', (
      SELECT jsonb_build_object('id', pr.id, 'name', pr.name, 'sub_role', pr.sub_role)
      FROM public.profiles pr WHERE pr.id = v_post.author_id
    ),
    'attachments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'file_path', a.file_path, 'file_name', a.file_name,
        'mime_type', a.mime_type, 'size_bytes', a.size_bytes
      ) ORDER BY a.position)
      FROM public.feedback_attachments a WHERE a.post_id = v_post.id
    ), '[]'::jsonb),
    'comments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'body', c.body,
        'is_admin_reply', c.is_admin_reply,
        'is_mine', c.author_id = auth.uid(),
        'created_at', c.created_at,
        'author', jsonb_build_object('id', pr.id, 'name', pr.name, 'sub_role', pr.sub_role),
        'attachments', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', a.id, 'file_path', a.file_path, 'file_name', a.file_name,
            'mime_type', a.mime_type, 'size_bytes', a.size_bytes
          ) ORDER BY a.position)
          FROM public.feedback_attachments a WHERE a.comment_id = c.id
        ), '[]'::jsonb)
      ) ORDER BY c.created_at)
      FROM public.feedback_comments c
      LEFT JOIN public.profiles pr ON pr.id = c.author_id
      WHERE c.post_id = v_post.id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_feedback_post(uuid) TO authenticated;
