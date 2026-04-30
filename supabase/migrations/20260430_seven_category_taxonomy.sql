-- §11-NEW.1.1 redesign · 6 form-factor buckets → 7 use-case categories.
-- Form factor (web/mobile/CLI), stage, and pricing now live as
-- orthogonal filters; categories describe the use-case axis.
--
-- Mapping applied to existing data (both business_category and
-- detected_category columns):
--   saas      → niche_saas
--   tool      → dev_tools
--   library   → dev_tools
--   ai_agent  → ai_agents_chat
--   game      → games_playful
--   other     → productivity_personal       (broadest catch-all)
--
-- Auto-detector now writes ONLY to detected_category. The user picks
-- the canonical business_category at audit-result time (or via the
-- project EDIT form). MV uses COALESCE(business_category,
-- detected_category, 'productivity_personal').

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_business_category_check;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_detected_category_check;

UPDATE projects SET business_category = CASE business_category
  WHEN 'saas'     THEN 'niche_saas'
  WHEN 'tool'     THEN 'dev_tools'
  WHEN 'library'  THEN 'dev_tools'
  WHEN 'ai_agent' THEN 'ai_agents_chat'
  WHEN 'game'     THEN 'games_playful'
  WHEN 'other'    THEN 'productivity_personal'
  ELSE business_category
END WHERE business_category IS NOT NULL;

UPDATE projects SET detected_category = CASE detected_category
  WHEN 'saas'     THEN 'niche_saas'
  WHEN 'tool'     THEN 'dev_tools'
  WHEN 'library'  THEN 'dev_tools'
  WHEN 'ai_agent' THEN 'ai_agents_chat'
  WHEN 'game'     THEN 'games_playful'
  WHEN 'other'    THEN 'productivity_personal'
  ELSE detected_category
END WHERE detected_category IS NOT NULL;

ALTER TABLE projects ADD CONSTRAINT projects_business_category_check
  CHECK (business_category IS NULL OR business_category IN (
    'productivity_personal','niche_saas','creator_media','dev_tools',
    'ai_agents_chat','consumer_lifestyle','games_playful'
  ));
ALTER TABLE projects ADD CONSTRAINT projects_detected_category_check
  CHECK (detected_category IS NULL OR detected_category IN (
    'productivity_personal','niche_saas','creator_media','dev_tools',
    'ai_agents_chat','consumer_lifestyle','games_playful'
  ));

-- Recreate ladder_rankings_mv with new fallback default.
DROP MATERIALIZED VIEW IF EXISTS ladder_rankings_mv;
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
    COALESCE(p.business_category, p.detected_category, 'productivity_personal') AS category,
    p.score_total, p.score_auto, p.audit_count,
    ls.commit_sha,
    COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) AS audited_at,
    p.created_at AS project_created_at,
    CASE WHEN COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) >= now() - interval '24 hours'
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(p.business_category, p.detected_category, 'productivity_personal')
        ORDER BY p.score_total DESC,
                 COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) DESC,
                 p.score_auto DESC, p.audit_count ASC, p.created_at ASC
      ) ELSE NULL END AS rank_today,
    CASE WHEN COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) >= now() - interval '7 days'
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(p.business_category, p.detected_category, 'productivity_personal')
        ORDER BY p.score_total DESC,
                 COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) DESC,
                 p.score_auto DESC, p.audit_count ASC, p.created_at ASC
      ) ELSE NULL END AS rank_week,
    CASE WHEN COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) >= now() - interval '30 days'
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(p.business_category, p.detected_category, 'productivity_personal')
        ORDER BY p.score_total DESC,
                 COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) DESC,
                 p.score_auto DESC, p.audit_count ASC, p.created_at ASC
      ) ELSE NULL END AS rank_month,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(p.business_category, p.detected_category, 'productivity_personal')
      ORDER BY p.score_total DESC,
               COALESCE(ls.audited_at, p.last_analysis_at, p.created_at) DESC,
               p.score_auto DESC, p.audit_count ASC, p.created_at ASC
    ) AS rank_all_time
  FROM projects p
  LEFT JOIN latest_snapshot ls ON ls.project_id = p.id
  WHERE p.score_total > 0
    AND p.status IN ('active','graduated','valedictorian')
)
SELECT project_id, category, score_total, score_auto, audit_count,
       audited_at, commit_sha,
       rank_today, rank_week, rank_month, rank_all_time
FROM ranked;

CREATE UNIQUE INDEX IF NOT EXISTS ladder_rankings_mv_pk    ON ladder_rankings_mv (project_id);
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_today_idx ON ladder_rankings_mv (category, rank_today) WHERE rank_today IS NOT NULL;
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_week_idx  ON ladder_rankings_mv (category, rank_week)  WHERE rank_week  IS NOT NULL;
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_month_idx ON ladder_rankings_mv (category, rank_month) WHERE rank_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_all_idx   ON ladder_rankings_mv (category, rank_all_time);
