-- Track Expo receipt confirmation as a terminal push delivery status.

ALTER TABLE public.notification_push_deliveries
  DROP CONSTRAINT IF EXISTS notification_push_deliveries_status_check;

ALTER TABLE public.notification_push_deliveries
  ADD CONSTRAINT notification_push_deliveries_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_push_delivery_sent_tickets
  ON public.notification_push_deliveries(status, updated_at)
  WHERE expo_ticket_id IS NOT NULL;
