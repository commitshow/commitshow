-- ════════════════════════════════════════════════════════════════════════════
-- 20260425_library_v2_ui.sql
--
-- PRD v2 · P9b · Library Intent-first axis (CLAUDE.md §15 · 2026-04-24).
--
-- Adds the `intent` column that drives the new primary navigation
-- (Build a feature · Connect a service · Tune your coding AI · Start a project)
-- and backfills existing rows via a format → intent heuristic so the UI
-- never sees NULL once the migration runs.
--
-- Non-destructive. Safe to re-run. md_library_feed picks up the new column
-- for free via its `ml.*` projection — no view recreation required.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. intent column · backfill · constraints
-- ──────────────────────────────────────────────────────────────────────────
alter table md_library
  add column if not exists intent text;

-- Format → intent heuristic. Each artifact format has an unambiguous dominant
-- intent in the majority of real-world cases; the UI lets Creators reclassify
-- explicitly from the publish dialog if the default misses their framing.
update md_library
   set intent = case target_format
     when 'mcp_config'    then 'connect_service'
     when 'ide_rules'     then 'tune_ai'
     when 'agent_skill'   then 'tune_ai'
     when 'project_rules' then 'tune_ai'
     when 'prompt_pack'   then 'tune_ai'
     when 'patch_recipe'  then 'build_feature'
     when 'scaffold'      then 'start_project'
     else                      'build_feature'
   end
 where intent is null;

-- Enum check + default for new rows.
alter table md_library
  drop constraint if exists md_library_intent_check;
alter table md_library
  add  constraint md_library_intent_check
  check (intent in ('build_feature', 'connect_service', 'tune_ai', 'start_project'));

alter table md_library
  alter column intent set default 'build_feature';

-- NOT NULL only after backfill is known to be complete.
alter table md_library
  alter column intent set not null;

-- Filter index · used by the Intent chip strip on LibraryPage.
create index if not exists idx_md_library_intent on md_library(intent);

comment on column md_library.intent is
  'v2 Library primary axis (§15.1) · build_feature | connect_service | tune_ai | start_project';

commit;
