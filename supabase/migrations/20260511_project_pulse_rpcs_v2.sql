-- project_recent_activity v2 · drop comments UNION branch.
--
-- v1 surfaced applauds + comments + forecasts in a single mixed
-- timeline. Two issues found in testing:
--   1. The system-bot comment ("Welcome to the audition...") has
--      member_id IS NULL, so the LEFT JOIN to members returned
--      null and the UI fell back to "Someone commented · ...". Read
--      as a real user with broken attribution.
--   2. Comments preview (ProjectComments) already renders comments
--      right above the activity card. Showing comments in BOTH
--      surfaces was visual duplication for the same data.
--
-- New scope: applauds + forecasts ONLY. The card becomes the
-- "WHO'S REACTING" surface · ProjectComments stays the dedicated
-- comments thread.

CREATE OR REPLACE FUNCTION public.project_recent_activity(
  p_project_id uuid,
  p_limit      int DEFAULT 10
)
RETURNS TABLE (
  kind            text,           -- 'applaud' | 'forecast'  (comments removed in v2)
  actor_id        uuid,
  actor_name      text,
  actor_avatar    text,
  preview         text,            -- always null in v2 (kept for backward-compat)
  vote_count      int,             -- forecasts only
  predicted_score int,             -- forecasts only
  created_at      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH events AS (
    SELECT
      'applaud'::text                                AS kind,
      a.member_id                                    AS actor_id,
      NULL::text                                     AS preview,
      NULL::int                                      AS vote_count,
      NULL::int                                      AS predicted_score,
      a.created_at
    FROM applauds a
    WHERE a.target_type = 'product' AND a.target_id = p_project_id

    UNION ALL

    SELECT
      'forecast'::text                               AS kind,
      v.member_id                                    AS actor_id,
      NULL::text                                     AS preview,
      v.vote_count                                   AS vote_count,
      v.predicted_score                              AS predicted_score,
      v.created_at
    FROM votes v
    WHERE v.project_id = p_project_id
  )
  SELECT
    e.kind,
    e.actor_id,
    m.display_name                                   AS actor_name,
    m.avatar_url                                     AS actor_avatar,
    e.preview,
    e.vote_count,
    e.predicted_score,
    e.created_at
  FROM events e
  LEFT JOIN members m ON m.id = e.actor_id
  ORDER BY e.created_at DESC
  LIMIT GREATEST(1, LEAST(50, p_limit));
$$;
