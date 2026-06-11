-- =============================================================
-- Dispatch queued mobile push deliveries immediately from Supabase
-- =============================================================
--
-- Why:
-- - Web clients already receive new rows through Supabase Realtime.
-- - Mobile OS push needs a server-side sender even when the app is closed.
-- - The existing trigger creates notification_push_deliveries rows; this
--   trigger asks the Next API dispatcher to process the queue immediately.
--
-- Required Vault secrets, set outside this migration:
-- - chflow_push_dispatch_url
--   e.g. https://chflow-app.vercel.app/api/mobile/push-dispatch
-- - chflow_push_dispatch_secret
--   must match PUSH_DISPATCH_SECRET or CRON_SECRET in Vercel

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.dispatch_notification_push_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dispatch_url text;
  dispatch_secret text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret
    INTO dispatch_url
  FROM vault.decrypted_secrets
  WHERE name = 'chflow_push_dispatch_url'
  LIMIT 1;

  SELECT decrypted_secret
    INTO dispatch_secret
  FROM vault.decrypted_secrets
  WHERE name = 'chflow_push_dispatch_secret'
  LIMIT 1;

  IF coalesce(dispatch_url, '') = '' OR coalesce(dispatch_secret, '') = '' THEN
    RETURN NEW;
  END IF;

  -- pg_net runs asynchronously after the transaction commits, so notification
  -- insert flows are not blocked by Expo/Vercel network latency.
  EXECUTE
    'SELECT net.http_post(
       url := $1,
       body := $2,
       headers := $3,
       timeout_milliseconds := 5000
     )'
    INTO request_id
    USING
      dispatch_url,
      jsonb_build_object('delivery_id', NEW.id, 'notification_id', NEW.notification_id),
      jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || dispatch_secret
      );

  RETURN NEW;
EXCEPTION
  WHEN invalid_schema_name OR undefined_table OR undefined_function THEN
    -- TODO: Remove this guard only after Vault + pg_net are required baseline
    -- extensions in every Supabase environment.
    RETURN NEW;
  WHEN others THEN
    -- Do not break the business transaction because push dispatch is additive.
    RAISE LOG 'dispatch_notification_push_deliveries skipped: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_notification_push_deliveries
  ON public.notification_push_deliveries;

CREATE TRIGGER trg_dispatch_notification_push_deliveries
AFTER INSERT ON public.notification_push_deliveries
FOR EACH ROW
EXECUTE FUNCTION public.dispatch_notification_push_deliveries();
