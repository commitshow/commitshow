-- Token leaderboard RPCs · powers /leaderboard/tokens + per-project
-- efficiency panel.
--
-- Public reads · these RPCs are SECURITY DEFINER + GRANT EXECUTE TO anon
-- so they can power unauth landing surfaces. Only aggregate columns are
-- returned · per-row token counts and cost figures stay table-only.

-- ── Top consumers · person-level token leaderboard ─────────────────
-- Aggregates verified rows in audit_token_usage by member_id, joined to
-- a representative project for the row click-through. Limit defaults
-- low · the front page surfaces top 20 only · paginated tab can ask
-- for more.
CREATE OR REPLACE FUNCTION public.top_token_consumers(
  p_source text DEFAULT 'claude_code',
  p_limit  int  DEFAULT 20
) RETURNS TABLE (
  member_id      uuid,
  display_name   text,
  avatar_url     text,
  total_tokens   bigint,
  input_tokens   bigint,
  output_tokens  bigint,
  cache_create   bigint,
  cache_read     bigint,
  cost_usd       numeric,
  project_count  int,
  best_project_id   uuid,
  best_project_name text,
  best_project_score int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_member AS (
    SELECT
      u.member_id,
      SUM(u.total_tokens)        AS total_tokens,
      SUM(u.input_tokens)        AS input_tokens,
      SUM(u.output_tokens)       AS output_tokens,
      SUM(u.cache_create_tokens) AS cache_create,
      SUM(u.cache_read_tokens)   AS cache_read,
      SUM(u.cost_usd)            AS cost_usd,
      COUNT(DISTINCT u.project_id) AS project_count
    FROM audit_token_usage u
    WHERE u.source = p_source
      AND u.member_id IS NOT NULL
      AND u.verified = true
    GROUP BY u.member_id
  ),
  best AS (
    SELECT DISTINCT ON (u.member_id)
      u.member_id,
      u.project_id,
      p.project_name,
      p.score_total
    FROM audit_token_usage u
    JOIN projects p ON p.id = u.project_id
    WHERE u.source = p_source
      AND u.verified = true
    ORDER BY u.member_id, p.score_total DESC NULLS LAST, u.last_seen_at DESC NULLS LAST
  )
  SELECT
    pm.member_id,
    m.display_name,
    m.avatar_url,
    pm.total_tokens,
    pm.input_tokens,
    pm.output_tokens,
    pm.cache_create,
    pm.cache_read,
    pm.cost_usd,
    pm.project_count::int,
    b.project_id,
    b.project_name,
    COALESCE(b.score_total, 0)::int
  FROM per_member pm
  JOIN members m ON m.id = pm.member_id
  LEFT JOIN best b ON b.member_id = pm.member_id
  ORDER BY pm.total_tokens DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.top_token_consumers(text, int) TO anon, authenticated, service_role;

-- ── Project-level totals · single-project lookup for the efficiency
--    panel. Returns null totals if no receipt exists yet.
CREATE OR REPLACE FUNCTION public.project_token_summary(
  p_project_id uuid
) RETURNS TABLE (
  project_id     uuid,
  total_tokens   bigint,
  input_tokens   bigint,
  output_tokens  bigint,
  cache_create   bigint,
  cache_read     bigint,
  cost_usd       numeric,
  source_count   int,
  any_verified   boolean,
  first_at       timestamptz,
  last_at        timestamptz,
  efficiency_score numeric    -- score / (total_tokens / 1M)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS project_id,
    COALESCE(t.total_tokens, 0)        AS total_tokens,
    COALESCE(t.input_tokens, 0)        AS input_tokens,
    COALESCE(t.output_tokens, 0)       AS output_tokens,
    COALESCE(t.cache_create_tokens, 0) AS cache_create,
    COALESCE(t.cache_read_tokens, 0)   AS cache_read,
    COALESCE(t.cost_usd, 0)            AS cost_usd,
    COALESCE(t.source_count, 0)::int   AS source_count,
    COALESCE(t.any_verified, false)    AS any_verified,
    t.first_at,
    t.last_at,
    -- Efficiency · score per 1M tokens · null when no tokens recorded
    CASE
      WHEN COALESCE(t.total_tokens, 0) > 0 AND p.score_total IS NOT NULL
      THEN ROUND((p.score_total::numeric / (t.total_tokens::numeric / 1000000.0))::numeric, 2)
      ELSE NULL
    END AS efficiency_score
  FROM projects p
  LEFT JOIN project_token_totals_mv t ON t.project_id = p.id
  WHERE p.id = p_project_id;
$$;

GRANT EXECUTE ON FUNCTION public.project_token_summary(uuid) TO anon, authenticated, service_role;

-- ── Efficiency leaderboard · score per 1M tokens · for the
--    "tokens vs score" derived view. Filters tiny denominators
--    (≤ 100K tokens) so a single audit run with cache-only doesn't
--    rocket to top of leaderboard.
CREATE OR REPLACE FUNCTION public.top_token_efficiency(
  p_source     text DEFAULT 'claude_code',
  p_min_tokens bigint DEFAULT 100000,
  p_limit      int    DEFAULT 20
) RETURNS TABLE (
  project_id        uuid,
  project_name      text,
  score             int,
  total_tokens      bigint,
  efficiency_score  numeric,
  member_id         uuid,
  display_name      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.project_id,
    p.project_name,
    p.score_total::int AS score,
    t.total_tokens,
    ROUND((p.score_total::numeric / (t.total_tokens::numeric / 1000000.0))::numeric, 2) AS efficiency_score,
    p.creator_id AS member_id,
    m.display_name
  FROM project_token_totals_mv t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN members m ON m.id = p.creator_id
  WHERE t.total_tokens >= p_min_tokens
    AND t.any_verified = true
    AND p.score_total IS NOT NULL
    AND p.status <> 'preview'
  ORDER BY efficiency_score DESC, p.score_total DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.top_token_efficiency(text, bigint, int) TO anon, authenticated, service_role;
