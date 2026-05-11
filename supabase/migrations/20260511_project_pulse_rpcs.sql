-- Project pulse + recent activity RPCs.
--
-- Drives the new ProjectDetailPage CommunityPulseStrip (4-tile mini
-- stats above the audit body) and the RecentActivityCard (timeline
-- of recent applauds + comments + votes). Both are designed to land
-- in a single network round trip so the page paints fast even when
-- a project has thousands of interactions.
--
-- Both functions are SECURITY DEFINER · they read aggregates and
-- short text previews · no row-level data exposure beyond what
-- already shows on the public project page.

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

GRANT EXECUTE ON FUNCTION public.project_pulse_stats(uuid) TO authenticated, anon, service_role;

-- ── project_recent_activity ──────────────────────────────────────
-- UNION of applauds + comments + votes for a project, newest first.
-- Returns enough metadata for the client to render a timeline row
-- without further joins (actor display_name, applaud/comment kind,
-- short preview for comments, vote count + predicted score).

CREATE OR REPLACE FUNCTION public.project_recent_activity(
  p_project_id uuid,
  p_limit      int DEFAULT 10
)
RETURNS TABLE (
  kind            text,           -- 'applaud' | 'comment' | 'forecast'
  actor_id        uuid,
  actor_name      text,
  actor_avatar    text,
  preview         text,            -- short text for comments · null otherwise
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
    -- applauds on the product target
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

    -- comments on the project
    SELECT
      'comment'::text                                AS kind,
      c.member_id                                    AS actor_id,
      LEFT(c.text, 120)                              AS preview,
      NULL::int                                      AS vote_count,
      NULL::int                                      AS predicted_score,
      c.created_at
    FROM comments c
    WHERE c.project_id = p_project_id

    UNION ALL

    -- forecasts (votes) on the project
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

GRANT EXECUTE ON FUNCTION public.project_recent_activity(uuid, int) TO authenticated, anon, service_role;
