-- top_movers_week · landing-page "Top 3 movers this week" feed.
--
-- For each project, compares the latest snapshot.score_total against
-- the earliest snapshot.score_total inside the window (default 7d).
-- Returns the top N by delta — only positive movers (climbs are the
-- bragging artifact, regressions don't belong on the headline strip).
--
-- Excludes preview-status (CLI walk-on) projects and ones with
-- social_share_disabled · same consent posture as auto-tweet.
--
-- Snapshots requirement: project must have ≥ 2 snapshots inside the
-- window. A single snapshot has no delta to report.

CREATE OR REPLACE FUNCTION public.top_movers_week(
  p_window_days int DEFAULT 7,
  p_limit       int DEFAULT 3
) RETURNS TABLE (
  project_id   uuid,
  project_name text,
  start_score  int,
  end_score    int,
  delta        int,
  snapshots    int,
  start_at     timestamptz,
  end_at       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH window_snaps AS (
    SELECT
      s.project_id,
      s.score_total,
      s.created_at,
      ROW_NUMBER() OVER (PARTITION BY s.project_id ORDER BY s.created_at ASC)  AS rn_asc,
      ROW_NUMBER() OVER (PARTITION BY s.project_id ORDER BY s.created_at DESC) AS rn_desc,
      COUNT(*)    OVER (PARTITION BY s.project_id)                              AS snap_count
    FROM analysis_snapshots s
    WHERE s.created_at >= now() - (p_window_days || ' days')::interval
      AND s.score_total IS NOT NULL
  ),
  bookends AS (
    SELECT
      first_s.project_id,
      first_s.score_total AS start_score,
      first_s.created_at  AS start_at,
      last_s.score_total  AS end_score,
      last_s.created_at   AS end_at,
      first_s.snap_count  AS snapshots
    FROM window_snaps first_s
    JOIN window_snaps last_s
      ON last_s.project_id = first_s.project_id
     AND last_s.rn_desc = 1
    WHERE first_s.rn_asc = 1
      AND first_s.snap_count >= 2
  )
  SELECT
    b.project_id,
    p.project_name,
    b.start_score,
    b.end_score,
    (b.end_score - b.start_score) AS delta,
    b.snapshots,
    b.start_at,
    b.end_at
  FROM bookends b
  JOIN projects p ON p.id = b.project_id
  WHERE p.status <> 'preview'
    AND p.social_share_disabled = false
    AND (b.end_score - b.start_score) > 0
  ORDER BY (b.end_score - b.start_score) DESC, b.end_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.top_movers_week(int, int) TO anon, authenticated, service_role;
