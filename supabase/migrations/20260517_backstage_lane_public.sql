-- Backstage lane · public-read for polished + iterating projects
--
-- §1-A ⑥ stage metaphor surfaced on /products. Previously NEW AUDITS
-- lane filtered status='active' newest-14d — a slice of projects that
-- already sat on the body ladder, so the lane re-showed projects users
-- could already find below. Replacing it with a BACKSTAGE lane gives
-- /products a new population (projects mid-iteration, not yet auditioned)
-- and visually completes the journey:
--
--     BACKSTAGE  →  ON STAGE  →  ENCORE
--     iterating     active        score 84+
--
-- Eligibility (creator's implicit "ready to be seen" signal · all 4
-- must hold):
--   1. status = 'backstage'         · audit done, not yet auditioned
--   2. audit_count >= 2             · creator re-audited at least once
--                                     (proves iteration commitment vs.
--                                     drive-by single audit)
--   3. thumbnail_url IS NOT NULL    · visual identity registered
--   4. length(description) > 30     · real description, not placeholder
--
-- Privacy contract: backstage rows are owner-private by default
-- (20260511_backstage_status.sql). This migration adds a THIRD public
-- SELECT policy that OR-overrides the default for rows meeting all 4
-- gates. BackstagePolishGate.tsx surfaces the gate criteria to the
-- creator before they fill the fields, so dressing the project ↔
-- appearing on the public lane is a single informed action.

CREATE POLICY "Public reads polished backstage projects"
  ON public.projects
  FOR SELECT
  USING (
    status = 'backstage'
    AND audit_count >= 2
    AND thumbnail_url IS NOT NULL
    AND length(coalesce(description, '')) > 30
  );

-- Index supporting the BACKSTAGE lane query: status='backstage' rows
-- meeting the polish gate, sorted by recent re-audit. Partial index
-- keeps it tiny — only ~0.5% of projects will match these 4 gates at
-- any time. Order desc on last_analysis_at matches the lane's "fresh
-- re-audits first" sort.
CREATE INDEX IF NOT EXISTS idx_projects_backstage_lane
  ON public.projects (last_analysis_at DESC)
  WHERE status = 'backstage'
    AND audit_count >= 2
    AND thumbnail_url IS NOT NULL;
-- description length predicate not in WHERE — Postgres rejects
-- non-IMMUTABLE expressions on partial indexes and length() on text
-- depends on collation. The 3-of-4 partial index plus the runtime
-- length filter still narrows the scan dramatically (the polish gate
-- is the rare condition; description ≥ 30 then filters at most a few
-- dozen rows).
