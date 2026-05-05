-- Top Spotters · 7-day rolling leaderboard.
-- Strategy doc §4.1 #4.
--
-- The all-time leaderboard at /scouts is great for veterans but
-- shows up as a brick wall for new scouts who joined this week —
-- they can't realistically catch a member with 5,000 AP. The weekly
-- window resets every Monday so a fresh signup's first decisive
-- forecast can land them at the top of a leaderboard the same day.
--
-- Aggregates:
--   votes_last_7d      · COUNT(votes) by member, last 7 days
--   first_spotter_7d   · COUNT(votes WHERE spotter_tier='first')
--   applauds_last_7d   · COUNT(applauds)
--   comments_last_7d   · COUNT(comments WHERE kind='human')
--   week_score         · weighted composite; first-spotter weighs heaviest
--
-- View, not materialized. At current scale the underlying tables
-- are small enough that a fresh SELECT per page load is fine; revisit
-- if vote/applaud volume crosses ~10k/week.

CREATE OR REPLACE VIEW public.top_spotters_week AS
WITH cutoff AS (
  SELECT (now() - INTERVAL '7 days') AS since
),
v AS (
  SELECT v.member_id,
         COUNT(*)::int                                                     AS votes_n,
         COUNT(*) FILTER (WHERE v.spotter_tier = 'first')::int              AS first_n,
         COUNT(*) FILTER (WHERE v.spotter_tier = 'early')::int              AS early_n
    FROM votes v, cutoff
   WHERE v.member_id IS NOT NULL
     AND v.created_at >= cutoff.since
   GROUP BY v.member_id
),
a AS (
  SELECT a.member_id,
         COUNT(*)::int AS applauds_n
    FROM applauds a, cutoff
   WHERE a.created_at >= cutoff.since
   GROUP BY a.member_id
),
c AS (
  SELECT c.member_id,
         COUNT(*)::int AS comments_n
    FROM comments c, cutoff
   WHERE c.member_id IS NOT NULL
     AND c.kind = 'human'
     AND c.created_at >= cutoff.since
   GROUP BY c.member_id
),
combined AS (
  SELECT m.id AS member_id,
         m.display_name,
         m.avatar_url,
         m.tier,
         m.creator_grade,
         COALESCE(v.votes_n,    0) AS votes_n,
         COALESCE(v.first_n,    0) AS first_spotter_n,
         COALESCE(v.early_n,    0) AS early_spotter_n,
         COALESCE(a.applauds_n, 0) AS applauds_n,
         COALESCE(c.comments_n, 0) AS comments_n
    FROM members m
    LEFT JOIN v ON v.member_id = m.id
    LEFT JOIN a ON a.member_id = m.id
    LEFT JOIN c ON c.member_id = m.id
)
SELECT
  member_id,
  display_name,
  avatar_url,
  tier,
  creator_grade,
  votes_n,
  first_spotter_n,
  early_spotter_n,
  applauds_n,
  comments_n,
  -- Week score · heavily favors First Spotter (the heirloom signal),
  -- then forecasts, then applauds + comments. A scout who lands a
  -- single First Spotter beats one who casts 4 plain Spotter votes.
  (first_spotter_n * 10 + early_spotter_n * 4 + (votes_n - first_spotter_n - early_spotter_n) * 2
   + applauds_n * 1 + comments_n * 2) AS week_score
FROM combined
WHERE votes_n + applauds_n + comments_n > 0
ORDER BY week_score DESC;

GRANT SELECT ON public.top_spotters_week TO anon, authenticated;
