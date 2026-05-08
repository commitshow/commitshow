-- ladder_rankings_mv · rank_week 윈도우를 7일 → 14일 (2주) 로 확장.
--
-- 배경 (2026-05-09 · CEO directive '일단 new 를 2주로 하자'):
-- 초기 V1 단계는 audit cadence 가 낮아서 7일 윈도우가 너무 빡빡했음 ·
-- gamejalal (2026-05-01 audit, 8일 전) 같은 케이스가 just one day past
-- 의 사유로 'this week' 랭킹에서 빠짐 → 사용자에게 '갑자기 안나오는'
-- 으로 보임. 2주 윈도우로 두 audit cycle 정도 buffer 확보.
--
-- 'today' (24h) 와 'month' (30d) 는 그대로 두고 'week' 만 14d 로 늘림.
-- 향후 audit cadence 가 늘어나면 다시 7d 로 좁힐 수 있음 (의미적으로
-- "최신성" 신호이지 calendar week 가 아니라서 OK).

DROP MATERIALIZED VIEW IF EXISTS public.ladder_rankings_mv CASCADE;

CREATE MATERIALIZED VIEW public.ladder_rankings_mv AS
WITH latest_snapshot AS (
  SELECT DISTINCT ON (s.project_id)
    s.project_id, s.score_total, s.score_auto, s.created_at AS audited_at,
    s.commit_sha
  FROM analysis_snapshots s
  ORDER BY s.project_id, s.created_at DESC
),
ranked AS (
  SELECT
    p.id              AS project_id,
    COALESCE(p.business_category, p.detected_category, 'other') AS category,
    p.score_total,
    p.score_auto,
    p.audit_count,
    ls.commit_sha,
    ls.audited_at,
    p.created_at      AS project_created_at,
    -- 'today' window · 24h (unchanged)
    CASE WHEN ls.audited_at >= now() - interval '24 hours'
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(p.business_category, p.detected_category, 'other')
        ORDER BY p.score_total DESC,
                 ls.audited_at DESC,
                 p.score_auto DESC,
                 p.audit_count ASC,
                 p.created_at ASC
      )
      ELSE NULL
    END AS rank_today,
    -- 'week' window · widened 7d → 14d (2026-05-09)
    CASE WHEN ls.audited_at >= now() - interval '14 days'
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(p.business_category, p.detected_category, 'other')
        ORDER BY p.score_total DESC,
                 ls.audited_at DESC,
                 p.score_auto DESC,
                 p.audit_count ASC,
                 p.created_at ASC
      )
      ELSE NULL
    END AS rank_week,
    -- 'month' window · 30d (unchanged)
    CASE WHEN ls.audited_at >= now() - interval '30 days'
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(p.business_category, p.detected_category, 'other')
        ORDER BY p.score_total DESC,
                 ls.audited_at DESC,
                 p.score_auto DESC,
                 p.audit_count ASC,
                 p.created_at ASC
      )
      ELSE NULL
    END AS rank_month,
    -- 'all_time' (unchanged)
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(p.business_category, p.detected_category, 'other')
      ORDER BY p.score_total DESC,
               ls.audited_at DESC,
               p.score_auto DESC,
               p.audit_count ASC,
               p.created_at ASC
    ) AS rank_all_time
  FROM projects p
  LEFT JOIN latest_snapshot ls ON ls.project_id = p.id
  WHERE p.score_total > 0
    AND p.status IN ('active', 'graduated', 'valedictorian')
)
SELECT
  project_id, category, score_total, score_auto, audit_count,
  audited_at, commit_sha,
  rank_today, rank_week, rank_month, rank_all_time
FROM ranked;

CREATE UNIQUE INDEX IF NOT EXISTS ladder_rankings_mv_pk ON ladder_rankings_mv (project_id);
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_today_idx ON ladder_rankings_mv (category, rank_today) WHERE rank_today IS NOT NULL;
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_week_idx  ON ladder_rankings_mv (category, rank_week)  WHERE rank_week  IS NOT NULL;
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_month_idx ON ladder_rankings_mv (category, rank_month) WHERE rank_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_all_idx   ON ladder_rankings_mv (category, rank_all_time);

-- Refresh the MV right now so the rank changes land immediately.
REFRESH MATERIALIZED VIEW public.ladder_rankings_mv;
