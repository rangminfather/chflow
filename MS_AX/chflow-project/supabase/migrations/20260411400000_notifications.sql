-- =============================================================
-- 알림 시스템 (Notifications)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- 받을 사람
  type        text NOT NULL,                                      -- 알림 종류
  title       text NOT NULL,
  body        text,
  link_url    text,                                                -- 클릭 시 이동
  is_read     boolean DEFAULT false,
  created_by  uuid REFERENCES auth.users(id),                     -- 알림 발생시킨 사람
  metadata    jsonb DEFAULT '{}'::jsonb,                          -- 추가 데이터
  created_at  timestamptz DEFAULT now(),
  read_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user_created ON public.notifications(user_id, created_at DESC);

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif_select_own" ON public.notifications;
CREATE POLICY "notif_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notif_update_own" ON public.notifications;
CREATE POLICY "notif_update_own"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notif_insert_admin" ON public.notifications;
CREATE POLICY "notif_insert_admin"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'office', 'pastor'));


-- =============================================================
-- 알림 조회 RPC
-- =============================================================

DROP FUNCTION IF EXISTS public.get_my_notifications(int, boolean);
CREATE OR REPLACE FUNCTION public.get_my_notifications(
  p_limit int DEFAULT 30,
  p_only_unread boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  type text,
  title text,
  body text,
  link_url text,
  is_read boolean,
  created_at timestamptz,
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, type, title, body, link_url, is_read, created_at, metadata
  FROM public.notifications
  WHERE user_id = auth.uid()
    AND (NOT p_only_unread OR is_read = false)
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_notifications(int, boolean) TO authenticated;


-- =============================================================
-- 안 읽은 알림 개수
-- =============================================================
DROP FUNCTION IF EXISTS public.get_unread_count();
CREATE OR REPLACE FUNCTION public.get_unread_count()
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.notifications
  WHERE user_id = auth.uid() AND is_read = false;
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_count() TO authenticated;


-- =============================================================
-- 알림 읽음 처리
-- =============================================================
DROP FUNCTION IF EXISTS public.mark_notification_read(uuid);
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.notifications
  SET is_read = true, read_at = now()
  WHERE id = p_notification_id AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.mark_all_notifications_read();
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.notifications
  SET is_read = true, read_at = now()
  WHERE user_id = auth.uid() AND is_read = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;


-- =============================================================
-- 알림 발송 헬퍼 (관리자/시스템용)
-- =============================================================
DROP FUNCTION IF EXISTS public.send_notification(uuid, text, text, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.send_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text DEFAULT NULL,
  p_link_url text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notif_id uuid;
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, link_url, metadata, created_by)
  VALUES (p_user_id, p_type, p_title, p_body, p_link_url, p_metadata, auth.uid())
  RETURNING id INTO v_notif_id;
  RETURN v_notif_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_notification(uuid, text, text, text, text, jsonb) TO authenticated;


-- =============================================================
-- approve_user 수정: 승인 시 자동 알림 발송
-- =============================================================
DROP FUNCTION IF EXISTS public.approve_user(uuid, boolean);
CREATE OR REPLACE FUNCTION public.approve_user(p_user_id uuid, p_approved boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
BEGIN
  IF public.get_user_role() != 'admin' AND public.get_user_role() NOT IN ('office', 'pastor') THEN
    RAISE EXCEPTION '관리자만 승인할 수 있습니다';
  END IF;

  SELECT name INTO v_user_name FROM public.profiles WHERE id = p_user_id;

  UPDATE public.profiles
  SET status = CASE WHEN p_approved THEN 'active' ELSE 'rejected' END,
      approved_at = now(),
      approved_by = auth.uid()
  WHERE id = p_user_id;

  -- 자동 알림 발송
  INSERT INTO public.notifications (user_id, type, title, body, link_url, created_by, metadata)
  VALUES (
    p_user_id,
    CASE WHEN p_approved THEN 'signup_approved' ELSE 'signup_rejected' END,
    CASE WHEN p_approved THEN '🎉 회원가입 승인 완료'
         ELSE '❌ 회원가입 거절' END,
    CASE WHEN p_approved THEN '회원가입이 승인되었습니다. 이제 모든 서비스를 이용하실 수 있습니다.'
         ELSE '회원가입이 거절되었습니다. 자세한 사항은 관리자에게 문의하세요.' END,
    CASE WHEN p_approved THEN '/home' ELSE '/login' END,
    auth.uid(),
    jsonb_build_object('approved', p_approved)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_user(uuid, boolean) TO authenticated;
