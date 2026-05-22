-- =============================================================
-- 불편신고/건의 게시판
-- =============================================================

-- 상태 enum
DO $$ BEGIN
  CREATE TYPE public.feedback_status AS ENUM ('submitted','received','reviewing','resolved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 게시글
CREATE TABLE IF NOT EXISTS public.feedback_posts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title              text NOT NULL,
  body               text NOT NULL,
  status             public.feedback_status NOT NULL DEFAULT 'submitted',
  is_private         boolean NOT NULL DEFAULT false,
  status_updated_at  timestamptz,
  status_updated_by  uuid REFERENCES auth.users(id),
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_posts_created ON public.feedback_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_posts_author  ON public.feedback_posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_posts_status  ON public.feedback_posts (status, created_at DESC);

-- 댓글
CREATE TABLE IF NOT EXISTS public.feedback_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         uuid REFERENCES public.feedback_posts(id) ON DELETE CASCADE NOT NULL,
  author_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  body            text NOT NULL,
  is_admin_reply  boolean NOT NULL DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_comments_post ON public.feedback_comments (post_id, created_at);

-- 첨부 (post 또는 comment 중 하나에 연결)
CREATE TABLE IF NOT EXISTS public.feedback_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      uuid REFERENCES public.feedback_posts(id) ON DELETE CASCADE,
  comment_id   uuid REFERENCES public.feedback_comments(id) ON DELETE CASCADE,
  file_path    text NOT NULL,
  file_name    text NOT NULL,
  mime_type    text,
  size_bytes   int,
  position     int NOT NULL DEFAULT 0,
  uploaded_by  uuid REFERENCES auth.users(id),
  created_at   timestamptz DEFAULT now(),
  CONSTRAINT feedback_attach_target CHECK (
    (post_id IS NOT NULL AND comment_id IS NULL) OR
    (post_id IS NULL AND comment_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_feedback_attach_post    ON public.feedback_attachments (post_id, position);
CREATE INDEX IF NOT EXISTS idx_feedback_attach_comment ON public.feedback_attachments (comment_id, position);

-- =============================================================
-- RLS (직접 쿼리 차단용 — 실제 접근은 SECURITY DEFINER RPC로)
-- =============================================================
ALTER TABLE public.feedback_posts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_comments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_attachments ENABLE ROW LEVEL SECURITY;

-- 직접 쿼리 차단: 작성자/관리자 본인만 자기 row 조회 가능. 일반적으로는 RPC 사용.
DROP POLICY IF EXISTS feedback_posts_select_own ON public.feedback_posts;
CREATE POLICY feedback_posts_select_own ON public.feedback_posts FOR SELECT TO authenticated
  USING (author_id = auth.uid() OR public.get_user_role() IN ('admin','office','pastor'));

DROP POLICY IF EXISTS feedback_comments_select_own ON public.feedback_comments;
CREATE POLICY feedback_comments_select_own ON public.feedback_comments FOR SELECT TO authenticated
  USING (
    author_id = auth.uid()
    OR public.get_user_role() IN ('admin','office','pastor')
    OR EXISTS (SELECT 1 FROM public.feedback_posts p WHERE p.id = post_id AND p.author_id = auth.uid())
  );

DROP POLICY IF EXISTS feedback_attach_select_own ON public.feedback_attachments;
CREATE POLICY feedback_attach_select_own ON public.feedback_attachments FOR SELECT TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR public.get_user_role() IN ('admin','office','pastor')
  );

-- =============================================================
-- RPC: 글 작성
-- =============================================================
DROP FUNCTION IF EXISTS public.create_feedback_post(text, text, boolean, jsonb);
CREATE OR REPLACE FUNCTION public.create_feedback_post(
  p_title text,
  p_body text,
  p_is_private boolean DEFAULT false,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_id uuid;
  v_author_name text;
  v_idx int := 0;
  v_att jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF coalesce(trim(p_title), '') = '' THEN RAISE EXCEPTION '제목을 입력하세요'; END IF;
  IF coalesce(trim(p_body), '') = '' THEN RAISE EXCEPTION '내용을 입력하세요'; END IF;

  INSERT INTO public.feedback_posts (author_id, title, body, is_private)
  VALUES (auth.uid(), p_title, p_body, coalesce(p_is_private, false))
  RETURNING id INTO v_post_id;

  -- 첨부 등록
  IF jsonb_typeof(p_attachments) = 'array' THEN
    FOR v_att IN SELECT * FROM jsonb_array_elements(p_attachments)
    LOOP
      INSERT INTO public.feedback_attachments
        (post_id, file_path, file_name, mime_type, size_bytes, position, uploaded_by)
      VALUES (
        v_post_id,
        v_att->>'file_path',
        coalesce(v_att->>'file_name', 'image'),
        v_att->>'mime_type',
        NULLIF(v_att->>'size_bytes','')::int,
        v_idx,
        auth.uid()
      );
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- 작성자 이름
  SELECT name INTO v_author_name FROM public.profiles WHERE id = auth.uid();

  -- 모든 관리자에게 알림
  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by, metadata)
  SELECT
    pr.id,
    'feedback_new',
    '📮 새 불편신고/건의',
    coalesce(v_author_name, '익명') || ': ' || left(p_title, 40),
    '/feedback/' || v_post_id,
    auth.uid(),
    jsonb_build_object('post_id', v_post_id)
  FROM public.profiles pr
  WHERE pr.role IN ('admin','office','pastor')
    AND pr.id <> auth.uid();

  RETURN v_post_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_feedback_post(text, text, boolean, jsonb) TO authenticated;

-- =============================================================
-- RPC: 댓글 작성
-- =============================================================
DROP FUNCTION IF EXISTS public.add_feedback_comment(uuid, text, jsonb);
CREATE OR REPLACE FUNCTION public.add_feedback_comment(
  p_post_id uuid,
  p_body text,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comment_id uuid;
  v_post public.feedback_posts;
  v_role text;
  v_is_admin boolean;
  v_author_name text;
  v_idx int := 0;
  v_att jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF coalesce(trim(p_body), '') = '' THEN RAISE EXCEPTION '내용을 입력하세요'; END IF;

  SELECT * INTO v_post FROM public.feedback_posts WHERE id = p_post_id;
  IF NOT FOUND THEN RAISE EXCEPTION '게시글을 찾을 수 없습니다'; END IF;

  v_role := public.get_user_role();
  v_is_admin := v_role IN ('admin','office','pastor');

  -- 권한: 글 작성자 또는 관리자
  IF auth.uid() <> v_post.author_id AND NOT v_is_admin THEN
    RAISE EXCEPTION '댓글 작성 권한이 없습니다';
  END IF;

  INSERT INTO public.feedback_comments (post_id, author_id, body, is_admin_reply)
  VALUES (p_post_id, auth.uid(), p_body, v_is_admin)
  RETURNING id INTO v_comment_id;

  -- 첨부 등록
  IF jsonb_typeof(p_attachments) = 'array' THEN
    FOR v_att IN SELECT * FROM jsonb_array_elements(p_attachments)
    LOOP
      INSERT INTO public.feedback_attachments
        (comment_id, file_path, file_name, mime_type, size_bytes, position, uploaded_by)
      VALUES (
        v_comment_id,
        v_att->>'file_path',
        coalesce(v_att->>'file_name', 'image'),
        v_att->>'mime_type',
        NULLIF(v_att->>'size_bytes','')::int,
        v_idx,
        auth.uid()
      );
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  SELECT name INTO v_author_name FROM public.profiles WHERE id = auth.uid();

  -- 알림
  IF v_is_admin THEN
    -- 관리자 답글 → 작성자에게
    IF v_post.author_id <> auth.uid() THEN
      INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by, metadata)
      VALUES (
        v_post.author_id,
        'feedback_reply',
        '💬 관리자 답변',
        coalesce(v_author_name, '관리자') || ': ' || left(p_body, 60),
        '/feedback/' || p_post_id,
        auth.uid(),
        jsonb_build_object('post_id', p_post_id, 'comment_id', v_comment_id)
      );
    END IF;
  ELSE
    -- 작성자 코멘트 → 모든 관리자에게
    INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by, metadata)
    SELECT
      pr.id,
      'feedback_reply',
      '💬 불편신고 추가 메시지',
      coalesce(v_author_name, '사용자') || ': ' || left(p_body, 60),
      '/feedback/' || p_post_id,
      auth.uid(),
      jsonb_build_object('post_id', p_post_id, 'comment_id', v_comment_id)
    FROM public.profiles pr
    WHERE pr.role IN ('admin','office','pastor')
      AND pr.id <> auth.uid();
  END IF;

  -- 게시글 updated_at 갱신
  UPDATE public.feedback_posts SET updated_at = now() WHERE id = p_post_id;

  RETURN v_comment_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.add_feedback_comment(uuid, text, jsonb) TO authenticated;

-- =============================================================
-- RPC: 상태 변경 (관리자)
-- =============================================================
DROP FUNCTION IF EXISTS public.update_feedback_status(uuid, text);
CREATE OR REPLACE FUNCTION public.update_feedback_status(
  p_post_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post public.feedback_posts;
  v_new_status public.feedback_status;
  v_status_label text;
BEGIN
  IF public.get_user_role() NOT IN ('admin','office','pastor') THEN
    RAISE EXCEPTION '관리자만 상태를 변경할 수 있습니다';
  END IF;

  v_new_status := p_status::public.feedback_status;

  SELECT * INTO v_post FROM public.feedback_posts WHERE id = p_post_id;
  IF NOT FOUND THEN RAISE EXCEPTION '게시글을 찾을 수 없습니다'; END IF;

  IF v_post.status = v_new_status THEN RETURN; END IF;

  UPDATE public.feedback_posts
  SET status = v_new_status,
      status_updated_at = now(),
      status_updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_post_id;

  v_status_label := CASE v_new_status
    WHEN 'submitted'  THEN '미접수'
    WHEN 'received'   THEN '접수'
    WHEN 'reviewing'  THEN '검토중'
    WHEN 'resolved'   THEN '처리완료'
    WHEN 'rejected'   THEN '처리불가'
    ELSE v_new_status::text
  END;

  -- 작성자에게 알림
  IF v_post.author_id <> auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by, metadata)
    VALUES (
      v_post.author_id,
      'feedback_status',
      '🔄 처리 상태 변경: ' || v_status_label,
      left(v_post.title, 60),
      '/feedback/' || p_post_id,
      auth.uid(),
      jsonb_build_object('post_id', p_post_id, 'status', v_new_status::text)
    );
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_feedback_status(uuid, text) TO authenticated;

-- =============================================================
-- RPC: 목록 (비공개 글은 is_locked 플래그 + 본문 미반환)
-- =============================================================
DROP FUNCTION IF EXISTS public.list_feedback_posts(int, int, text, text);
CREATE OR REPLACE FUNCTION public.list_feedback_posts(
  p_limit int DEFAULT 30,
  p_offset int DEFAULT 0,
  p_status text DEFAULT NULL,           -- NULL=전체
  p_scope text DEFAULT 'all'            -- 'all' | 'mine'
)
RETURNS TABLE (
  id uuid,
  title text,
  status public.feedback_status,
  is_private boolean,
  is_locked boolean,
  is_mine boolean,
  author_name text,
  author_sub_role text,
  comment_count int,
  attachment_count int,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH role_check AS (SELECT public.get_user_role() AS r),
  base AS (
    SELECT
      p.*,
      pr.name AS author_name,
      pr.sub_role AS author_sub_role,
      (SELECT COUNT(*)::int FROM public.feedback_comments c WHERE c.post_id = p.id) AS comment_count,
      (SELECT COUNT(*)::int FROM public.feedback_attachments a WHERE a.post_id = p.id) AS attachment_count
    FROM public.feedback_posts p
    LEFT JOIN public.profiles pr ON pr.id = p.author_id
  )
  SELECT
    b.id,
    b.title,
    b.status,
    b.is_private,
    (b.is_private AND b.author_id <> auth.uid() AND (SELECT r FROM role_check) NOT IN ('admin','office','pastor')) AS is_locked,
    (b.author_id = auth.uid()) AS is_mine,
    b.author_name,
    b.author_sub_role,
    b.comment_count,
    b.attachment_count,
    b.created_at,
    b.updated_at
  FROM base b
  WHERE (p_status IS NULL OR b.status::text = p_status)
    AND (p_scope <> 'mine' OR b.author_id = auth.uid())
  ORDER BY b.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;
GRANT EXECUTE ON FUNCTION public.list_feedback_posts(int, int, text, text) TO authenticated;

-- =============================================================
-- RPC: 상세 (post + comments + attachments)
-- =============================================================
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

-- =============================================================
-- Storage 버킷 (public) + 첨부 정책
-- =============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-attachments', 'feedback-attachments', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 인증된 사용자가 자기 폴더(user_id/...)에만 업로드
DROP POLICY IF EXISTS feedback_attach_upload ON storage.objects;
CREATE POLICY feedback_attach_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'feedback-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS feedback_attach_read ON storage.objects;
CREATE POLICY feedback_attach_read ON storage.objects
  FOR SELECT TO authenticated, anon
  USING (bucket_id = 'feedback-attachments');

DROP POLICY IF EXISTS feedback_attach_delete ON storage.objects;
CREATE POLICY feedback_attach_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'feedback-attachments'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.get_user_role() IN ('admin','office','pastor')
    )
  );
