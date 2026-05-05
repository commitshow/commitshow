-- X (Twitter) OAuth 2.0 token storage. Two separate tables because
-- the @commitshow official account token has no member row to attach
-- to (members.id FKs to auth.users · we'd need a real auth user to
-- use a sentinel, which conflates auth surface with system state).
--
-- Tables:
--   x_official_account · single row · @commitshow official tokens.
--                        Drives system posts (Spotlight Reveal,
--                        Weekly Digest, Encore announcements).
--   x_oauth_tokens     · per-member tokens captured during user
--                        sign-in via Supabase Auth. Drives the 8
--                        per-user triggers (strategy doc §4.2).
--
-- Both are RLS-locked with no policies → only service_role
-- (Edge Functions) can read/write. Tokens never appear in any
-- client-side network panel.

-- 1. Official @commitshow account · single-row table. PK on a
--    'singleton' boolean so we can enforce "exactly one row".
CREATE TABLE IF NOT EXISTS public.x_official_account (
  singleton      boolean       PRIMARY KEY DEFAULT true CHECK (singleton = true),
  access_token   text          NOT NULL,
  refresh_token  text,
  expires_at     timestamptz   NOT NULL,
  scopes         text          NOT NULL DEFAULT '',
  x_user_id      text,
  x_handle       text          DEFAULT 'commitshow',
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);

ALTER TABLE public.x_official_account ENABLE ROW LEVEL SECURITY;
-- No policies = service_role only.

-- 2. Per-member token store · captured during Supabase Auth sign-in
--    when scope includes tweet.write + offline.access.
CREATE TABLE IF NOT EXISTS public.x_oauth_tokens (
  member_id      uuid          PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  access_token   text          NOT NULL,
  refresh_token  text,
  expires_at     timestamptz   NOT NULL,
  scopes         text          NOT NULL DEFAULT '',
  x_user_id      text,
  x_handle       text,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_x_oauth_tokens_expires_at ON public.x_oauth_tokens(expires_at);

ALTER TABLE public.x_oauth_tokens ENABLE ROW LEVEL SECURITY;
-- No policies = service_role only.

-- 3. Audit log · every send-tweet attempt lands a row whether it
--    succeeded or failed. Drives the 8-trigger dedup + diagnostics.
CREATE TABLE IF NOT EXISTS public.x_share_log (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL member_id = posted from the official @commitshow account.
  member_id      uuid          REFERENCES members(id) ON DELETE CASCADE,
  trigger_kind   text          NOT NULL CHECK (trigger_kind IN (
    'audition', 'round_delta', 'frame_pass', 'forecast_cast',
    'streak_milestone', 'encore_earned', 'library_publish', 'acted_on',
    'system'
  )),
  source_id      uuid,
  source_table   text,
  -- Idempotency. Format suggestion: '<trigger>:<source_id>:<extra>'.
  dedupe_key     text          UNIQUE,
  text_posted    text,
  tweet_id       text,
  status         text          NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  error          text,
  posted_at      timestamptz,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_x_share_log_member ON public.x_share_log(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_x_share_log_kind   ON public.x_share_log(trigger_kind, created_at DESC);

ALTER TABLE public.x_share_log ENABLE ROW LEVEL SECURITY;
-- Members can read their OWN share log (future "your auto-shares" panel).
-- System posts (member_id IS NULL) stay service_role-only.
CREATE POLICY x_share_log_owner_read ON public.x_share_log
  FOR SELECT
  USING (auth.uid() = member_id);
GRANT SELECT ON public.x_share_log TO authenticated;
