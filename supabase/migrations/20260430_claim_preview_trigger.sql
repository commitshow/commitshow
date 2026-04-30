-- The actual blocker for the /submit claim flow was NOT the RLS policy
-- (added in 20260430_claim_preview_rls.sql) — that was necessary but not
-- sufficient. The BEFORE UPDATE trigger
-- enforce_project_owner_update_scope() was rewriting NEW.creator_id and
-- NEW.status back to OLD.* for non-service-role updates. Even when the
-- client sent creator_id = auth.uid() and status = 'active', the trigger
-- silently restored creator_id = NULL and status = 'preview' before RLS
-- WITH CHECK ran. The check then evaluated auth.uid() = NULL → FALSE →
-- 42501 "new row violates row-level security policy".
--
-- Fix: add a "claim case" carve-out — when OLD is an unowned preview
-- and NEW assigns the row to the authenticated caller as 'active',
-- allow the creator_id / creator_email / status flip. All other
-- immutables stay locked, so non-claim user updates can still only
-- touch description / live_url / images / etc.

CREATE OR REPLACE FUNCTION public.enforce_project_owner_update_scope()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  is_claim boolean;
begin
  -- Service role bypass · Edge Functions writing with SUPABASE_SERVICE_ROLE_KEY
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Claim case · OLD is unowned preview, NEW is the auth'd user taking it.
  is_claim := old.creator_id IS NULL
          AND old.status      = 'preview'
          AND new.creator_id  = auth.uid()
          AND new.status      = 'active';

  if not is_claim then
    new.creator_id    := old.creator_id;
    new.creator_email := old.creator_email;
    new.status        := old.status;
  end if;

  -- Always-locked immutables
  new.season_id         := old.season_id;
  new.season            := old.season;
  new.created_at        := old.created_at;

  -- Analysis-owned (server writes via service_role only)
  new.score_auto        := old.score_auto;
  new.score_forecast    := old.score_forecast;
  new.score_community   := old.score_community;
  new.score_total       := old.score_total;
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
