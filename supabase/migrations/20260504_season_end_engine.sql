-- Season-end engine (P8). Wires the existing pieces (advance_season_status,
-- evaluate_votes_for_season, recalculate_creator_grade, season_standings view)
-- together with the missing step: actually committing graduation tiers to
-- projects + populating hall_of_fame, then runs the whole thing daily via
-- pg_cron.
--
-- Idempotent — close_season is safe to re-run; it skips projects that
-- already have graduation_grade set. close_due_seasons skips seasons whose
-- projects are all already graded.
--
-- Tier assignment delegates to season_standings.projected_tier (which
-- already encodes §6.2 percentiles: 1 valedictorian + ~5% honors + ~14.5%
-- graduate + ~80% rookie_circle). §6.3 qualifications (live URL OK +
-- snapshots ≥ 2 + brief present) demote to rookie_circle when missing.

CREATE OR REPLACE FUNCTION public.close_season(p_season_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated  int;
  v_hof      int;
  v_creators int;
  v_summary  jsonb;
BEGIN
  -- 1. Commit graduation tiers to projects · idempotent on graduation_grade.
  --    Qualification filter (§6.3): missing live URL / fewer than 2
  --    snapshots / no Build Brief → forced rookie_circle even if rank
  --    would otherwise have qualified.
  WITH eligible AS (
    SELECT
      ss.project_id,
      ss.creator_id,
      CASE
        WHEN ss.live_url_ok AND ss.snapshots_ok AND ss.brief_ok
          THEN ss.projected_tier
        ELSE 'rookie_circle'
      END AS final_tier
    FROM season_standings ss
    WHERE ss.season_id = p_season_id
  ),
  applied AS (
    UPDATE projects p
       SET graduation_grade = e.final_tier,
           graduated_at     = now(),
           status           = CASE
             WHEN e.final_tier IN ('valedictorian', 'honors', 'graduate')
               THEN 'graduated'
             ELSE 'rookie_circle'
           END
      FROM eligible e
     WHERE p.id = e.project_id
       AND p.graduation_grade IS NULL
    RETURNING p.id
  )
  SELECT count(*) INTO v_updated FROM applied;

  -- 2. Hall of Fame · only the three graduating tiers. ON CONFLICT skip
  --    so a re-run doesn't double-insert. Uses the FROZEN scores at the
  --    moment of close (denormalized into hall_of_fame so the row
  --    remains accurate even if a project's score later changes).
  WITH inserted AS (
    INSERT INTO hall_of_fame (
      project_id, member_id, season_id, grade,
      score_final, score_auto, score_forecast, score_community
    )
    SELECT p.id, p.creator_id, p_season_id, p.graduation_grade,
           p.score_total, p.score_auto, p.score_forecast, p.score_community
      FROM projects p
     WHERE p.season_id = p_season_id
       AND p.graduation_grade IN ('valedictorian', 'honors', 'graduate')
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_hof FROM inserted;

  -- 3. Forecast accuracy · stamps votes.is_correct + recomputes member
  --    accuracy. Helper already exists; this is a safe no-op when no
  --    new votes need evaluating.
  PERFORM evaluate_votes_for_season(p_season_id);

  -- 4. Re-grade every creator who had a project in this season. Their
  --    grade depends on count of graduated projects + average score, so
  --    the close changes that input.
  WITH affected AS (
    SELECT DISTINCT creator_id
      FROM projects
     WHERE season_id = p_season_id
       AND creator_id IS NOT NULL
  )
  SELECT count(*) INTO v_creators FROM affected;

  PERFORM recalculate_creator_grade(creator_id)
    FROM (
      SELECT DISTINCT creator_id
        FROM projects
       WHERE season_id = p_season_id
         AND creator_id IS NOT NULL
    ) sub;

  -- 5. Summary jsonb · returned to caller / surfaced in cron logs.
  SELECT jsonb_build_object(
    'season_id',          p_season_id,
    'projects_graded',    v_updated,
    'hall_of_fame_added', v_hof,
    'creators_recalced',  v_creators,
    'tier_counts',        jsonb_build_object(
      'valedictorian',  (SELECT count(*) FROM projects WHERE season_id = p_season_id AND graduation_grade = 'valedictorian'),
      'honors',         (SELECT count(*) FROM projects WHERE season_id = p_season_id AND graduation_grade = 'honors'),
      'graduate',       (SELECT count(*) FROM projects WHERE season_id = p_season_id AND graduation_grade = 'graduate'),
      'rookie_circle',  (SELECT count(*) FROM projects WHERE season_id = p_season_id AND graduation_grade = 'rookie_circle')
    ),
    'closed_at',          now()
  ) INTO v_summary;

  RETURN v_summary;
END;
$$;

-- Wrapper · advances status state machine, then closes any season that
-- has reached `applaud` / `completed` and hasn't yet been graded.
-- Returns array of summaries (one per closed season).
CREATE OR REPLACE FUNCTION public.close_due_seasons()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  r         record;
BEGIN
  -- Step 1 · advance upcoming → active → applaud → completed based on dates.
  PERFORM advance_season_status();

  -- Step 2 · close any season in applaud or completed that still has
  -- ungraded projects. Idempotent: a season fully graded won't re-enter.
  FOR r IN
    SELECT s.id
      FROM seasons s
     WHERE s.status IN ('applaud', 'completed')
       AND EXISTS (
         SELECT 1 FROM projects p
          WHERE p.season_id = s.id
            AND p.graduation_grade IS NULL
       )
  LOOP
    v_results := v_results || close_season(r.id);
  END LOOP;

  RETURN v_results;
END;
$$;

-- Schedule · runs daily at 00:05 UTC. Five-minute offset from midnight
-- keeps the run window clear of the streak compute (02:00) and the
-- ladder refresh (every 5 min). Re-creating it is safe — pg_cron's
-- cron.schedule de-duplicates by jobname.
SELECT cron.schedule(
  'close-due-seasons',
  '5 0 * * *',
  $cron$ SELECT public.close_due_seasons() $cron$
);
