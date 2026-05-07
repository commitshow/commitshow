-- audit_token_usage · token usage ledger for the engine + user-side AI tools.
--
-- Two distinct sources land in the same table:
--   1. source='audit_engine' · OUR internal Claude SDK call inside
--      analyze-project. Captures cost-of-audit on a per-snapshot basis.
--      Used for admin cost monitoring · NOT shown to members.
--   2. source='claude_code' (and future 'aider' · 'cline' · 'continue')
--      · USER's coding-tool token spend, captured during audition flow
--      via a `commitshow extract` blob the user pastes into the form.
--      Powers the public token leaderboard + per-project efficiency panel.
--   3. source='self_reported' · user-typed approximation when verifiable
--      data isn't available. Lower trust tier, separate leaderboard tab.
--
-- Why one table not two: the cost-monitoring view needs snapshots-with-cost
-- and the user-leaderboard needs members-with-cost. Different queries but
-- same shape. Keeping them in one table simplifies aggregation refreshes
-- and lets us cross-check (member-claimed token spend vs. audit-engine
-- knowledge of when their snapshots fired).

CREATE TABLE IF NOT EXISTS public.audit_token_usage (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       uuid          REFERENCES public.members(id)             ON DELETE SET NULL,
  project_id      uuid          REFERENCES public.projects(id)            ON DELETE CASCADE,
  snapshot_id     uuid          REFERENCES public.analysis_snapshots(id)  ON DELETE CASCADE,
  source          text          NOT NULL CHECK (source IN (
                                  'audit_engine',     -- our Claude SDK call cost
                                  'claude_code',      -- user's Claude Code session JSONL
                                  'aider',            -- aider session log (future)
                                  'cline',            -- Cline (Roo) (future)
                                  'continue',         -- Continue (future)
                                  'self_reported'     -- user-typed approx
                                )),
  verified        boolean       NOT NULL DEFAULT false,
  -- Source-specific identifiers · for dedupe.
  --  audit_engine  : snapshot_id (1 INSERT per snapshot · upsert)
  --  claude_code   : Claude Code session UUID (per-session row · so a 47-session
  --                  blob lands as 47 rows; resubmit dedupes per session_id)
  --  self_reported : null (one row per audition step · upsert by member+project)
  session_id      text,
  content_hash    text,
  -- Token counts · all ≥ 0. cache_create + cache_read are Anthropic-specific
  -- but we keep them as universal columns since they're 0 for tools that
  -- don't expose cache stats.
  input_tokens         bigint NOT NULL DEFAULT 0 CHECK (input_tokens         >= 0),
  output_tokens        bigint NOT NULL DEFAULT 0 CHECK (output_tokens        >= 0),
  cache_create_tokens  bigint NOT NULL DEFAULT 0 CHECK (cache_create_tokens  >= 0),
  cache_read_tokens    bigint NOT NULL DEFAULT 0 CHECK (cache_read_tokens    >= 0),
  total_tokens         bigint GENERATED ALWAYS AS (
                              input_tokens + output_tokens + cache_create_tokens + cache_read_tokens
                            ) STORED,
  -- Cost estimate · USD. Computed in the Edge Function using current
  -- Sonnet 4.6 pricing (input $3/M · output $15/M · cache write $3.75/M ·
  -- cache read $0.30/M). Stored so historical pricing changes don't
  -- retroactively rewrite reported costs.
  cost_usd             numeric(10, 4) NOT NULL DEFAULT 0,
  model_version        text,
  -- Time bounds · audit_engine has both = created_at; claude_code uses
  -- the first/last assistant message timestamps in the session.
  first_seen_at        timestamptz,
  last_seen_at         timestamptz,
  -- Tool version · claude code: '1.x.x'; audit_engine: 'analyze-project@<sha>'.
  tool_version         text,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Dedupe keys · partial UNIQUE indexes per source so concurrent retries
-- collapse instead of inflating totals.
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_token_usage_engine_snapshot
  ON public.audit_token_usage (snapshot_id)
  WHERE source = 'audit_engine';

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_token_usage_claude_session
  ON public.audit_token_usage (project_id, session_id, content_hash)
  WHERE source = 'claude_code';

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_token_usage_self_report
  ON public.audit_token_usage (member_id, project_id)
  WHERE source = 'self_reported';

-- Read-path indexes
CREATE INDEX IF NOT EXISTS idx_audit_token_usage_member  ON public.audit_token_usage (member_id);
CREATE INDEX IF NOT EXISTS idx_audit_token_usage_project ON public.audit_token_usage (project_id);
CREATE INDEX IF NOT EXISTS idx_audit_token_usage_created ON public.audit_token_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_token_usage_source  ON public.audit_token_usage (source);

ALTER TABLE public.audit_token_usage ENABLE ROW LEVEL SECURITY;

-- service_role only by default · the leaderboard reads via SECURITY DEFINER
-- RPCs that aggregate without exposing per-row source/cost detail to anon.
GRANT ALL ON public.audit_token_usage TO service_role;

-- Per-member rolling totals · materialized for cheap leaderboard reads.
-- Refresh strategy: 5 minutes via pg_cron (added separately when the
-- leaderboard ships). Until then it auto-refreshes on demand from the
-- /admin/usage page.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.member_token_totals_mv AS
SELECT
  u.member_id,
  u.source,
  SUM(u.input_tokens)         AS input_tokens,
  SUM(u.output_tokens)        AS output_tokens,
  SUM(u.cache_create_tokens)  AS cache_create_tokens,
  SUM(u.cache_read_tokens)    AS cache_read_tokens,
  SUM(u.total_tokens)         AS total_tokens,
  SUM(u.cost_usd)             AS cost_usd,
  COUNT(*)                    AS row_count,
  MIN(u.first_seen_at)        AS first_at,
  MAX(u.last_seen_at)         AS last_at
FROM public.audit_token_usage u
WHERE u.member_id IS NOT NULL
  AND u.source <> 'audit_engine'   -- engine cost is NOT user-attributable
GROUP BY u.member_id, u.source;

CREATE UNIQUE INDEX IF NOT EXISTS uq_member_token_totals_mv_member_source
  ON public.member_token_totals_mv (member_id, source);

-- Per-project totals · powers the project-level efficiency panel.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.project_token_totals_mv AS
SELECT
  u.project_id,
  SUM(u.input_tokens)         AS input_tokens,
  SUM(u.output_tokens)        AS output_tokens,
  SUM(u.cache_create_tokens)  AS cache_create_tokens,
  SUM(u.cache_read_tokens)    AS cache_read_tokens,
  SUM(u.total_tokens)         AS total_tokens,
  SUM(u.cost_usd)             AS cost_usd,
  bool_or(u.verified)         AS any_verified,
  COUNT(DISTINCT u.source)    AS source_count,
  MIN(u.first_seen_at)        AS first_at,
  MAX(u.last_seen_at)         AS last_at
FROM public.audit_token_usage u
WHERE u.project_id IS NOT NULL
  AND u.source NOT IN ('audit_engine')
GROUP BY u.project_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_token_totals_mv_project
  ON public.project_token_totals_mv (project_id);

-- Refresh helper · invoked by usage-ingest after each ingest so the
-- project page sees the new totals immediately. CONCURRENT refresh
-- avoids blocking concurrent reads.
CREATE OR REPLACE FUNCTION public.refresh_token_totals_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.member_token_totals_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.project_token_totals_mv;
EXCEPTION WHEN OTHERS THEN
  -- Concurrent refresh requires a unique index AND a previous full
  -- refresh; on the very first call the MV is empty so concurrent
  -- mode raises. Fall back to a full refresh in that case.
  REFRESH MATERIALIZED VIEW public.member_token_totals_mv;
  REFRESH MATERIALIZED VIEW public.project_token_totals_mv;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_token_totals_mv() TO service_role;
