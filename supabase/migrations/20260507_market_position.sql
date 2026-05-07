-- Market Position fields on build_briefs · post-audit creator review.
--
-- Adds 3 columns the SubmitForm prefills from audit + Phase 1 signals
-- and the creator confirms / edits before final registration:
--
--   one_liner      · ≤ 200 char value prop · "what this is in one line"
--   business_model · enum-ish text · subscription / freemium / paid /
--                    open_source / ad_supported / marketplace / b2b /
--                    b2c / unknown · free text fallback OK
--   stage          · idea / mvp / live / traction / scaling
--
-- All optional · skip leaves NULL · ProjectDetailPage hides the Market
-- card if all 3 are NULL so old projects don't render an empty stub.

ALTER TABLE public.build_briefs
  ADD COLUMN IF NOT EXISTS one_liner      text,
  ADD COLUMN IF NOT EXISTS business_model text,
  ADD COLUMN IF NOT EXISTS stage          text;

-- Length guards · the form caps these client-side, this is a backend
-- safety net so an admin override / direct SQL can't smuggle a 10KB
-- 'one-liner' into the audit data.
ALTER TABLE public.build_briefs
  DROP CONSTRAINT IF EXISTS build_briefs_one_liner_len,
  ADD  CONSTRAINT       build_briefs_one_liner_len      CHECK (one_liner      IS NULL OR length(one_liner)      <= 240);

ALTER TABLE public.build_briefs
  DROP CONSTRAINT IF EXISTS build_briefs_business_model_len,
  ADD  CONSTRAINT       build_briefs_business_model_len CHECK (business_model IS NULL OR length(business_model) <= 80);

ALTER TABLE public.build_briefs
  DROP CONSTRAINT IF EXISTS build_briefs_stage_len,
  ADD  CONSTRAINT       build_briefs_stage_len          CHECK (stage          IS NULL OR length(stage)          <= 40);

-- Column-level reads/writes for authenticated authors · the rest of
-- build_briefs already grants SELECT/UPDATE per existing policies, so
-- adding columns inherits them. No new policy needed.
GRANT SELECT (one_liner, business_model, stage) ON public.build_briefs TO anon, authenticated;
