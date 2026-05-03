-- members table uses column-level GRANT SELECT (originally established by
-- 20260425140000_email_column_grants.sql to keep email private). Several
-- columns added by later migrations were never granted, so PostgREST
-- returned 42501 'permission denied for table members' for any client
-- query that included them. The auth context, scout leaderboard, and
-- profile pages were silently degrading on every request because
-- src/lib/supabase.ts PUBLIC_MEMBER_COLUMNS lists these columns as part
-- of the intended public projection.
--
-- Same class of bug as 20260430_ladder_column_grants.sql and
-- 20260503_paid_audits_credit_grant.sql.
--
-- Discovered while debugging the Stripe payment polling 'finalizing'
-- infinite loop on 2026-05-03. Audit hardening for this class of bug
-- lives in supabase/functions/analyze-project (vibe_concerns
-- column_grant_mismatch).

GRANT SELECT (
  x_handle,
  x_provider_id,
  x_connected_at,
  github_handle,
  github_provider_id,
  github_connected_at,
  forecast_accuracy,
  forecast_correct_count,
  forecast_evaluated_count
) ON public.members TO anon, authenticated;
