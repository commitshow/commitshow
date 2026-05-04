-- CLI device-flow login · short-lived authorization codes that bridge a
-- terminal CLI with a browser-authenticated session.
--
-- Flow:
--   1. CLI POSTs /functions/v1/cli-link-init · server inserts a row
--      (status='pending', code=6 hex, poll_token=uuid, expires_at=10m).
--   2. CLI opens browser to commit.show/cli/link?code=ABCDEF.
--   3. User (signed in on web) sees "Authorize CLI?" → clicks Approve.
--      Browser POSTs /functions/v1/cli-link-approve with code + their
--      session JWT. Server verifies caller, marks row approved with
--      auth.uid(), generates a long-lived API token (signed with
--      service-role JWT secret · sub=user.id · exp=90 days).
--   4. CLI polls /functions/v1/cli-link-poll with poll_token · gets
--      back the API token once status='approved'.
--   5. CLI saves the API token to ~/.commitshow/config.json.
--
-- Privacy: short TTL (10 min unapproved · 24 h approved-but-unfetched)
-- so abandoned codes auto-expire. Only the issuing CLI can fetch the
-- token (poll_token is the secret · code is the user-facing display).

CREATE TABLE IF NOT EXISTS public.cli_link_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,         -- 6 hex chars · displayed in browser
  poll_token   text NOT NULL UNIQUE,         -- uuid · CLI's secret to poll
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','consumed','expired')),
  approved_by  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  approved_at  timestamptz,
  api_token    text,                         -- minted JWT · null until approval
  consumed_at  timestamptz,                  -- when CLI fetched the token
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cli_link_codes_code       ON public.cli_link_codes (code);
CREATE INDEX IF NOT EXISTS idx_cli_link_codes_poll_token ON public.cli_link_codes (poll_token);
CREATE INDEX IF NOT EXISTS idx_cli_link_codes_expires_at ON public.cli_link_codes (expires_at)
  WHERE status IN ('pending', 'approved');

ALTER TABLE public.cli_link_codes ENABLE ROW LEVEL SECURITY;

-- All access via Edge Functions using service role · no direct anon /
-- authenticated read or write paths needed. Restrictive policies just
-- to be explicit.
DROP POLICY IF EXISTS "service role only" ON public.cli_link_codes;
CREATE POLICY "service role only" ON public.cli_link_codes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.cli_link_codes TO service_role;

-- Cleanup helper · runs from a Supabase Cron (TBD) to expire stale rows.
-- For now manual-callable so the Edge Functions can opportunistically
-- prune on every init.
CREATE OR REPLACE FUNCTION public.cli_link_expire_stale()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.cli_link_codes
     SET status = 'expired'
   WHERE status IN ('pending','approved')
     AND expires_at < now();
$$;

GRANT EXECUTE ON FUNCTION public.cli_link_expire_stale() TO service_role;
