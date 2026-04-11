-- =============================================================
-- Realtime 확실하게 설정
-- =============================================================

-- REPLICA IDENTITY FULL (Realtime이 INSERT/UPDATE 이벤트를 안정적으로 전송)
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- Publication에 다시 추가 (이미 있으면 무시)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
