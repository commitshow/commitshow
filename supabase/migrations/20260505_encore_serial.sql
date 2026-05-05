-- Encore registry · permanent serial-numbered trophy.
--
-- Per plan v1.2 §2.3: each Encore earned by a product gets a
-- monotonic serial (#1, #2, … #N) that never recycles. Drives the
-- "early adopter heritage" moat — a copycat site can never have a
-- #1 issued in 2026, only commit.show can. The sequence is per
-- Encore *kind* so future tracks (streak / climb / production /
-- spotlight per the 4-track plan) can expand here without
-- renumbering existing rows.
--
-- Phase 1 only emits 'production' kind (= score >= 85). Other
-- kinds are reserved column values; we'll wire their gates later.

-- 1. Per-kind sequences. Adding a new kind = create new sequence
--    and update the trigger's case branch.
CREATE SEQUENCE IF NOT EXISTS encore_production_seq  START 1 MINVALUE 1;
CREATE SEQUENCE IF NOT EXISTS encore_streak_seq      START 1 MINVALUE 1;
CREATE SEQUENCE IF NOT EXISTS encore_climb_seq       START 1 MINVALUE 1;
CREATE SEQUENCE IF NOT EXISTS encore_spotlight_seq   START 1 MINVALUE 1;

-- 2. Registry table · one row per (project, kind). UNIQUE prevents
--    re-issuing if a project's score dips below 85 then climbs back.
CREATE TABLE IF NOT EXISTS public.encores (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind          text          NOT NULL CHECK (kind IN ('production', 'streak', 'climb', 'spotlight')),
  serial        int           NOT NULL,
  earned_at     timestamptz   NOT NULL DEFAULT now(),
  earned_score  int           NOT NULL,
  earned_meta   jsonb,
  UNIQUE (project_id, kind),
  UNIQUE (kind, serial)
);

CREATE INDEX IF NOT EXISTS idx_encores_project_id ON public.encores(project_id);
CREATE INDEX IF NOT EXISTS idx_encores_kind_earned ON public.encores(kind, earned_at DESC);

ALTER TABLE public.encores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS encores_public_read ON public.encores;
CREATE POLICY encores_public_read ON public.encores FOR SELECT USING (true);
GRANT SELECT ON public.encores TO anon, authenticated;

-- 3. Helper · pick the next serial for a kind, atomic via sequence.
CREATE OR REPLACE FUNCTION public.next_encore_serial(p_kind text)
RETURNS int
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN nextval(
    CASE p_kind
      WHEN 'production' THEN 'encore_production_seq'
      WHEN 'streak'     THEN 'encore_streak_seq'
      WHEN 'climb'      THEN 'encore_climb_seq'
      WHEN 'spotlight'  THEN 'encore_spotlight_seq'
      ELSE 'encore_production_seq'
    END::regclass
  )::int;
END;
$$;

-- 4. Trigger · fires on projects UPDATE when score_total crosses
--    the Encore threshold (85). Idempotent: ON CONFLICT DO NOTHING
--    means a project that drops then climbs back keeps its original
--    serial (the moment it first crossed). Score must move FROM
--    below 85 TO 85+ in this UPDATE.
CREATE OR REPLACE FUNCTION public.maybe_issue_encore()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_serial int;
BEGIN
  IF (NEW.score_total IS NOT NULL AND NEW.score_total >= 85)
     AND (OLD.score_total IS NULL OR OLD.score_total < 85)
     AND (NEW.status IN ('active', 'graduated', 'valedictorian')) THEN
    v_serial := next_encore_serial('production');
    INSERT INTO encores (project_id, kind, serial, earned_score)
    VALUES (NEW.id, 'production', v_serial, NEW.score_total)
    ON CONFLICT (project_id, kind) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maybe_issue_encore ON public.projects;
CREATE TRIGGER trg_maybe_issue_encore
  AFTER UPDATE OF score_total ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION maybe_issue_encore();

-- 5. Backfill · pick up any existing rows already at 85+ at migration time.
DO $$
DECLARE
  r record;
  v_serial int;
BEGIN
  FOR r IN
    SELECT id, score_total FROM projects
     WHERE score_total >= 85
       AND status IN ('active', 'graduated', 'valedictorian')
       AND id NOT IN (SELECT project_id FROM encores WHERE kind = 'production')
     ORDER BY created_at ASC
  LOOP
    v_serial := next_encore_serial('production');
    INSERT INTO encores (project_id, kind, serial, earned_score)
    VALUES (r.id, 'production', v_serial, r.score_total)
    ON CONFLICT (project_id, kind) DO NOTHING;
  END LOOP;
END $$;
