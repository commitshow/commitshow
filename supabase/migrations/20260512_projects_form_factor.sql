-- projects.form_factor · denormalized from latest analysis_snapshots
--
-- Ladder UI splits by form_factor (app vs library vs scaffold ...) so
-- scores compare within their own rubric. Reading
-- github_signals->>'form_factor' from analysis_snapshots per ladder row
-- would N+1; denormalize onto projects so the existing ladder query
-- pattern stays cheap.
--
-- analyze-project Edge Function will keep this in sync at audit time
-- (set projects.form_factor = NEW snapshot's github_signals.form_factor).
-- One-time backfill below seeds the column from the latest existing
-- snapshot per project.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS form_factor varchar(20);

CREATE INDEX IF NOT EXISTS idx_projects_form_factor
  ON public.projects (form_factor)
  WHERE form_factor IS NOT NULL;

-- Column-level grants · projects uses the column-grant pattern.
GRANT SELECT (form_factor) ON public.projects TO anon;
GRANT SELECT (form_factor) ON public.projects TO authenticated;

-- Backfill · LATERAL pulls the most recent snapshot per project and
-- extracts github_signals.form_factor. Skip rows that already have
-- form_factor set (re-runnable).
UPDATE public.projects p
SET form_factor = sub.ff
FROM (
  SELECT p2.id, latest.github_signals->>'form_factor' AS ff
  FROM projects p2
  CROSS JOIN LATERAL (
    SELECT github_signals
    FROM analysis_snapshots
    WHERE project_id = p2.id
    ORDER BY created_at DESC
    LIMIT 1
  ) latest
) sub
WHERE p.id = sub.id
  AND p.form_factor IS NULL
  AND sub.ff IS NOT NULL;
