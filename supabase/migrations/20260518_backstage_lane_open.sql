-- Backstage public-read · drop the polish gate (2026-05-18)
--
-- 2026-05-17 migration ("Public reads polished backstage projects")
-- required audit_count >= 2 + thumbnail_url + length(description) > 30
-- before a backstage row escaped the owner-private cage. CEO 피드백
-- (2026-05-18) · this was too strict. Stage definitions are:
--
--   BACKSTAGE — analysis ran · publicly listed (anonymously) · creator
--               name + score band + project details hidden in the UI ·
--               default curtain thumbnail when none set
--   ON STAGE  — auditioned · creator + details + feedback visible
--   ENCORE    — on stage + crossed the score threshold
--
-- Privacy at backstage now happens at the UI layer, not RLS. Every
-- backstage row is publicly readable so the /products lane can list
-- it; the cards + detail page hide creator/score/details for
-- non-owners.
--
-- Owner-read policy (20260511_backstage_status.sql) and the global
-- "non-backstage public" policy are unchanged; this swaps only the
-- gated public-read added on 2026-05-17.

DROP POLICY IF EXISTS "Public reads polished backstage projects" ON public.projects;

CREATE POLICY "Public reads backstage projects"
  ON public.projects
  FOR SELECT
  USING (status = 'backstage');

-- Old polish-gate partial index targets predicates we no longer rely
-- on. Drop the gated index and add a simpler one keyed off the
-- listing sort column (last_analysis_at desc).
DROP INDEX IF EXISTS public.idx_projects_backstage_lane;
CREATE INDEX IF NOT EXISTS idx_projects_backstage_public
  ON public.projects (last_analysis_at DESC)
  WHERE status = 'backstage';
