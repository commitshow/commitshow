-- 4-track Encore · streak / climb / spotlight gates (B-1 follow-up).
--
-- 20260505_encore_serial.sql laid the table + sequences for all 4
-- kinds but only wired the 'production' gate (score crosses 85). This
-- migration activates the other 3 tracks. Each gate is conservative —
-- Encore serials are heirloom, better under-issue than over-issue.
--
-- production · score_total crosses 85 (already wired in the prior file)
-- streak     · 4 consecutive snapshots ≥ 75 across any trigger_type
-- climb      · score has improved ≥ 25 points from the first 'initial'
-- spotlight  · 10+ distinct supporters AND avg predicted_score ≥ 75
--
-- Threshold tuning lives in this file — change once + redeploy.
--
-- Trigger placement:
--   - streak/climb hang off projects UPDATE OF score_total (same hook
--     as production · piggyback so we evaluate every score change).
--   - spotlight hangs off supporters AFTER INSERT (community-driven,
--     not score-driven · score gate is enforced inside the function).

-- 1. Streak / Climb evaluator · runs on every score_total change. Does
--    NOT require a "crossing" — a project that's been quietly above
--    the streak floor for weeks should pick up a serial on the next
--    audit even if score didn't move dramatically.
CREATE OR REPLACE FUNCTION public.maybe_issue_streak_climb_encore()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_serial          int;
  v_streak_count    int;
  v_initial_score   int;
  v_max_score       int;
  v_climb_delta     int;
BEGIN
  IF NEW.status NOT IN ('active', 'graduated', 'valedictorian') THEN
    RETURN NEW;
  END IF;

  -- ── streak gate ── 4 most recent snapshots all ≥ 75.
  -- Skipped if the project already has a streak Encore.
  IF NOT EXISTS (SELECT 1 FROM encores WHERE project_id = NEW.id AND kind = 'streak') THEN
    SELECT COUNT(*) INTO v_streak_count
      FROM (
        SELECT score_total
          FROM analysis_snapshots
         WHERE project_id = NEW.id
         ORDER BY created_at DESC
         LIMIT 4
      ) recent
     WHERE recent.score_total >= 75;

    -- Need 4 rows total AND all 4 ≥ 75. The COUNT(*) above only counts
    -- rows that meet the threshold, so 4 = both conditions hold.
    IF v_streak_count = 4 THEN
      v_serial := next_encore_serial('streak');
      INSERT INTO encores (project_id, kind, serial, earned_score, earned_meta)
      VALUES (NEW.id, 'streak', v_serial, NEW.score_total,
              jsonb_build_object('window', '4 snapshots', 'floor', 75))
      ON CONFLICT (project_id, kind) DO NOTHING;
    END IF;
  END IF;

  -- ── climb gate ── ≥ 25 points improvement from first 'initial' snapshot.
  -- Skipped if the project already has a climb Encore.
  IF NOT EXISTS (SELECT 1 FROM encores WHERE project_id = NEW.id AND kind = 'climb') THEN
    SELECT score_total INTO v_initial_score
      FROM analysis_snapshots
     WHERE project_id = NEW.id AND trigger_type = 'initial'
     ORDER BY created_at ASC
     LIMIT 1;

    IF v_initial_score IS NOT NULL THEN
      SELECT MAX(score_total) INTO v_max_score
        FROM analysis_snapshots
       WHERE project_id = NEW.id;
      v_climb_delta := COALESCE(v_max_score, NEW.score_total) - v_initial_score;

      IF v_climb_delta >= 25 THEN
        v_serial := next_encore_serial('climb');
        INSERT INTO encores (project_id, kind, serial, earned_score, earned_meta)
        VALUES (NEW.id, 'climb', v_serial, NEW.score_total,
                jsonb_build_object('initial_score', v_initial_score,
                                   'peak_score',    v_max_score,
                                   'delta',         v_climb_delta))
        ON CONFLICT (project_id, kind) DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maybe_issue_streak_climb ON public.projects;
CREATE TRIGGER trg_maybe_issue_streak_climb
  AFTER UPDATE OF score_total ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION maybe_issue_streak_climb_encore();

-- 2. Spotlight evaluator · fires on every new supporter. Once the
--    threshold is met (10+ supporters w/ avg predicted_score ≥ 75)
--    the project earns a spotlight serial.
CREATE OR REPLACE FUNCTION public.maybe_issue_spotlight_encore()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_serial          int;
  v_supporter_count int;
  v_avg_predicted   numeric;
  v_status          text;
