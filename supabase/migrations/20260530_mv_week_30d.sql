-- 20260530 · widen ladder_rankings_mv 'this week' window 7d → 30d
--
-- Today's traffic is sparse: real audits cluster 19-28 days ago, so a
-- strict 7-day window leaves *this week* empty of real rows and the
-- mix reads as fake. Loosening to 30 days keeps the lane labeled
-- "this week" plausible while reflecting the actual traffic rhythm
-- (most vibe-coder MVPs ship + audit a couple times a month, not
-- weekly).
--
-- Same DROP + CREATE pattern as 20260430_ladder_audited_fallback.sql —
-- materialized views can't be ALTER'd in place.

DROP MATERIALIZED VIEW IF EXISTS ladder_rankings_mv CASCADE;

CREATE MATERIALIZED VIEW ladder_rankings_mv AS
WITH latest_snapshot AS (
  SELECT DISTINCT ON (s.project_id)
    s.project_id, s.score_total, s.score_auto,
    s.created_at AS audited_at, s.commit_sha
  FROM analysis_snapshots s
  ORDER BY s.project_id, s.created_at DESC
),
ranked AS (
  SELECT
    p.id              AS project_id,
    COALESCE(p.business_category, p.detected_category, 'other') AS category,
    p.score_total, p.score_auto, p.audit_count,
    ls.commit_sha,
    COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) AS audited_at,
    p.created_at AS project_created_at,
    CASE WHEN COALESCE(ls.audited_at, p.last_analysis_at, p.created_at)
              >= now() - interval '24 hours'
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(p.business_category, p.detected_category, 'other')
        ORDER BY p.score_total DESC,
                 COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) DESC,
                 p.score_auto DESC, p.audit_count ASC, p.created_at ASC
      ) ELSE NULL END AS rank_today,
    -- 2026-05-30 widened 7d → 30d (see header)
    CASE WHEN COALESCE(ls.audited_at, p.last_analysis_at, p.created_at)
              >= now() - interval '30 days'
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(p.business_category, p.detected_category, 'other')
        ORDER BY p.score_total DESC,
                 COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) DESC,
                 p.score_auto DESC, p.audit_count ASC, p.created_at ASC
      ) ELSE NULL END AS rank_week,
    CASE WHEN COALESCE(ls.audited_at, p.last_analysis_at, p.created_at)
              >= now() - interval '30 days'
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(p.business_category, p.detected_category, 'other')
        ORDER BY p.score_total DESC,
                 COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) DESC,
                 p.score_auto DESC, p.audit_count ASC, p.created_at ASC
      ) ELSE NULL END AS rank_month,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(p.business_category, p.detected_category, 'other')
      ORDER BY p.score_total DESC,
               COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) DESC,
               p.score_auto DESC, p.audit_count ASC, p.created_at ASC
    ) AS rank_all_time
  FROM projects p
  LEFT JOIN latest_snapshot ls ON ls.project_id = p.id
  WHERE p.score_total > 0
    AND p.status IN ('active', 'graduated', 'valedictorian')
)
SELECT project_id, category, score_total, score_auto, audit_count,
       audited_at, commit_sha,
       rank_today, rank_week, rank_month, rank_all_time
FROM ranked;

CREATE UNIQUE INDEX IF NOT EXISTS ladder_rankings_mv_pk
  ON ladder_rankings_mv (project_id);
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_today_idx
  ON ladder_rankings_mv (category, rank_today) WHERE rank_today IS NOT NULL;
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_week_idx
  ON ladder_rankings_mv (category, rank_week)  WHERE rank_week  IS NOT NULL;
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_month_idx
  ON ladder_rankings_mv (category, rank_month) WHERE rank_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_all_idx
  ON ladder_rankings_mv (category, rank_all_time);
