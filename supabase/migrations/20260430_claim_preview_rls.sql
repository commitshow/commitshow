-- /submit "claim CLI preview" flow was broken by missing RLS coverage.
--
-- Symptom: User finishes brief extraction, clicks USE THIS BRIEF · RUN
-- ANALYSIS, briefly sees step 3, then gets bounced back to step 2 with
-- error: "Failed to claim preview project: Cannot coerce the result to a
-- single JSON object".
--
-- Root cause: The only RLS UPDATE policy on projects required
--   auth.uid() = creator_id
-- CLI walk-on rows have creator_id = NULL (anonymous audit). When an
-- authenticated user tried to UPDATE-claim such a row, the policy USING
-- clause evaluated false → 0 rows updated → PostgREST .select('id').single()
-- threw the coerce error → SubmitForm caught it and setStep(2), which
-- remounted BriefExtraction back to phase='intro'.
--
-- Fix: New RLS UPDATE policy permits an authenticated user to claim ANY
-- preview row whose creator_id is still NULL. WITH CHECK still pins the
-- post-update creator_id to auth.uid(), so a user can't reassign someone
-- else's claim.
--
-- The .single() chain in SubmitForm.tsx was also dropped as a defense in
-- depth fix · the project id is already known from resolvePreviewClaim,
-- so we don't need PostgREST to round-trip it back.

DROP POLICY IF EXISTS "Authenticated can claim preview projects" ON projects;
CREATE POLICY "Authenticated can claim preview projects" ON projects
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = creator_id
    OR (creator_id IS NULL AND status = 'preview')
  )
  WITH CHECK (auth.uid() = creator_id);
