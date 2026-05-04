-- Add comments_authored column to member_stats so ScoutsPage can
-- filter members with no scout activity (no votes / applauds /
-- comments) out of the leaderboard. CreatorsPage filters via
-- creator_stats.product_count > 0 separately (already in view).
--
-- Counts only kind='human' comments — system-generated rows
-- (registered · score_jump events) shouldn't qualify someone as an
-- active scout.

CREATE OR REPLACE VIEW public.member_stats AS
SELECT
  m.id,
  m.display_name,
  m.avatar_url,
  m.tier,
  m.activity_points,
  m.monthly_votes_used,
  m.votes_reset_at,
  m.creator_grade,
  m.total_graduated,
  m.avg_auto_score,
  m.created_at,
  m.updated_at,
  m.grade_recalc_at,
  m.preferred_stack,
  count(DISTINCT p.id) AS total_projects,
  count(DISTINCT p.id) FILTER (WHERE (p.status = ANY (ARRAY['graduated'::text, 'valedictorian'::text]))) AS graduated_count,
  count(DISTINCT v.id) AS total_votes_cast,
  count(DISTINCT ap.id) AS total_applauds_given,
  monthly_vote_cap(m.tier) AS monthly_vote_cap,
  GREATEST(0, (monthly_vote_cap(m.tier) - m.monthly_votes_used)) AS monthly_votes_remaining,
  count(DISTINCT c.id) AS comments_authored
FROM members m
  LEFT JOIN projects p  ON p.creator_id = m.id
  LEFT JOIN votes v     ON v.member_id  = m.id
  LEFT JOIN applauds ap ON ap.member_id = m.id
  LEFT JOIN comments c  ON c.member_id  = m.id AND c.kind = 'human'
GROUP BY m.id;

GRANT SELECT ON public.member_stats TO anon, authenticated;
