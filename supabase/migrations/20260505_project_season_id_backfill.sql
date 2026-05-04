-- Fix `projects.season_id` not being set when an audition lands.
-- Today the audition writes `season = 'season_zero'` (text label) but
-- never the UUID FK `season_id`, so the season-end cron, the
-- `season_standings` view, and `evaluate_votes_for_season` can't see
-- the project. Result: all 6 active projects had season_id NULL.
--
-- Two parts:
-- 1. Backfill existing rows · resolve text label → seasons.id
-- 2. Trigger so future inserts/transitions auto-fill the FK from the
--    text label, falling back to the currently-active season.
--    Walk-on previews (status = 'preview', anonymous CLI audits) stay
--    NULL on purpose — they aren't part of any season.

-- Order matters · the existing `enforce_project_owner_update_scope`
-- trigger force-resets `new.season_id := old.season_id` on any UPDATE
-- (it predates the season-end engine and treated season_id as
-- immutable). Trigger ordering inside Postgres is alphabetical by name,
-- so we install our `trg_fill_project_season_id` AFTER the existing
-- `on_projects_owner_update` and before running the backfill UPDATE.
-- The fill trigger fires second on every row, sees NEW.season_id reset
-- to NULL, and re-applies the correct value. The order:
--   1. Trigger created first
--   2. Backfill UPDATE second (so the trigger fires DURING the
--      backfill and patches the lock that would otherwise null it).

-- 1. Trigger
CREATE OR REPLACE FUNCTION public.fill_project_season_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only auto-fill when the row is moving into / inserted as active
  -- and season_id hasn't been set explicitly. Never override.
  IF NEW.status = 'active' AND NEW.season_id IS NULL THEN
    -- Prefer the explicit text label if the client set one
    IF NEW.season IS NOT NULL THEN
      SELECT id INTO NEW.season_id
        FROM seasons
       WHERE name = NEW.season
       LIMIT 1;
    END IF;
    -- Fallback: currently running season
    IF NEW.season_id IS NULL THEN
      SELECT id INTO NEW.season_id
        FROM seasons
       WHERE status = 'active'
       ORDER BY start_date DESC
       LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_project_season_id ON projects;
CREATE TRIGGER trg_fill_project_season_id
  BEFORE INSERT OR UPDATE OF status, season, season_id
  ON projects
  FOR EACH ROW
  EXECUTE FUNCTION fill_project_season_id();

-- 2. Backfill (now the new trigger is in place to correct the
--    enforce_project_owner_update_scope lock-back).
UPDATE projects p
   SET season_id = s.id
  FROM seasons s
 WHERE p.season    = s.name
   AND p.season_id IS NULL
   AND p.status    = 'active';
