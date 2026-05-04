-- creator_stats · denormalized view for the /creators leaderboard.
--
-- Why a view: members has total_graduated / avg_auto_score columns,
-- but those depend on the season-end grade-recalc that doesn't run
-- anymore (Encore replaced graduation · 2026-05-05 rebrand). The
-- columns hover at 0 for everyone, so sorting by them produces
-- arbitrary ordering ('han seok kim' bug from launch). Recomputing
-- live off projects gives the leaderboard meaningful order.
--
-- Composite creator_score column = weighted blend so "actually
-- shipping products with high scores AND iterating on them" wins.
-- Weights chosen so a single Encore (50) is worth ~5 audited
-- products without Encore (10 each), and audit iteration matters
-- (2/audit). Tunable: re-CREATE the view to rebalance.

CREATE OR REPLACE VIEW public.creator_stats AS
SELECT
  m.id,
  m.display_name,
  m.avatar_url,
  m.tier,
  m.creator_grade,
  m.x_handle,
  m.github_handle,
  m.created_at,
  m.activity_points,
  m.preferred_stack,
  m.updated_at,
  m.grade_recalc_at,
  COALESCE(p.product_count, 0)              AS product_count,
  COALESCE(p.encore_count,  0)              AS encore_count,
  p.best_score                              AS best_score,
  COALESCE(p.avg_score, 0)                  AS avg_score,
  COALESCE(p.total_audits, 0)               AS total_audits,
  COALESCE(p.product_count, 0)            * 10
  + COALESCE(p.encore_count, 0)           * 50
  + COALESCE(p.best_score, 0)             *  1
  + COALESCE(p.total_audits, 0)           *  2
  + ROUND(COALESCE(p.avg_score, 0)::numeric * 0.3)::int   AS creator_score
FROM public.members m
LEFT JOIN LATERAL (
  SELECT
    count(*)                                                AS product_count,
    count(*) FILTER (WHERE score_total >= 84)               AS encore_count,
    max(score_total)                                        AS best_score,
    avg(score_total) FILTER (WHERE score_total IS NOT NULL) AS avg_score,
    sum(audit_count)                                        AS total_audits
  FROM public.projects
  WHERE creator_id = m.id
    AND status IN ('active','graduated','valedictorian')
) p ON true;

GRANT SELECT ON public.creator_stats TO anon, authenticated;
