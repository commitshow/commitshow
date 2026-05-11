-- project_pulse_stats v4 · revert v3's human-only filter.
--
-- v3 (just shipped) counted top-level human comments only. User
-- feedback: total of all interactions (top-level + replies +
-- system bots) is the correct social signal — every comment row
-- represents engagement, regardless of position or kind. Revert
-- to the simple "all rows" rule from v1.
--
-- The body-area ProjectComments preview will be hidden by passing
-- hidePreview=true so we don't have to align two different
-- visible counters. The pulse tile is the single source of truth.

CREATE OR REPLACE FUNCTION public.project_pulse_stats(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    a AS (
      SELECT COUNT(*)::int AS n
      FROM applauds
      WHERE target_type = 'product' AND target_id = p_project_id
    ),
    c AS (
      SELECT COUNT(*)::int AS n
      FROM comments
      WHERE project_id = p_project_id
    ),
    f AS (
      SELECT
        COUNT(*)::int                              AS n,
        ROUND(AVG(predicted_score)::numeric, 0)::int AS avg_predicted
      FROM votes
      WHERE project_id = p_project_id
    ),
    v AS (
      SELECT COUNT(*)::int AS n
      FROM visitor_hits
      WHERE path LIKE '/projects/' || p_project_id::text || '%'
    )
  SELECT jsonb_build_object(
    'applauds',       (SELECT n FROM a),
    'comments',       (SELECT n FROM c),
    'forecasts',      (SELECT n FROM f),
    'forecast_avg',   (SELECT avg_predicted FROM f),
    'views',          (SELECT n FROM v)
  );
$$;
