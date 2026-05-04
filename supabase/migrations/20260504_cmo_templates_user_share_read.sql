-- cmo_templates · let user_share rows be readable by everyone (signed-in
-- AND anonymous), while keeping marketing rows admin-only.
--
-- Why: ProjectDetailPage's "Share on X" button (and ProfilePage's Early
-- Spotter share) needs to fetch the user_share copy template at click
-- time. The original 20260504_cmo_templates_drafts policy locked SELECT
-- to admins-only, so non-admin creators clicking Share got 0 rows back
-- and the share helper silently failed.
--
-- Marketing rows stay admin-read because they're internal copy strategy
-- and not yet finalized for public consumption. Write policies are
-- untouched (admins-only on both audiences).

DROP POLICY IF EXISTS "admins read cmo_templates"                   ON public.cmo_templates;
DROP POLICY IF EXISTS "read cmo_templates · public user_share + admin all" ON public.cmo_templates;

CREATE POLICY "read cmo_templates · public user_share + admin all"
  ON public.cmo_templates FOR SELECT
  USING (
    audience = 'user_share'
    OR EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND is_admin)
  );
