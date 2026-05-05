-- Applaud lifecycle decay · strategy doc §3.6 ②
--
-- Encore is permanent (heirloom serial), but score_community is
-- supposed to be a *live* signal — "this product still has fans
-- watching." A flat COUNT(applauds) doesn't decay, so a project
-- that earned 20 applauds in week 1 keeps that pillar lift forever
-- even if every fan stopped checking in. Strategy doc framing:
-- "박수는 product의 long-term lifeline. 박수 끊기면 점수 자연 감쇠."
--
-- Decay schedule (step function · easy to reason about, easy to tune):
--   ≤ 30 days   → weight 1.00  (active interest)
--   30 – 90 d   → weight 0.50  (still around)
--   > 90 days   → weight 0.25  (faded but not zero — applaud was real)
--
-- Comments stay at flat ×2 — they're substantial enough that decay
-- would feel punitive ("my insightful audit comment from 6 months
-- ago no longer counts?"). Vote forecasts also stay flat (forecast
-- accuracy is locked at season-end, not by decay).
--
-- recalc_pillar_scores fires on every vote/applaud/comment INSERT
-- via existing triggers, so any active project keeps its weighted
-- sum fresh. Projects with zero new activity stay stale until the
-- next analyze-project run — a periodic cron sweep can fully decay
-- them later (deferred per the cron-is-last policy).

CREATE OR REPLACE FUNCTION public.recalc_pillar_scores(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_id   uuid;
  v_score_auto   int;
  v_unique_voters int;
  v_total_votes  int;
  v_forecast     int;
  v_human_comments int;
  v_weighted_applauds numeric;
  v_community    int;
  v_audit_buffer int;
  v_total        int;
BEGIN
  SELECT creator_id, score_auto,
         GREATEST(0, score_total - score_auto - score_forecast - score_community)
    INTO v_creator_id, v_score_auto, v_audit_buffer
    FROM projects
   WHERE id = p_id;

  IF NOT FOUND THEN RETURN; END IF;

  -- Forecast: votes excluding self-vote.
  SELECT COALESCE(COUNT(DISTINCT v.member_id), 0),
         COALESCE(SUM(v.vote_count), 0)
    INTO v_unique_voters, v_total_votes
    FROM votes v
   WHERE v.project_id = p_id
     AND (v_creator_id IS NULL OR v.member_id <> v_creator_id);

  v_forecast := LEAST(30, v_unique_voters * 2 + LEAST(v_total_votes, 30));

  -- Community: human comments (full weight) + product applauds
  -- (time-decayed). Self-actions excluded throughout.
  SELECT COALESCE(COUNT(*), 0)
    INTO v_human_comments
    FROM comments c
   WHERE c.project_id = p_id
     AND c.member_id IS NOT NULL
     AND c.kind = 'human'
     AND (v_creator_id IS NULL OR c.member_id <> v_creator_id);

  -- Applaud weighting: SUM(weight) where weight depends on age. Older
  -- applauds count for less. Coerce to numeric to allow fractional
  -- accumulation, then floor to int when feeding the score formula.
  SELECT COALESCE(SUM(CASE
           WHEN now() - a.created_at <= INTERVAL '30 days' THEN 1.00
           WHEN now() - a.created_at <= INTERVAL '90 days' THEN 0.50
           ELSE                                                  0.25
         END), 0)::numeric
    INTO v_weighted_applauds
    FROM applauds a
   WHERE a.target_type = 'product'
     AND a.target_id = p_id
     AND (v_creator_id IS NULL OR a.member_id <> v_creator_id);

  v_community := LEAST(20, v_human_comments * 2 + FLOOR(v_weighted_applauds)::int);

  -- Total: pillars + preserved audit buffer
  v_total := LEAST(100, GREATEST(0, v_score_auto + v_forecast + v_community + v_audit_buffer));

  PERFORM set_config('app.allow_pillar_update', 'true', true);

  UPDATE projects
     SET score_forecast  = v_forecast,
         score_community = v_community,
         score_total     = v_total
   WHERE id = p_id;

  PERFORM set_config('app.allow_pillar_update', 'false', true);
END;
$$;

-- Backfill · re-run recalc for every active project so the new
-- decayed formula lands immediately, not on next vote/applaud.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM projects
     WHERE status IN ('active', 'graduated', 'valedictorian')
  LOOP
    PERFORM recalc_pillar_scores(r.id);
  END LOOP;
END $$;
