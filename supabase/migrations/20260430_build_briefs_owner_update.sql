-- build_briefs only had a service_role UPDATE policy. SubmitForm uses
-- supabase.from('build_briefs').upsert(..., { onConflict: 'project_id' })
-- which falls through to UPDATE when a row already exists for that
-- project_id. As authenticated, that UPDATE was blocked → 42501.
--
-- Trigger paths:
--   1. Re-submit / re-audit on a project that already has a brief row
--   2. CLI walk-on path that previously produced a brief (future)
--   3. Any flow that calls handleSubmit twice on the same project
--
-- This adds an UPDATE policy that lets the project's current creator
-- update its brief — mirrors the projects-table ownership model.

DROP POLICY IF EXISTS "Creators can update own build_briefs" ON build_briefs;
CREATE POLICY "Creators can update own build_briefs" ON build_briefs
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = build_briefs.project_id
        AND p.creator_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = build_briefs.project_id
        AND p.creator_id = auth.uid()
    )
  );
