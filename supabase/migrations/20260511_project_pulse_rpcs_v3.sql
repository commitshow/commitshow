-- project_pulse_stats v3 · align comments count to "top-level + human"
--
-- v1/v2 counted ALL comment rows including replies and system-bot
-- comments. ProjectComments header counted top-level only (still
-- including system bots). Modal render varied. Three different
-- numbers for the same surface · confusing.
--
-- v3 rule: count top-level human comments only (parent_id IS NULL
-- AND kind != 'system'). Replies are conversations, not new social
-- events. System bots (Stage Manager welcome / score-jump / etc)
-- are automatic — they don't represent community activity.
--
-- Applied uniformly to:
--   · project_pulse_stats.comments
--   · ProjectComments header count (client-side filter aligns)
--   · Any future comment-count surface

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
      WHERE project_id  = p_project_id
        AND parent_id   IS NULL
        AND COALESCE(kind, 'human') = 'human'
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
