-- Creators can UPDATE their own projects (name · description · urls · images
-- · tech_layers · updated_at). Everything league-state (scores · grade ·
-- status · LH · graduation flags) is reset back to OLD by a BEFORE UPDATE
-- trigger so the owner can't self-graduate or fake metrics.

drop policy if exists "Creators can update own projects" on projects;
create policy "Creators can update own projects"
  on projects for update
  using      (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

create or replace function enforce_project_owner_update_scope()
returns trigger as $$
begin
  -- Service role or unauthenticated system writes (Edge Functions with
  -- SUPABASE_SERVICE_ROLE_KEY) bypass this guard. Only creator updates
  -- from the client fall through.
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Lock the immutables
  new.creator_id        := old.creator_id;
  new.creator_email     := old.creator_email;
  new.season_id         := old.season_id;
  new.season            := old.season;
  new.created_at        := old.created_at;

  -- Lock analysis-owned numeric fields
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

  -- Lock grade + graduation state
  new.creator_grade     := old.creator_grade;
  new.status            := old.status;
  new.graduation_grade  := old.graduation_grade;
  new.graduated_at      := old.graduated_at;
  new.media_published_at := old.media_published_at;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_projects_owner_update on projects;
create trigger on_projects_owner_update
  before update on projects
  for each row execute function enforce_project_owner_update_scope();
