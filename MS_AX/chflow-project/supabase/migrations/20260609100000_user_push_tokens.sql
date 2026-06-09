-- =============================================================
-- Mobile push token registry
-- =============================================================

CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  platform        text NOT NULL DEFAULT 'android',
  device_id       text,
  app_id          text NOT NULL DEFAULT 'smart-myungsung',
  enabled         boolean NOT NULL DEFAULT true,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_push_tokens_platform_check CHECK (platform IN ('android', 'ios', 'web')),
  CONSTRAINT user_push_tokens_token_not_blank CHECK (length(trim(expo_push_token)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_push_tokens_user_token
  ON public.user_push_tokens(user_id, expo_push_token);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_enabled
  ON public.user_push_tokens(user_id, enabled, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_token_enabled
  ON public.user_push_tokens(expo_push_token, enabled);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_push_tokens_select_own ON public.user_push_tokens;
CREATE POLICY user_push_tokens_select_own
  ON public.user_push_tokens FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_push_tokens_insert_own ON public.user_push_tokens;
CREATE POLICY user_push_tokens_insert_own
  ON public.user_push_tokens FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_push_tokens_update_own ON public.user_push_tokens;
CREATE POLICY user_push_tokens_update_own
  ON public.user_push_tokens FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_push_tokens_delete_own ON public.user_push_tokens;
CREATE POLICY user_push_tokens_delete_own
  ON public.user_push_tokens FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
