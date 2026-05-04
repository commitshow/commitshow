-- notification_log · audit trail + dedupe key for every email/push
-- dispatched by the platform. Centralized so:
--   1. Re-runs / replays don't double-send (UNIQUE on dedupe_key)
--   2. We can show "we sent you N emails this week" in /me
--   3. Bounce / complaint webhooks can mark events back without
--      losing the original send context.
--
-- The send-email Edge Function INSERTs first (with status='queued'),
-- POSTs to Resend, then UPDATEs status to 'sent' / 'failed' with the
-- provider message id. Failed sends keep the row so we can retry.

CREATE TABLE IF NOT EXISTS public.notification_log (
  id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz       NOT NULL DEFAULT now(),
  -- channel · 'email' for now, leave the column for 'push'/'sms' later
  channel         text              NOT NULL CHECK (channel IN ('email','push')),
  -- kind · domain event name (welcome · audit_complete · graduation_honors · …)
  kind            text              NOT NULL,
  -- recipient · member id when known, plus raw address as fallback
  recipient_id    uuid              REFERENCES public.members(id) ON DELETE SET NULL,
  recipient_addr  text              NOT NULL,
  -- payload · subject / template-vars / project_id etc. for audit + retries
  payload         jsonb             NOT NULL DEFAULT '{}'::jsonb,
  -- dedupe · "kind:recipient_id:reference" so the same kind for the
  -- same project/member/snapshot is never sent twice
  dedupe_key      text              NOT NULL,
  -- delivery state machine
  status          text              NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sent','failed','bounced','complained')),
  provider        text,                 -- 'resend'
  provider_id     text,                 -- Resend message id
  error_message   text,
  sent_at         timestamptz,
  delivered_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_notification_log_dedupe
  ON public.notification_log(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_notification_log_recipient_id
  ON public.notification_log(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_kind_status
  ON public.notification_log(kind, status);
CREATE INDEX IF NOT EXISTS idx_notification_log_created_at
  ON public.notification_log(created_at DESC);

-- RLS · service-role only by default. /me can read its own rows via a
-- separate select policy when we add the "your notifications" tab.
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_log_self_read ON public.notification_log;
CREATE POLICY notif_log_self_read
  ON public.notification_log
  FOR SELECT
  USING (recipient_id = auth.uid());

-- Service-role bypasses RLS automatically; no explicit insert/update
-- policy needed for Edge Functions (they use the service-role key).