BEGIN
  -- Skip if project already has a spotlight Encore.
  IF EXISTS (SELECT 1 FROM encores WHERE project_id = NEW.project_id AND kind = 'spotlight') THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_status FROM projects WHERE id = NEW.project_id;
  IF v_status NOT IN ('active', 'graduated', 'valedictorian') THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::int INTO v_supporter_count
    FROM supporters
   WHERE project_id = NEW.project_id;

  IF v_supporter_count < 10 THEN
    RETURN NEW;
  END IF;

  SELECT AVG(predicted_score) INTO v_avg_predicted
    FROM votes
   WHERE project_id = NEW.project_id
     AND predicted_score IS NOT NULL;

  IF v_avg_predicted IS NULL OR v_avg_predicted < 75 THEN
    RETURN NEW;
  END IF;

  v_serial := next_encore_serial('spotlight');
  INSERT INTO encores (project_id, kind, serial, earned_score, earned_meta)
  SELECT NEW.project_id, 'spotlight', v_serial,
         COALESCE(p.score_total, 0),
         jsonb_build_object('supporter_count', v_supporter_count,
                            'avg_predicted',   ROUND(v_avg_predicted, 1))
    FROM projects p WHERE p.id = NEW.project_id
  ON CONFLICT (project_id, kind) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maybe_issue_spotlight ON public.supporters;
CREATE TRIGGER trg_maybe_issue_spotlight
  AFTER INSERT ON public.supporters
  FOR EACH ROW
  EXECUTE FUNCTION maybe_issue_spotlight_encore();

-- 3. Backfill · run all 3 gates against existing data so projects
--    that already qualified at migration time get their serials.
DO $$
DECLARE
  r record;
  v_serial int;
  v_streak_count int;
  v_initial_score int;
  v_max_score int;
  v_climb_delta int;
BEGIN
  -- Streak backfill
  FOR r IN
    SELECT p.id, p.score_total
      FROM projects p
     WHERE p.status IN ('active', 'graduated', 'valedictorian')
       AND p.id NOT IN (SELECT project_id FROM encores WHERE kind = 'streak')
     ORDER BY p.created_at ASC
  LOOP
    SELECT COUNT(*) INTO v_streak_count
      FROM (SELECT score_total FROM analysis_snapshots
             WHERE project_id = r.id ORDER BY created_at DESC LIMIT 4) recent
     WHERE recent.score_total >= 75;
    IF v_streak_count = 4 THEN
      v_serial := next_encore_serial('streak');
      INSERT INTO encores (project_id, kind, serial, earned_score, earned_meta)
      VALUES (r.id, 'streak', v_serial, r.score_total,
              jsonb_build_object('window', '4 snapshots', 'floor', 75, 'backfilled', true))
      ON CONFLICT (project_id, kind) DO NOTHING;
    END IF;
  END LOOP;

  -- Climb backfill
  FOR r IN
    SELECT p.id, p.score_total
      FROM projects p
     WHERE p.status IN ('active', 'graduated', 'valedictorian')
       AND p.id NOT IN (SELECT project_id FROM encores WHERE kind = 'climb')
     ORDER BY p.created_at ASC
  LOOP
    SELECT score_total INTO v_initial_score
      FROM analysis_snapshots
     WHERE project_id = r.id AND trigger_type = 'initial'
     ORDER BY created_at ASC LIMIT 1;
    IF v_initial_score IS NULL THEN CONTINUE; END IF;
    SELECT MAX(score_total) INTO v_max_score
      FROM analysis_snapshots WHERE project_id = r.id;
    v_climb_delta := COALESCE(v_max_score, r.score_total) - v_initial_score;
    IF v_climb_delta >= 25 THEN
      v_serial := next_encore_serial('climb');
      INSERT INTO encores (project_id, kind, serial, earned_score, earned_meta)
      VALUES (r.id, 'climb', v_serial, r.score_total,
              jsonb_build_object('initial_score', v_initial_score,
                                 'peak_score',    v_max_score,
                                 'delta',         v_climb_delta,
                                 'backfilled',    true))
      ON CONFLICT (project_id, kind) DO NOTHING;
    END IF;
  END LOOP;

  -- Spotlight backfill
  FOR r IN
    SELECT p.id, p.score_total,
           (SELECT COUNT(*)::int FROM supporters WHERE project_id = p.id) AS sup_count,
           (SELECT AVG(predicted_score) FROM votes WHERE project_id = p.id AND predicted_score IS NOT NULL) AS avg_pred
      FROM projects p
     WHERE p.status IN ('active', 'graduated', 'valedictorian')
       AND p.id NOT IN (SELECT project_id FROM encores WHERE kind = 'spotlight')
     ORDER BY p.created_at ASC
  LOOP
    IF r.sup_count >= 10 AND r.avg_pred IS NOT NULL AND r.avg_pred >= 75 THEN
      v_serial := next_encore_serial('spotlight');
      INSERT INTO encores (project_id, kind, serial, earned_score, earned_meta)
      VALUES (r.id, 'spotlight', v_serial, COALESCE(r.score_total, 0),
              jsonb_build_object('supporter_count', r.sup_count,
                                 'avg_predicted',   ROUND(r.avg_pred, 1),
                                 'backfilled',      true))
      ON CONFLICT (project_id, kind) DO NOTHING;
    END IF;
  END LOOP;
END $$;
