-- CLI audit-call telemetry · per-call log distinct from analysis_snapshots.
--
-- Why a new table: analysis_snapshots is the per-audit RESULT log, written
-- only when the engine actually runs (cache miss + rate-limit OK). We also
-- want to count the FRONT of the funnel — every CLI hit on audit-preview
-- regardless of cache state — broken down by source (--source flag) and
-- runtime (User-Agent header). preview_rate_limits is an aggregate counter
-- (per IP-hash per day, no per-call detail).
--
-- Privacy: anonymous · no PII. Stores hashed IP (already used for rate
-- limits), parsed user-agent fields, and self-reported source. Useful
-- signals without identifying the actual user.

CREATE TABLE IF NOT EXISTS public.cli_audit_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Source: 'claude-code' · 'cursor' · 'antigravity' · 'gemini-cli' ·
  -- 'codex' · 'raw-cli' · 'unknown' · etc. Self-reported via --source
  -- flag or COMMITSHOW_SOURCE env. NULL when not provided.
  source          text,
  -- Parsed from User-Agent header: 'commitshow-cli/0.3.13'.
  cli_version     text,
  -- Parsed: 'v20.10.0'.
  node_version    text,
  -- Parsed: 'darwin-arm64' · 'linux-x64' · 'win32-x64' · etc.
  platform        text,
  -- IP / URL hashes mirror preview_rate_limits keys so we can join.
  ip_hash         text,
  url_hash        text,
  -- The github URL the user audited (full URL, not hashed — already public).
  github_url      text,
  -- Whether the request was a cache hit (no engine spend) or a fresh run.
  cache_hit       boolean,
  -- Whether the engine actually fired (i.e. snapshot was written).
  engine_fired    boolean,
  -- Snapshot id when engine_fired=true · joins to analysis_snapshots.
  snapshot_id     uuid REFERENCES public.analysis_snapshots(id) ON DELETE SET NULL,
  -- Raw User-Agent header for reference (lets us re-parse later if format changes).
  raw_user_agent  text
);

CREATE INDEX IF NOT EXISTS idx_cli_audit_calls_created_at ON public.cli_audit_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cli_audit_calls_source     ON public.cli_audit_calls (source);
CREATE INDEX IF NOT EXISTS idx_cli_audit_calls_url_hash   ON public.cli_audit_calls (url_hash);

ALTER TABLE public.cli_audit_calls ENABLE ROW LEVEL SECURITY;

-- Admin reads · service-role writes (audit-preview Edge Function inserts
-- via service role, no user-facing write path).
DROP POLICY IF EXISTS "admins read cli_audit_calls" ON public.cli_audit_calls;
CREATE POLICY "admins read cli_audit_calls" ON public.cli_audit_calls FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND is_admin));

GRANT SELECT ON public.cli_audit_calls TO authenticated;
GRANT ALL    ON public.cli_audit_calls TO service_role;
