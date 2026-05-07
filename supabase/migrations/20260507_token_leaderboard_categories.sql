-- Token leaderboard · category bracketing + per-category token floor.
--
-- Naive `score / tokens` ratio favored simple projects (a static
-- landing page at 85 pts and 50K tokens beat a complex SaaS at 78 pts
-- and 50M tokens · same denominator, no complexity adjustment).
-- 2026-05-07 fix: bracket by `projects.business_category` and apply a
-- per-category token floor so each leaderboard ranks projects of
-- comparable complexity.
--
-- Floors are educated guesses · can be tuned once enough data lands:
--   saas       · 500K   (complex backend + UI · multi-service)
--   ai_agent   · 500K   (LLM workflows · long contexts)
--   game       · 300K   (varies by genre)
--   tool       · 200K   (CLIs, utilities · narrower scope)
--   library    · 200K   (packages with tests + docs)
--   other      · 200K   (default)
--   NULL (all) · 200K   (cross-category default)

DROP FUNCTION IF EXISTS public.top_token_consumers(text, int);
DROP FUNCTION IF EXISTS public.top_token_efficiency(text, bigint, int);

CREATE OR REPLACE FUNCTION public.token_floor_for_category(p_category text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_category
    WHEN 'saas'     THEN 500000
    WHEN 'ai_agent' THEN 500000
    WHEN 'game'     THEN 300000
    WHEN 'tool'     THEN 200000
    WHEN 'library'  THEN 200000
    WHEN 'other'    THEN 200000
    ELSE 200000  -- includes NULL · cross-category default
  END;
$$;

GRANT EXECUTE ON FUNCTION public.token_floor_for_category(text) TO anon, authenticated, service_role;

-- ── Top consumers · person-level token leaderboard ────────────────
-- Now category-bracketed. NULL category = cross-category roll-up.
CREATE OR REPLACE FUNCTION public.top_token_consumers(
  p_source   text DEFAULT 'claude_code',
  p_category text DEFAULT NULL,
  p_limit    int  DEFAULT 20
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
  WITH eligible AS (
    SELECT u.*, p.business_category, p.score_total AS proj_score, p.project_name AS proj_name
    FROM audit_token_usage u
    JOIN projects p ON p.id = u.project_id
    WHERE u.source = p_source
      AND u.member_id IS NOT NULL
      AND u.verified = true
      AND (p_category IS NULL OR p.business_category = p_category)
  ),
  per_member AS (
    SELECT
      member_id,
      SUM(total_tokens)        AS total_tokens,
      SUM(input_tokens)        AS input_tokens,
      SUM(output_tokens)       AS output_tokens,
      SUM(cache_create_tokens) AS cache_create,
      SUM(cache_read_tokens)   AS cache_read,
      SUM(cost_usd)            AS cost_usd,
      COUNT(DISTINCT project_id) AS project_count
    FROM eligible
    GROUP BY member_id
  ),
  best AS (
    SELECT DISTINCT ON (member_id)
      member_id, project_id, proj_name, proj_score
    FROM eligible
    ORDER BY member_id, proj_score DESC NULLS LAST, last_seen_at DESC NULLS LAST
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
    b.proj_name,
    COALESCE(b.proj_score, 0)::int
  FROM per_member pm
  JOIN members m ON m.id = pm.member_id
  LEFT JOIN best b ON b.member_id = pm.member_id
  ORDER BY pm.total_tokens DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.top_token_consumers(text, text, int) TO anon, authenticated, service_role;

-- ── Efficiency leaderboard · score per 1M tokens ──────────────────
-- Floor varies by category · keeps complexity-adjusted comparison.
CREATE OR REPLACE FUNCTION public.top_token_efficiency(
  p_source   text DEFAULT 'claude_code',
  p_category text DEFAULT NULL,
  p_limit    int  DEFAULT 20
) RETURNS TABLE (
  project_id        uuid,
  project_name      text,
  business_category text,
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
    p.business_category::text,
    p.score_total::int AS score,
    t.total_tokens,
    ROUND((p.score_total::numeric / (t.total_tokens::numeric / 1000000.0))::numeric, 2) AS efficiency_score,
    p.creator_id AS member_id,
    m.display_name
  FROM project_token_totals_mv t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN members m ON m.id = p.creator_id
  WHERE t.total_tokens >= public.token_floor_for_category(p_category)
    AND t.any_verified = true
    AND p.score_total IS NOT NULL
    AND p.status <> 'preview'
    AND (p_category IS NULL OR p.business_category = p_category)
  ORDER BY efficiency_score DESC, p.score_total DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.top_token_efficiency(text, text, int) TO anon, authenticated, service_role;
