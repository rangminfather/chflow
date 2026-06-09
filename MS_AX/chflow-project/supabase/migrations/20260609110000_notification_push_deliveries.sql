-- =============================================================
-- Push delivery queue for notification rows
-- =============================================================

CREATE TABLE IF NOT EXISTS public.notification_push_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id  uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  push_token_id    uuid REFERENCES public.user_push_tokens(id) ON DELETE SET NULL,
  expo_push_token  text NOT NULL,
  status           text NOT NULL DEFAULT 'queued',
  attempts         int NOT NULL DEFAULT 0,
  expo_ticket_id   text,
  error_message    text,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_push_deliveries_status_check
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_push_delivery_notification_token
  ON public.notification_push_deliveries(notification_id, expo_push_token);

CREATE INDEX IF NOT EXISTS idx_push_delivery_status_created
  ON public.notification_push_deliveries(status, created_at);

CREATE INDEX IF NOT EXISTS idx_push_delivery_user_created
  ON public.notification_push_deliveries(user_id, created_at DESC);

ALTER TABLE public.notification_push_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_deliveries_select_own ON public.notification_push_deliveries;
CREATE POLICY push_deliveries_select_own
  ON public.notification_push_deliveries FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP FUNCTION IF EXISTS public.enqueue_notification_push_deliveries();
CREATE OR REPLACE FUNCTION public.enqueue_notification_push_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_push_deliveries (
    notification_id,
    user_id,
    push_token_id,
    expo_push_token
  )
  SELECT
    NEW.id,
    NEW.user_id,
    t.id,
    t.expo_push_token
  FROM public.user_push_tokens t
  WHERE t.user_id = NEW.user_id
    AND t.enabled = true
  ON CONFLICT (notification_id, expo_push_token) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_notification_push_deliveries ON public.notifications;
CREATE TRIGGER trg_enqueue_notification_push_deliveries
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_notification_push_deliveries();
