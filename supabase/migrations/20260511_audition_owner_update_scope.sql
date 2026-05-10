-- Audit-then-audition split · enforce_project_owner_update_scope fix.
--
-- The owner-update-scope trigger was reverting status changes for
-- regular authenticated users — only the original 'claim preview'
-- transition (preview → active by claiming creator) was permitted.
-- That broke the audition flow: audition_project's UPDATE
-- backstage → active fired the BEFORE UPDATE trigger, which
-- restored status to 'backstage', and audition_project returned
-- ok=true while the row never actually flipped.
--
-- Symptom (2026-05-11): users clicking 'AUDITION →' saw the success
-- toast / redirect, but their project stayed backstage and their
-- ticket count stayed the same. Root cause was here, not in the RPC.
--
-- Fix: extend the trigger with a second allowed transition —
-- 'audition' = own row, backstage → active. Same creator, same
-- email, same project; only the visibility flag flips. Other
-- immutable fields (season_id, scores, etc.) stay frozen.

CREATE OR REPLACE FUNCTION public.enforce_project_owner_update_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
declare
  is_claim         boolean;
  is_audition      boolean;
  is_pillar_recalc boolean;
begin
  -- Service role bypass (Edge Function · analyze-project etc.)
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Engagement-pillar recalc bypass (recalc_pillar_scores opts in via GUC)
  is_pillar_recalc := current_setting('app.allow_pillar_update', true) = 'true';

  -- Claim case · OLD row is an unowned CLI preview, NEW row is the
  -- authenticated user taking ownership.
  is_claim := old.creator_id IS NULL
          AND old.status      = 'preview'
          AND new.creator_id  = auth.uid()
          AND new.status      = 'active';

  -- Audition case · owner promotes their own backstage project onto
  -- the league. Creator stays the same · only status flips. Required
  -- for audition_project RPC (audit-then-audition split, 2026-05-11).
  is_audition := old.creator_id = auth.uid()
             AND old.status     = 'backstage'
             AND new.status     = 'active'
             AND new.creator_id = old.creator_id;

  if not is_claim and not is_audition then
    new.creator_id    := old.creator_id;
    new.creator_email := old.creator_email;
    new.status        := old.status;
  end if;

  -- Always-locked immutables
  new.season_id         := old.season_id;
  new.season            := old.season;
  new.created_at        := old.created_at;

  -- Analysis-owned (service_role writes via Edge Function · pillar recalc
  -- writes 3 of these via the GUC-gated path)
  new.score_auto        := old.score_auto;
  if not is_pillar_recalc then
    new.score_forecast    := old.score_forecast;
    new.score_community   := old.score_community;
    new.score_total       := old.score_total;
  end if;
  new.lh_performance    := old.lh_performance;
  new.lh_accessibility  := old.lh_accessibility;
  new.lh_best_practices := old.lh_best_practices;
  new.lh_seo            := old.lh_seo;
  new.github_accessible := old.github_accessible;
  new.unlock_level      := old.unlock_level;
  new.verdict           := old.verdict;
  new.claude_insight    := old.claude_insight;
  new.last_analysis_at  := old.last_analysis_at;

  -- Grade + graduation state
  new.creator_grade     := old.creator_grade;
  new.graduation_grade  := old.graduation_grade;
  new.graduated_at      := old.graduated_at;
  new.media_published_at := old.media_published_at;

  return new;
end;
$$;
