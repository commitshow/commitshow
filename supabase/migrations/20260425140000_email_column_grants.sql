-- ════════════════════════════════════════════════════════════════════════════
-- 20260425140000_email_column_grants.sql
--
-- Defense-in-depth for the email-privacy work started by 20260425130000.
-- That earlier migration dropped email from the public views; this one
-- locks the base tables too. After this runs, anon + authenticated roles
-- cannot SELECT email from members or creator_email from projects — any
-- query requesting those columns returns 42501 "permission denied".
--
-- RLS row policies stay as-is (users can still read member rows + project
-- rows); only the column-level grant is tightened. Service role retains
-- full access via its separate grant path.
--
-- IMPORTANT: Client `SELECT *` on members / projects now fails. Every
-- call-site was migrated to explicit column lists in the same commit
-- (PUBLIC_MEMBER_COLUMNS + PUBLIC_PROJECT_COLUMNS in src/lib/supabase.ts).
--
-- Non-destructive · idempotent.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- members · email is now role-inaccessible to anon + authenticated
-- ──────────────────────────────────────────────────────────────────────────
revoke select on public.members from anon, authenticated;

grant select (
  id,
  display_name,
  avatar_url,
  tier,
  activity_points,
  monthly_votes_used,
  votes_reset_at,
  creator_grade,
  total_graduated,
  avg_auto_score,
  preferred_stack,
  created_at,
  updated_at,
  grade_recalc_at
) on public.members to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- projects · creator_email is role-inaccessible to anon + authenticated
-- ──────────────────────────────────────────────────────────────────────────
revoke select on public.projects from anon, authenticated;

grant select (
  id,
  created_at,
  github_url,
  live_url,
  description,
  lh_performance,
  lh_accessibility,
  lh_best_practices,
  lh_seo,
  github_accessible,
  score_auto,
  score_forecast,
  score_community,
  score_total,
  creator_grade,
  verdict,
  claude_insight,
  tech_layers,
  unlock_level,
  status,
  graduation_grade,
  season,
  graduated_at,
  media_published_at,
  creator_id,
  creator_name,
  season_id,
  updated_at,
  project_name,
  last_analysis_at,
  thumbnail_url,
  thumbnail_path,
  images
) on public.projects to anon, authenticated;

commit;
