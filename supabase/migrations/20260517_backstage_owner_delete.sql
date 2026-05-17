-- Creators can DELETE their own backstage projects.
--
-- Before this migration the projects table had no DELETE policy at all
-- (only SELECT + UPDATE). deleteProject() in src/lib/projectQueries.ts
-- silently no-op'd against RLS for authenticated callers, so members
-- had no way to clear stuck / duplicate backstage rows. The audit-then-
-- audition split (20260511) and the rare resolvePreviewClaim race
-- before its backstage guard (also 2026-05-17) left some accounts
-- with multiple status='backstage' rows for the same repo · the
-- Remove button on /backstage needed this policy to actually work.
--
-- Scope: backstage only. status='active' / 'graduated' / 'valedictorian'
-- rows carry season standing, scout votes, applauds, audit snapshots,
-- and ladder rank · letting an owner delete those would orphan all of
-- it. Anyone needing to remove a stage-or-later row goes through
-- support so the cascade is reviewed.
--
-- creator_id = auth.uid() is enforced in the USING clause · service_role
-- bypasses RLS so analyze-project / cron / migration scripts continue
-- to operate on any row regardless of stage.

DROP POLICY IF EXISTS "Owners delete own backstage projects" ON public.projects;
CREATE POLICY "Owners delete own backstage projects"
  ON public.projects
  FOR DELETE
  USING (
    auth.uid() = creator_id
    AND status = 'backstage'
  );
