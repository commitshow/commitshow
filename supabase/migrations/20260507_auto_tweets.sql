-- auto_tweets · @commitshow X auto-post log + cooldown.
--
-- Fired from analyze-project after a fresh snapshot lands when the
-- audit cleared the 85+ threshold. The Edge Function `auto-tweet`
-- enforces the 4-gate eligibility check (score · cooldown · public ·
-- not-opted-out), posts via X API v2, and records the tweet here.
--
-- Cooldown: a project can be tweeted ONCE per 14 days regardless of
-- how many times its score crosses 85+. Enforced via a unique partial
-- index keyed on the floor-week so a re-audit 13 days later doesn't
-- repeat-blast.
--
-- The opt-out column lands on projects (per-project) so creators of
-- platform-auditioned projects can hide their own audition from
-- @commitshow auto-posts. CLI walk-ons (status='preview') never get
-- auto-tweeted in the first place — consent is the gate, not opt-out
-- (decision 2026-05-07: brand stage is for platform-submitted audits,
-- not anonymous third-party CLI runs).

CREATE TABLE IF NOT EXISTS public.auto_tweets (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  posted_at       timestamptz   NOT NULL DEFAULT now(),
  tweet_id        text,                              -- X's tweet ID · for delete-on-opt-out
  tweet_url       text,                              -- https://x.com/commitshow/status/<tweet_id>
  score_at_post   int           NOT NULL,
  template_used   text          NOT NULL,           -- which template fired (a/b/c/d)
  status          text          NOT NULL DEFAULT 'posted'
                  CHECK (status IN ('posted', 'failed', 'deleted', 'skipped')),
  error_message   text,                              -- populated on failed
  payload         jsonb         NOT NULL DEFAULT '{}'::jsonb,  -- snapshot of scores + scope
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_tweets_project    ON public.auto_tweets(project_id);
CREATE INDEX IF NOT EXISTS idx_auto_tweets_posted_at  ON public.auto_tweets(posted_at DESC);

-- 14-day cooldown is enforced by the auto-tweet Edge Function via a
-- pre-INSERT SELECT (no recent posted row) rather than a unique index.
-- Reason: PG rejects most date-bucket index expressions as not
-- IMMUTABLE (extract / date_trunc + arithmetic). The Edge Function is
-- the only writer; concurrent calls for the same project can't happen
-- because analyze-project serializes per project_id.

ALTER TABLE public.auto_tweets ENABLE ROW LEVEL SECURITY;

-- service_role only · this table is admin-tier infrastructure.
-- No anon/auth read · we expose tweet_url in views if/when we want
-- a public "recently tweeted" list, but the table itself stays closed.

GRANT ALL ON public.auto_tweets TO service_role;

-- ── projects.social_share_disabled · per-project opt-out ──
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS social_share_disabled boolean NOT NULL DEFAULT false;

GRANT SELECT (social_share_disabled), UPDATE (social_share_disabled)
  ON public.projects TO authenticated;
GRANT SELECT (social_share_disabled) ON public.projects TO anon;

-- Allow the project's creator to flip the flag via PATCH.
-- Anonymous walk-on projects (creator_id IS NULL) can be opted out by
-- ANY authenticated user that knows the project ID — the friction is
-- the URL, which is already shareable. Better permissive than blocking
-- a maintainer who just signed up to hide their audit.
DROP POLICY IF EXISTS projects_social_share_self_update ON public.projects;
CREATE POLICY projects_social_share_self_update
  ON public.projects
  FOR UPDATE
  TO authenticated
  USING (creator_id = auth.uid() OR creator_id IS NULL)
  WITH CHECK (creator_id = auth.uid() OR creator_id IS NULL);
