-- commit.show · Supabase Schema (baseline up to PRD v1.8 · 2026-04-21)
-- Idempotent migration: safe to re-run. Handles v0 → v1.8 in place.
--
-- ════════════════════════════════════════════════════════════════════════════
-- PRD v2 users (2026-04-24+):
-- After running this baseline, APPLY EACH FILE in `supabase/migrations/` in
-- lexicographic order. The most important one is:
--   20260424_v2_prd_realignment.sql
-- which swaps applauds → polymorphic target, renames ap_events →
-- activity_point_ledger, and adds the Creator Community tables.
-- See CLAUDE.md §1-A for the v2 deltas this baseline does NOT yet include.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. SEASONS
-- ═══════════════════════════════════════════════════════════════
create table if not exists seasons (
  id                  uuid default gen_random_uuid() primary key,
  name                text not null unique,
  start_date          date not null,
  end_date            date not null,
  applaud_end         date not null,
  graduation_date     date not null,
  status              text default 'upcoming',
  graduation_results  jsonb,
  created_at          timestamptz default now()
);

alter table seasons enable row level security;
drop policy if exists "Anyone can read seasons" on seasons;
create policy "Anyone can read seasons" on seasons for select using (true);
drop policy if exists "Service role can manage seasons" on seasons;
create policy "Service role can manage seasons" on seasons for all using (auth.role() = 'service_role');

insert into seasons (name, start_date, end_date, applaud_end, graduation_date, status)
values ('season_zero', '2026-04-18', '2026-05-08', '2026-05-15', '2026-05-16', 'active')
on conflict (name) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- 2. MEMBERS
-- ═══════════════════════════════════════════════════════════════
create table if not exists members (
  id                  uuid references auth.users(id) on delete cascade primary key,
  email               text not null unique,
  display_name        text,
  avatar_url          text,
  tier                text default 'Bronze',
  activity_points     integer default 0,
  monthly_votes_used  integer default 0,
  votes_reset_at      timestamptz default (date_trunc('month', now()) + interval '1 month'),
  creator_grade       text default 'Rookie',
  total_graduated     integer default 0,
  avg_auto_score      numeric(5,2) default 0,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

alter table members enable row level security;
drop policy if exists "Anyone can read member profiles" on members;
create policy "Anyone can read member profiles" on members for select using (true);
drop policy if exists "Members can update own profile" on members;
create policy "Members can update own profile" on members for update using (auth.uid() = id);
drop policy if exists "Service role can manage members" on members;
create policy "Service role can manage members" on members for all using (auth.role() = 'service_role');

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.members (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create or replace function update_scout_tier()
returns trigger as $$
begin
  new.tier = case
    when new.activity_points >= 5000 then 'Platinum'
    when new.activity_points >= 2000 then 'Gold'
    when new.activity_points >= 500  then 'Silver'
    else 'Bronze'
  end;
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_member_ap_change on members;
create trigger on_member_ap_change
  before update of activity_points on members
  for each row execute function update_scout_tier();

-- ═══════════════════════════════════════════════════════════════
-- 3. PROJECTS — v1 migration + v2 ensure
-- ═══════════════════════════════════════════════════════════════
-- Fresh install path
create table if not exists projects (
  id                  uuid default gen_random_uuid() primary key,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  project_name        text,
  creator_id          uuid,
  creator_name        text,
  creator_email       text,
  season_id           uuid,
  season              text default 'season_zero',
  github_url          text,
  live_url            text,
  description         text,
  lh_performance      integer default 0,
  lh_accessibility    integer default 0,
  lh_best_practices   integer default 0,
  lh_seo              integer default 0,
  github_accessible   boolean default false,
  score_auto          integer default 0,
  score_forecast      integer default 0,
  score_community     integer default 1,
  score_total         integer default 0,
  creator_grade       text default 'Rookie',
  verdict             text,
  claude_insight      text,
  tech_layers         text[],
  unlock_level        integer default 0,
  status              text default 'active',
  graduation_grade    text,
  graduated_at        timestamptz,
  media_published_at  timestamptz
);

-- v1 → v2 column migration (safe re-run)
alter table projects
  add column if not exists project_name     text,
  add column if not exists creator_id       uuid,
  add column if not exists creator_name     text,
  add column if not exists creator_email    text,
  add column if not exists season_id        uuid,
  add column if not exists updated_at       timestamptz default now(),
  add column if not exists last_analysis_at timestamptz;            -- v1.3: resubmit cooldown gate

-- Drop dependent views before altering projects columns
drop view if exists pipeline_health;
drop view if exists member_stats;
drop view if exists project_feed;

-- v1 column migration: v1.name → project_name (project title), v1.email → creator_email
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='projects' and column_name='name') then
    execute 'update projects set project_name = coalesce(project_name, name) where project_name is null';
    execute 'alter table projects drop column name';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='projects' and column_name='email') then
    execute 'update projects set creator_email = coalesce(creator_email, email) where creator_email is null';
    execute 'alter table projects drop column email';
  end if;
end $$;

-- Recover rows previously mis-migrated (v1 name → creator_name)
-- If project_name is null but creator_name looks like a project title, shift it.
update projects
set project_name = creator_name,
    creator_name = null
where project_name is null and creator_name is not null;

-- Foreign keys (added separately to avoid fresh-install ordering issues)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'projects_creator_id_fkey' and table_name = 'projects'
  ) then
    alter table projects
      add constraint projects_creator_id_fkey
      foreign key (creator_id) references members(id) on delete set null;
  end if;
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'projects_season_id_fkey' and table_name = 'projects'
  ) then
    alter table projects
      add constraint projects_season_id_fkey
      foreign key (season_id) references seasons(id);
  end if;
end $$;

-- Backfill season_id for existing projects
update projects p
set season_id = s.id
from seasons s
where s.name = coalesce(p.season, 'season_zero')
  and p.season_id is null;

alter table projects enable row level security;
drop policy if exists "Anyone can insert projects" on projects;
create policy "Anyone can insert projects" on projects for insert with check (true);
drop policy if exists "Anyone can read projects" on projects;
create policy "Anyone can read projects" on projects for select using (true);
drop policy if exists "Service role can update projects" on projects;
create policy "Service role can update projects" on projects for update using (auth.role() = 'service_role');
drop policy if exists "Creators can delete own projects" on projects;
create policy "Creators can delete own projects" on projects for delete using (auth.uid() = creator_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. BUILD BRIEFS
-- ═══════════════════════════════════════════════════════════════
create table if not exists build_briefs (
  id                   uuid default gen_random_uuid() primary key,
  project_id           uuid references projects(id) on delete cascade not null unique,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now(),
  problem              text,
  features             text,
  ai_tools             text,
  target_user          text,
  stack_fingerprint    jsonb,
  failure_log          jsonb,
  decision_archaeology jsonb,
  ai_delegation_map    jsonb,
  live_proof           jsonb,
  next_blocker         text,
  integrity_score      integer default 0,
  phase2_unlocked      boolean default false,
  phase2_unlocked_at   timestamptz
);

alter table build_briefs enable row level security;
drop policy if exists "Anyone can insert build_briefs" on build_briefs;
create policy "Anyone can insert build_briefs" on build_briefs for insert with check (true);
drop policy if exists "Anyone can read build_briefs" on build_briefs;
create policy "Anyone can read build_briefs" on build_briefs for select using (true);
drop policy if exists "Service role can update build_briefs" on build_briefs;
create policy "Service role can update build_briefs" on build_briefs for update using (auth.role() = 'service_role');

-- Migrate v1 brief_* columns from projects (once, only if columns still present)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='projects' and column_name='brief_problem') then
    execute $mig$
      insert into build_briefs (project_id, problem, features, ai_tools, target_user)
      select id, brief_problem, brief_features, brief_tools, brief_target
      from projects
      where (brief_problem is not null or brief_features is not null
             or brief_tools is not null or brief_target is not null)
      on conflict (project_id) do nothing
    $mig$;
  end if;
end $$;

-- Drop v1 brief_* columns after migration
alter table projects
  drop column if exists brief_problem,
  drop column if exists brief_features,
  drop column if exists brief_tools,
  drop column if exists brief_target,
  drop column if exists brief_strategy,
  drop column if exists brief_fix,
  drop column if exists brief_delegation;

-- ═══════════════════════════════════════════════════════════════
-- 5. ANALYSIS SNAPSHOTS (PRD v1.3 · audition loop · time series)
-- ═══════════════════════════════════════════════════════════════
create table if not exists analysis_snapshots (
  id                  uuid default gen_random_uuid() primary key,
  project_id          uuid references projects(id) on delete cascade not null,
  created_at          timestamptz default now(),

  -- trigger context
  trigger_type        text not null check (trigger_type in
                      ('initial','resubmit','applaud','weekly','season_end')),
  triggered_by        uuid references members(id) on delete set null,

  -- scores at this snapshot (full breakdown)
  score_auto          integer default 0,
  score_forecast      integer default 0,
  score_community     integer default 0,
  score_total         integer default 0,

  -- rich payload
  axis_scores         jsonb,        -- from rich_analysis.axis_scores
  lighthouse          jsonb,
  github_signals      jsonb,
  rich_analysis       jsonb,        -- full Claude output (verdict, findings, ...)

  -- delta tracking
  parent_snapshot_id  uuid references analysis_snapshots(id) on delete set null,
  delta_from_parent   jsonb,        -- {axis: signed_int_delta, ...}
  score_total_delta   integer,

  -- immutability proof
  commit_sha          text,         -- HEAD sha at analysis time
  brief_sha           text,         -- .debut/brief.md blob sha (if committed)

  -- model snapshot
  model_version       text default 'claude-sonnet-4-5'
);

alter table analysis_snapshots enable row level security;
drop policy if exists "Anyone can read analysis_snapshots" on analysis_snapshots;
create policy "Anyone can read analysis_snapshots" on analysis_snapshots for select using (true);
drop policy if exists "Service role can manage analysis_snapshots" on analysis_snapshots;
create policy "Service role can manage analysis_snapshots" on analysis_snapshots for all using (auth.role() = 'service_role');

-- Drop legacy analysis_results (was a table in v1.2, is a view in v1.3+).
-- Handle both shapes defensively so the migration is re-runnable.
drop view  if exists analysis_results cascade;
drop table if exists analysis_results cascade;

-- Backward-compat view: legacy callers that read analysis_results see the latest snapshot per project.
create or replace view analysis_results as
  select distinct on (project_id)
    id,
    project_id,
    created_at,
    created_at              as updated_at,
    lighthouse              as lighthouse_json,
    github_signals          as github_json,
    0                       as md_score,
    0                       as security_score,
    0                       as prod_ready_score,
    0                       as unlocked_level,
    rich_analysis           as level_0_data,
    null::jsonb             as level_3_data,
    null::jsonb             as level_5_data,
    null::jsonb             as level_10_data,
    null::jsonb             as level_20_data,
    null::timestamptz       as last_health_check,
    'unknown'::text         as health_status
  from analysis_snapshots
  order by project_id, created_at desc;

-- ═══════════════════════════════════════════════════════════════
-- 6. VOTES
-- ═══════════════════════════════════════════════════════════════
create table if not exists votes (
  id          uuid default gen_random_uuid() primary key,
  created_at  timestamptz default now(),
  project_id  uuid references projects(id) on delete cascade not null,
  member_id   uuid,
  voter_email text,
  vote_count  integer default 1,
  weight      numeric default 1.0,
  scout_tier  text default 'Bronze',
  season_id   uuid,
  season      text default 'season_zero',
  ip_hash     text
);

alter table votes
  add column if not exists member_id uuid,
  add column if not exists season_id uuid,
  add column if not exists ip_hash   text,
  add column if not exists predicted_score integer,   -- v0.5 Forecast: 0–100 projection at graduation
  add column if not exists comment text;              -- optional short rationale

-- One Forecast per Scout per project per season. Legacy anon votes (member_id null) bypass.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'votes_member_project_season_uq' and conrelid = 'votes'::regclass
  ) then
    alter table votes add constraint votes_member_project_season_uq
      unique (member_id, project_id, season_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'votes_member_id_fkey' and table_name = 'votes'
  ) then
    alter table votes
      add constraint votes_member_id_fkey
      foreign key (member_id) references members(id) on delete set null;
  end if;
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'votes_season_id_fkey' and table_name = 'votes'
  ) then
    alter table votes
      add constraint votes_season_id_fkey
      foreign key (season_id) references seasons(id);
  end if;
end $$;

update votes v
set season_id = s.id
from seasons s
where s.name = coalesce(v.season, 'season_zero')
  and v.season_id is null;

alter table votes enable row level security;
drop policy if exists "Anyone can insert votes" on votes;
create policy "Anyone can insert votes" on votes for insert with check (true);
drop policy if exists "Anyone can read votes" on votes;
create policy "Anyone can read votes" on votes for select using (true);

-- ═══════════════════════════════════════════════════════════════
-- 7. APPLAUDS
-- ═══════════════════════════════════════════════════════════════
create table if not exists applauds (
  id                  uuid default gen_random_uuid() primary key,
  created_at          timestamptz default now(),
  project_id          uuid references projects(id) on delete cascade not null,
  member_id           uuid references members(id) on delete set null,
  verified_at         timestamptz,
  verification_method text,
  weight              numeric default 1.0,
  scout_tier          text default 'Bronze',
  -- v1.3: axis-tagged applauds for audition loop
  applauded_axis      text,        -- '인프라' · '코드 실행력' · 'Web3' · 'AI 지휘' · '보안' · '제품 완성도'
  applaud_comment     text,        -- ≤100 chars
  unique (member_id, project_id, applauded_axis)
);

-- v1.3 legacy columns (kept nullable for backward-compat with any early data · unused in v8 Craft Award track).
alter table applauds
  add column if not exists applauded_axis  text,
  add column if not exists applaud_comment text;

-- v1.6.2 (concept v8 restore): Applaud is now a lightweight Craft Award track.
-- Scout casts ONE applaud per season total (pick THE one winner), not one
-- per axis/project. This runs during Day 22-28 Applaud Week (post-season)
-- and does NOT participate in the graduation gates.
alter table applauds
  add column if not exists season_id uuid references seasons(id) on delete set null;

-- Backfill season_id from the project row (one-time · safe if rerun).
update applauds a
   set season_id = p.season_id
  from projects p
 where a.project_id = p.id
   and a.season_id is null;

-- Drop every historical uniqueness rule on applauds then install v8's rule:
-- one applaud per member per season · NULL season allowed for legacy rows.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'applauds_member_id_project_id_key' and conrelid = 'applauds'::regclass
  ) then
    alter table applauds drop constraint applauds_member_id_project_id_key;
  end if;
  if exists (
    select 1 from pg_constraint
    where conname = 'applauds_member_project_axis_uq' and conrelid = 'applauds'::regclass
  ) then
    alter table applauds drop constraint applauds_member_project_axis_uq;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'applauds_member_season_uq' and conrelid = 'applauds'::regclass
  ) then
    alter table applauds add constraint applauds_member_season_uq
      unique (member_id, season_id);
  end if;
end $$;

alter table applauds enable row level security;
drop policy if exists "Anyone can insert applauds" on applauds;
create policy "Anyone can insert applauds" on applauds for insert with check (true);
drop policy if exists "Anyone can read applauds" on applauds;
create policy "Anyone can read applauds" on applauds for select using (true);

-- ═══════════════════════════════════════════════════════════════
-- 8. HALL OF FAME
-- ═══════════════════════════════════════════════════════════════
create table if not exists hall_of_fame (
  id                  uuid default gen_random_uuid() primary key,
  created_at          timestamptz default now(),
  project_id          uuid references projects(id) not null unique,
  member_id           uuid references members(id),
  season_id           uuid references seasons(id),
  grade               text not null,
  score_final         integer not null,
  score_auto          integer,
  score_forecast      integer,
  score_community     integer,
  media_published_at  timestamptz,
  media_url           text,
  media_views         integer default 0,
  badge_url           text,
  nft_token_id        text,
  last_health_check   timestamptz,
  health_status       text default 'healthy',
  badge_active        boolean default true
);

alter table hall_of_fame enable row level security;
drop policy if exists "Anyone can read hall_of_fame" on hall_of_fame;
create policy "Anyone can read hall_of_fame" on hall_of_fame for select using (true);
drop policy if exists "Service role can manage hall_of_fame" on hall_of_fame;
create policy "Service role can manage hall_of_fame" on hall_of_fame for all using (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════
-- 9. MD LIBRARY (PRD v1.2 섹션 7 — V1.5 정식 오픈, 인프라 선행)
-- ═══════════════════════════════════════════════════════════════
create table if not exists md_library (
  id                  uuid default gen_random_uuid() primary key,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),

  creator_id          uuid references members(id) on delete cascade not null,
  linked_project_id   uuid references projects(id) on delete set null,

  title               text not null,
  description         text,
  category            text not null,                   -- CHECK constraint 별도 관리
  tags                text[] default '{}',

  content_md          text,                            -- 인라인 MD (짧은 경우)
  preview             text,                            -- 무료 미리보기 (앞 20%)
  storage_path        text,                            -- Supabase Storage 경로 (대용량)

  -- 가격 체계 (0 = 무료, 그 외 = 유료 최소 $1)
  price_cents         integer default 0,               -- CHECK constraint 별도 관리
  platform_fee_pct    numeric(5,2) default 20.00,

  -- 배지·등급 스냅샷 (트리거가 자동 설정)
  verified_badge      boolean default false,           -- 졸업자 자동
  author_grade        text,                            -- 작성 시점 creator_grade 스냅샷

  -- 집계
  downloads_count     integer default 0,
  purchase_count      integer default 0,
  revenue_cents       bigint default 0,

  -- 공개 제어
  is_public           boolean default true,            -- 낙제 시 false 선택 가능
  status              text default 'draft' check (status in ('draft','published','archived'))
);

-- v1.2: 기존 컬럼에 누락된 것 추가 (재실행 안전)
alter table md_library
  add column if not exists preview       text,
  add column if not exists author_grade  text,
  add column if not exists is_public     boolean default true;

-- v1.5 Artifact Library 확장 (§15.8)
-- Format × Tool 체계 · variable templates · multi-file bundles · stack tags · discovery score snapshot
alter table md_library
  add column if not exists target_format text,              -- enum via CHECK below
  add column if not exists target_tools  jsonb default '[]'::jsonb,    -- ["cursor","windsurf"] etc.
  add column if not exists variables     jsonb default '[]'::jsonb,    -- [{name, default, description}]
  add column if not exists bundle_files  jsonb default '[]'::jsonb,    -- [{path, content_sha, content_md}]
  add column if not exists stack_tags    jsonb default '[]'::jsonb,    -- ["nextjs","supabase","stripe"]
  add column if not exists discovery_total_score integer;  -- snapshot of md_discoveries.total_score at publish

alter table md_library drop constraint if exists md_library_target_format_check;
alter table md_library add constraint md_library_target_format_check
  check (target_format is null or target_format in (
    'mcp_config', 'ide_rules', 'agent_skill', 'project_rules',
    'prompt_pack', 'patch_recipe', 'scaffold'
  ));

-- v1.2: category 7종, 가격 $1 최저 CHECK 제약 (재정의)
alter table md_library drop constraint if exists md_library_category_check;
alter table md_library add constraint md_library_category_check check (category in (
  'Scaffold', 'Prompt Library', 'MCP Config', 'Project Rules', 'Backend', 'Auth/Payment', 'Playbooks'
));

alter table md_library drop constraint if exists md_library_price_check;
alter table md_library add constraint md_library_price_check
  check (price_cents = 0 or price_cents >= 100);

-- is_free 생성 컬럼 (price_cents = 0 자동 계산)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='md_library' and column_name='is_free'
  ) then
    execute 'alter table md_library add column is_free boolean generated always as (price_cents = 0) stored';
  end if;
end $$;

-- 규칙 강제 (v1.5 Free-default 4-tier):
-- Rule A — Rookie는 유료 불가
-- Rule B — Format 별 유료화 허용 여부:
--          허용: mcp_config · ide_rules · agent_skill · project_rules · patch_recipe · scaffold
--          금지: prompt_pack (항상 무료 · 범람 commoditized)
--          target_format NULL 이면 legacy MD · Rookie 규칙만 적용
-- Rule C — Premium tier ($30+) = Maker 이상
-- Rule D — Scaffold tier ($100+) = Architect 이상
-- Rule E — 품질 floor: discovery_total_score < 16 AND price_cents > 0 → 금지
-- Rule F — 졸업자 verified_badge 자동 · INSERT author_grade 스냅샷
create or replace function enforce_md_library_rules()
returns trigger as $$
declare
  v_grade           text;
  v_graduated_count integer;
begin
  select creator_grade, total_graduated
    into v_grade, v_graduated_count
    from members where id = new.creator_id;

  if v_grade is null then
    raise exception 'Creator % not found in members', new.creator_id;
  end if;

  -- A · Rookie는 유료 불가
  if new.price_cents > 0 and v_grade = 'Rookie' then
    raise exception 'Paid listings require Builder grade or higher (current: %). Publish as free to earn AP.', v_grade;
  end if;

  -- B · Format 별 유료화 허용 여부
  if new.price_cents > 0 and new.target_format = 'prompt_pack' then
    raise exception 'Prompt packs must be published free — they are commoditized. Publish as $0.';
  end if;

  -- C · Premium tier ($30+ = 2999 cents) = Maker 이상
  if new.price_cents > 2999 and v_grade not in ('Maker', 'Architect', 'Vibe Engineer', 'Legend') then
    raise exception 'Premium pricing (> $30) requires Maker grade or higher (current: %)', v_grade;
  end if;

  -- D · Scaffold tier ($100+ = 9999 cents) = Architect 이상
  if new.price_cents > 9999 and v_grade not in ('Architect', 'Vibe Engineer', 'Legend') then
    raise exception 'Scaffold pricing (> $100) requires Architect grade or higher (current: %)', v_grade;
  end if;

  -- E · 품질 floor (discovery로 유입된 아티팩트만 적용)
  if new.price_cents > 0
     and new.discovery_total_score is not null
     and new.discovery_total_score < 16 then
    raise exception 'Quality floor not met: discovery score % < 16. Publish as free.', new.discovery_total_score;
  end if;

  -- F · 졸업자 verified_badge 자동 + INSERT author_grade 스냅샷
  new.verified_badge = coalesce(v_graduated_count, 0) > 0;

  if tg_op = 'INSERT' and new.author_grade is null then
    new.author_grade = v_grade;
  end if;

  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_md_library_write on md_library;
create trigger on_md_library_write
  before insert or update on md_library
  for each row execute function enforce_md_library_rules();

-- members.total_graduated 변동 시 기존 MD의 verified_badge 재계산
create or replace function refresh_md_verified_badge()
returns trigger as $$
begin
  if coalesce(new.total_graduated, 0) <> coalesce(old.total_graduated, 0) then
    update md_library
    set verified_badge = (new.total_graduated > 0)
    where creator_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_member_graduation_refresh_md on members;
create trigger on_member_graduation_refresh_md
  after update of total_graduated on members
  for each row execute function refresh_md_verified_badge();

alter table md_library enable row level security;

drop policy if exists "Read published or own MDs" on md_library;
create policy "Read published or own MDs"
  on md_library for select
  using (status = 'published' or auth.uid() = creator_id);

drop policy if exists "Members can insert own MDs" on md_library;
create policy "Members can insert own MDs"
  on md_library for insert
  with check (auth.uid() = creator_id);

drop policy if exists "Members can update own MDs" on md_library;
create policy "Members can update own MDs"
  on md_library for update
  using (auth.uid() = creator_id);

drop policy if exists "Members can delete own MDs" on md_library;
create policy "Members can delete own MDs"
  on md_library for delete
  using (auth.uid() = creator_id);

drop policy if exists "Service role can manage md_library" on md_library;
create policy "Service role can manage md_library"
  on md_library for all
  using (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════
-- 10. MD PURCHASES (PRD v1.2 섹션 7.7)
-- ═══════════════════════════════════════════════════════════════
create table if not exists md_purchases (
  id                  uuid default gen_random_uuid() primary key,
  created_at          timestamptz default now(),

  md_id               uuid references md_library(id) on delete cascade not null,
  buyer_id            uuid references members(id) on delete set null,
  buyer_email         text,

  -- 금액 분배 (cents 단위, 정수 산술)
  amount_paid_cents   integer not null check (amount_paid_cents >= 0),
  author_share_cents  integer not null check (author_share_cents >= 0),    -- 80%
  platform_fee_cents  integer not null check (platform_fee_cents >= 0),    -- 20%

  -- 결제 수단
  payment_type        text not null check (payment_type in ('card', 'usdc')),
  stripe_session_id   text,                            -- Stripe 결제 ID
  tx_hash             text,                            -- USDC 온체인 해시

  refunded_at         timestamptz,
  refund_reason       text
);

alter table md_purchases enable row level security;

drop policy if exists "Buyers can read own purchases" on md_purchases;
create policy "Buyers can read own purchases"
  on md_purchases for select
  using (auth.uid() = buyer_id or
         auth.uid() = (select creator_id from md_library where id = md_purchases.md_id));

drop policy if exists "Service role can manage md_purchases" on md_purchases;
create policy "Service role can manage md_purchases"
  on md_purchases for all
  using (auth.role() = 'service_role');

-- 구매 발생 시 md_library 집계 업데이트 (판매 수·누적 수익)
create or replace function bump_md_library_stats()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update md_library
    set purchase_count = purchase_count + 1,
        revenue_cents  = revenue_cents + new.author_share_cents
    where id = new.md_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_md_purchase_insert on md_purchases;
create trigger on_md_purchase_insert
  after insert on md_purchases
  for each row execute function bump_md_library_stats();

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════
create index if not exists idx_projects_season_id   on projects(season_id);
create index if not exists idx_projects_season      on projects(season);
create index if not exists idx_projects_status      on projects(status);
create index if not exists idx_projects_created     on projects(created_at desc);
create index if not exists idx_projects_creator_id  on projects(creator_id);
create index if not exists idx_votes_project        on votes(project_id);
create index if not exists idx_votes_member         on votes(member_id);
create index if not exists idx_applauds_project     on applauds(project_id);
create index if not exists idx_build_briefs_project on build_briefs(project_id);
create index if not exists idx_snapshots_project    on analysis_snapshots(project_id);
create index if not exists idx_snapshots_proj_time   on analysis_snapshots(project_id, created_at desc);
create index if not exists idx_snapshots_trigger     on analysis_snapshots(trigger_type);
create index if not exists idx_applauds_axis         on applauds(applauded_axis);
create index if not exists idx_hof_season           on hall_of_fame(season_id);
create index if not exists idx_hof_grade            on hall_of_fame(grade);
create index if not exists idx_members_tier         on members(tier);
create index if not exists idx_members_ap           on members(activity_points desc);
create index if not exists idx_md_library_creator   on md_library(creator_id);
create index if not exists idx_md_library_category  on md_library(category);
create index if not exists idx_md_library_status    on md_library(status);
create index if not exists idx_md_library_paid      on md_library((price_cents > 0));
create index if not exists idx_md_library_verified  on md_library(verified_badge) where verified_badge = true;
create index if not exists idx_md_library_free      on md_library(is_free) where is_free = true;
create index if not exists idx_md_library_downloads on md_library(downloads_count desc);
create index if not exists idx_md_purchases_md      on md_purchases(md_id);
create index if not exists idx_md_purchases_buyer   on md_purchases(buyer_id);

-- ═══════════════════════════════════════════════════════════════
-- PROJECT THUMBNAILS — required image per project (v0.5)
-- Stored in `project-thumbnails` public bucket as WebP (client-converted).
-- RLS: creator can only upload to their own folder keyed by auth.uid().
-- ═══════════════════════════════════════════════════════════════
alter table projects
  add column if not exists thumbnail_url  text,
  add column if not exists thumbnail_path text;   -- relative storage path for RLS lookups

-- Storage bucket — idempotent: upsert row so repeat runs are safe.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-thumbnails', 'project-thumbnails', true, 524288,
        array['image/webp'])                    -- 512KB cap, WebP only
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies. We scope writes to `<auth.uid()>/<filename>` paths so one
-- member cannot overwrite another's thumbnails. Reads stay public for the feed.
drop policy if exists "Thumbnails are publicly readable" on storage.objects;
create policy "Thumbnails are publicly readable" on storage.objects
  for select using (bucket_id = 'project-thumbnails');

drop policy if exists "Authenticated members upload own thumbnails" on storage.objects;
create policy "Authenticated members upload own thumbnails" on storage.objects
  for insert with check (
    bucket_id = 'project-thumbnails'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Members update own thumbnails" on storage.objects;
create policy "Members update own thumbnails" on storage.objects
  for update using (
    bucket_id = 'project-thumbnails'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Members delete own thumbnails" on storage.objects;
create policy "Members delete own thumbnails" on storage.objects
  for delete using (
    bucket_id = 'project-thumbnails'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ═══════════════════════════════════════════════════════════════
-- MEMBER AVATARS — profile image (v0.5 community features)
-- Stored in `member-avatars` public bucket as WebP (client-converted).
-- Square 256×256 · 256KB cap.
-- ═══════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-avatars', 'member-avatars', true, 262144,
        array['image/webp'])                   -- 256KB cap, WebP only
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatars are publicly readable" on storage.objects;
create policy "Avatars are publicly readable" on storage.objects
  for select using (bucket_id = 'member-avatars');

drop policy if exists "Members upload own avatar" on storage.objects;
create policy "Members upload own avatar" on storage.objects
  for insert with check (
    bucket_id = 'member-avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Members update own avatar" on storage.objects;
create policy "Members update own avatar" on storage.objects
  for update using (
    bucket_id = 'member-avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Members delete own avatar" on storage.objects;
create policy "Members delete own avatar" on storage.objects
  for delete using (
    bucket_id = 'member-avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ═══════════════════════════════════════════════════════════════
-- MD DISCOVERIES — library-worthy files found during analysis (v1.4 §15.6)
-- Analyzer scans the repo tree, Claude scores each MD on 4 axes,
-- qualifying items land here as SUGGESTED; creator reviews & publishes.
-- ═══════════════════════════════════════════════════════════════
create table if not exists md_discoveries (
  id                     uuid default gen_random_uuid() primary key,
  project_id             uuid references projects(id) on delete cascade not null,
  snapshot_id            uuid references analysis_snapshots(id) on delete set null,
  creator_id             uuid references members(id) on delete set null,
  file_path              text not null,
  sha                    text,                              -- git blob SHA at discovery time
  claude_scores          jsonb not null,                    -- { iter_depth, prod_anchor, token_saving, distilled }
  total_score            integer generated always as (
    coalesce((claude_scores->>'iter_depth')::int, 0) +
    coalesce((claude_scores->>'prod_anchor')::int, 0) +
    coalesce((claude_scores->>'token_saving')::int, 0) +
    coalesce((claude_scores->>'distilled')::int, 0)
  ) stored,
  suggested_category     text check (suggested_category in (
    'Scaffold', 'Prompt Library', 'MCP Config', 'Project Rules',
    'Backend', 'Auth/Payment', 'Playbooks'
  )),
  suggested_title        text,
  suggested_description  text,
  excerpt                text,                              -- first ~500 chars for preview
  status                 text default 'suggested' check (status in ('suggested','dismissed','published')),
  published_md_id        uuid references md_library(id) on delete set null,
  created_at             timestamptz default now(),
  resolved_at            timestamptz,

  unique (project_id, file_path, snapshot_id)
);

create index if not exists idx_discoveries_project   on md_discoveries(project_id, status);
create index if not exists idx_discoveries_creator   on md_discoveries(creator_id, status);
create index if not exists idx_discoveries_snapshot  on md_discoveries(snapshot_id);

alter table md_discoveries enable row level security;
drop policy if exists "Creators read own discoveries" on md_discoveries;
create policy "Creators read own discoveries" on md_discoveries for select using (
  auth.uid() = creator_id
);
drop policy if exists "Creators update own discoveries" on md_discoveries;
create policy "Creators update own discoveries" on md_discoveries for update using (
  auth.uid() = creator_id
);
drop policy if exists "Service role manages discoveries" on md_discoveries;
create policy "Service role manages discoveries" on md_discoveries for all using (auth.role() = 'service_role');

-- v1.5 · md_discoveries format-aware 확장
-- Detected artifact format + target tools at discovery time, variable placeholders
-- scanned from content, and bundle paths for multi-file artifacts (Skills, Recipes).
alter table md_discoveries
  add column if not exists detected_format    text,            -- same enum as md_library.target_format
  add column if not exists detected_tools     jsonb default '[]'::jsonb,
  add column if not exists detected_variables jsonb default '[]'::jsonb,  -- [{name, sample, occurrences}]
  add column if not exists bundle_paths       jsonb default '[]'::jsonb;  -- sibling file paths for multi-file artifacts

alter table md_discoveries drop constraint if exists md_discoveries_detected_format_check;
alter table md_discoveries add constraint md_discoveries_detected_format_check
  check (detected_format is null or detected_format in (
    'mcp_config', 'ide_rules', 'agent_skill', 'project_rules',
    'prompt_pack', 'patch_recipe', 'scaffold'
  ));

create index if not exists idx_discoveries_format on md_discoveries(detected_format) where detected_format is not null;

-- ═══════════════════════════════════════════════════════════════
-- ARTIFACT APPLICATIONS — track when a member applies a library item
-- to one of their projects (v1.5 §15.5 Apply-to-my-repo feedback loop)
-- ═══════════════════════════════════════════════════════════════
create table if not exists artifact_applications (
  id                  uuid default gen_random_uuid() primary key,
  md_id               uuid references md_library(id) on delete cascade not null,
  applied_by          uuid references members(id)  on delete set null,
  applied_to_project  uuid references projects(id) on delete set null,
  github_pr_url       text,                                   -- when created via GitHub App flow
  variable_values     jsonb default '{}'::jsonb,              -- {VAR_NAME: "filled value"}
  created_at          timestamptz default now()
);

create index if not exists idx_artifact_apps_md        on artifact_applications(md_id);
create index if not exists idx_artifact_apps_project   on artifact_applications(applied_to_project);
create index if not exists idx_artifact_apps_applied_by on artifact_applications(applied_by);

alter table artifact_applications enable row level security;

drop policy if exists "Anyone reads artifact applications" on artifact_applications;
create policy "Anyone reads artifact applications"
  on artifact_applications for select using (true);

drop policy if exists "Members log own applications" on artifact_applications;
create policy "Members log own applications"
  on artifact_applications for insert
  with check (auth.uid() = applied_by);

drop policy if exists "Service role manages applications" on artifact_applications;
create policy "Service role manages applications"
  on artifact_applications for all using (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════
-- MEMBERS · preferred_stack override (v1.5 §15.6 Stack combo)
-- NULL = use auto-inferred from projects.tech_layers (view member_stack_auto)
-- ═══════════════════════════════════════════════════════════════
alter table members
  add column if not exists preferred_stack jsonb;

-- ═══════════════════════════════════════════════════════════════
-- SEASON STATE MACHINE — idempotent status advancement (v0.5 §11)
-- Pre-cron: invoked manually or on any write; Phase 2 adds Supabase Cron.
-- Rules (CLAUDE.md §11):
--   upcoming  -> active     when today >= start_date
--   active    -> applaud    when today >  end_date (day 22+)
--   applaud   -> completed  when today >  applaud_end (day 29+)
-- ═══════════════════════════════════════════════════════════════
create or replace function advance_season_status(p_season_id uuid default null)
returns void as $$
declare
  r record;
  v_today date := current_date;
begin
  for r in
    select id, status, start_date, end_date, applaud_end, graduation_date
      from seasons
     where (p_season_id is null or id = p_season_id)
  loop
    if r.status = 'upcoming' and v_today >= r.start_date then
      update seasons set status = 'active' where id = r.id;
    elsif r.status = 'active' and v_today > r.end_date then
      update seasons set status = 'applaud' where id = r.id;
    elsif r.status = 'applaud' and v_today > r.applaud_end then
      update seasons set status = 'completed' where id = r.id;
    end if;
  end loop;
end;
$$ language plpgsql security definer;

-- ═══════════════════════════════════════════════════════════════
-- ACTIVE SCOUT POOL — PRD v1.5.1 §6 denominator for scale-aware
-- graduation · applaud-coverage threshold = max(3, 5% of this count)
--
-- Active scout definition:
--   AP > 0 (min engagement)
--   AND (
--     cast a forecast OR applaud within last 90 days
--     OR tier >= 'Silver' (tenured stays counted)
--   )
-- ═══════════════════════════════════════════════════════════════
drop view if exists active_scout_pool;
create view active_scout_pool as
  select
    m.id,
    m.tier,
    m.activity_points
  from members m
  where m.activity_points > 0
    and (
      m.tier in ('Silver', 'Gold', 'Platinum')
      or exists (select 1 from votes v
                  where v.member_id = m.id
                    and v.created_at >= now() - interval '90 days')
      or exists (select 1 from applauds a
                  where a.member_id = m.id
                    and a.created_at >= now() - interval '90 days')
    );

-- ═══════════════════════════════════════════════════════════════
-- EVALUATE GRADUATION — concept v8 restored · 5-part AND
-- Applaud is a lightweight Craft Award track (post-season), not a
-- graduation gate, so coverage + diversity checks are removed.
-- Returns jsonb with per-criterion pass/fail + reasons. Status is NOT
-- mutated here; the Season-end cron (V1) consumes this to transition
-- projects.status = 'graduated' when all five pass.
-- ═══════════════════════════════════════════════════════════════

-- project_applaud_signals view is no longer consumed by graduation.
-- Keep it for read-only analytics (tier distribution on Craft Award page),
-- rebuilt against the v8 schema.
drop view if exists project_applaud_signals;
create view project_applaud_signals as
  select
    a.project_id,
    count(distinct a.member_id)                                           as unique_scouts,
    coalesce(sum(a.weight), 0)                                            as weighted_sum,
    count(*) filter (where a.scout_tier = 'Bronze')                       as bronze_count,
    count(*) filter (where a.scout_tier = 'Silver')                       as silver_count,
    count(*) filter (where a.scout_tier = 'Gold')                         as gold_count,
    count(*) filter (where a.scout_tier = 'Platinum')                     as platinum_count
  from applauds a
  where a.member_id is not null
  group by a.project_id;

create or replace function evaluate_graduation(p_project_id uuid)
returns jsonb as $$
declare
  v_project          record;
  v_forecast_count   integer;
  v_sustained_days   integer;
  v_health_ok        boolean;
  v_result           jsonb := '{}'::jsonb;
  v_pass_count       integer := 0;
  v_total_conditions constant integer := 5;
begin
  select id, status, score_auto, score_total, creator_id, live_url, github_accessible
    into v_project
    from projects
   where id = p_project_id;

  if v_project.id is null then
    return jsonb_build_object('ok', false, 'error', 'project_not_found');
  end if;

  -- Gate 3: Forecast engagement
  select count(distinct v.member_id) into v_forecast_count
    from votes v
   where v.project_id = p_project_id
     and v.member_id is not null;

  -- Gate 4: Sustained score — ≥ 1 snapshot in last 14 days at score_total ≥ 75
  select count(*) into v_sustained_days
    from analysis_snapshots s
   where s.project_id = p_project_id
     and s.created_at >= now() - interval '14 days'
     and s.score_total >= 75;

  -- Gate 5: Live URL health · heuristic until a dedicated health-check
  -- cron exists. Replaced once health_probes table lands.
  v_health_ok := v_project.live_url is not null and v_project.score_auto >= 5;

  v_result := v_result
    || jsonb_build_object('criteria', jsonb_build_array(
      -- 1
      jsonb_build_object(
        'id',    'score_total',
        'label', 'Overall score ≥ 75',
        'pass',  v_project.score_total >= 75,
        'value', v_project.score_total,
        'target', 75
      ),
      -- 2
      jsonb_build_object(
        'id',    'score_auto',
        'label', 'Automated score ≥ 35 / 50',
        'pass',  v_project.score_auto >= 35,
        'value', v_project.score_auto,
        'target', 35
      ),
      -- 3
      jsonb_build_object(
        'id',    'forecast_count',
        'label', 'Forecast ≥ 3 scouts',
        'pass',  v_forecast_count >= 3,
        'value', v_forecast_count,
        'target', 3
      ),
      -- 4
      jsonb_build_object(
        'id',    'sustained_score',
        'label', 'Score ≥ 75 for last 2 weeks',
        'pass',  v_sustained_days >= 1,
        'snapshots_over_75_last_14d', v_sustained_days,
        'note',  case when v_sustained_days = 0 then 'no qualifying snapshots' else 'sustained' end
      ),
      -- 5
      jsonb_build_object(
        'id',    'health_ok',
        'label', 'Live URL health check',
        'pass',  v_health_ok,
        'note',  case when v_project.live_url is null then 'no live URL' else 'reachable' end
      )
    ));

  if v_project.score_total >= 75 then v_pass_count := v_pass_count + 1; end if;
  if v_project.score_auto  >= 35 then v_pass_count := v_pass_count + 1; end if;
  if v_forecast_count      >= 3  then v_pass_count := v_pass_count + 1; end if;
  if v_sustained_days      >= 1  then v_pass_count := v_pass_count + 1; end if;
  if v_health_ok                 then v_pass_count := v_pass_count + 1; end if;

  return v_result
    || jsonb_build_object(
      'ok',               true,
      'project_id',       p_project_id,
      'pass_count',       v_pass_count,
      'total',            v_total_conditions,
      'graduation_ready', v_pass_count = v_total_conditions
    );
end;
$$ language plpgsql security definer;

-- ═══════════════════════════════════════════════════════════════
-- GRADE HISTORY — audit trail of creator_grade changes (v1.4 §8-A)
-- ═══════════════════════════════════════════════════════════════
create table if not exists members_grade_history (
  id              uuid default gen_random_uuid() primary key,
  member_id       uuid references members(id) on delete cascade not null,
  previous_grade  text,
  new_grade       text not null,
  triggered_by    text not null,        -- 'analysis_snapshot' | 'graduation' | 'manual'
  snapshot_id     uuid references analysis_snapshots(id) on delete set null,
  context         jsonb,                -- inputs used at eval time (graduated count, avg, etc.)
  created_at      timestamptz default now()
);

create index if not exists idx_grade_history_member on members_grade_history(member_id, created_at desc);

alter table members_grade_history enable row level security;
drop policy if exists "Anyone can read grade history" on members_grade_history;
create policy "Anyone can read grade history" on members_grade_history for select using (true);
drop policy if exists "Service role manages grade history" on members_grade_history;
create policy "Service role manages grade history" on members_grade_history for all using (auth.role() = 'service_role');

alter table members
  add column if not exists grade_recalc_at timestamptz;

-- Recompute a creator's grade from live inputs, persist, and log the transition.
-- Grade rules mirror CLAUDE.md §8. MD Library verified contributions count as
-- a tech-diversity substitute for Architect → Vibe Engineer.
create or replace function recalculate_creator_grade(p_creator_id uuid)
returns text as $$
declare
  v_graduated_count    integer;
  v_avg_score          numeric;
  v_tech_diversity     integer;     -- distinct tech_layers across graduated projects
  v_applauds_received  integer;
  v_md_verified        integer;     -- MD Library items with verified_badge
  v_current_grade      text;
  v_new_grade          text;
begin
  if p_creator_id is null then
    return null;
  end if;

  -- Graduated counts + avg score of most recent snapshot per graduated project.
  select
    count(*)                                                          as graduated_count,
    coalesce(avg(p.score_total) filter (where p.status in ('graduated','valedictorian')), 0) as avg_score
  into v_graduated_count, v_avg_score
  from projects p
  where p.creator_id = p_creator_id
    and p.status in ('graduated','valedictorian');

  -- Distinct tech layers across graduated projects.
  select count(distinct layer)
    into v_tech_diversity
    from projects p,
         unnest(p.tech_layers) as layer
   where p.creator_id = p_creator_id
     and p.status in ('graduated','valedictorian');

  -- Applauds received on any project this creator owns.
  select count(*)
    into v_applauds_received
    from applauds a
    join projects p on p.id = a.project_id
   where p.creator_id = p_creator_id;

  -- MD Library verified contributions.
  select count(*)
    into v_md_verified
    from md_library m
   where m.creator_id = p_creator_id
     and m.verified_badge = true
     and m.status = 'published';

  select creator_grade into v_current_grade from members where id = p_creator_id;

  -- Grade rules (CLAUDE.md §8).
  if v_graduated_count >= 10 then
    v_new_grade := 'Legend';
  elsif v_graduated_count >= 5 and v_applauds_received >= 20 and v_avg_score >= 80 then
    v_new_grade := 'Vibe Engineer';
  elsif v_graduated_count >= 3 and v_avg_score >= 75 and (v_tech_diversity >= 3 or v_md_verified >= 2) then
    v_new_grade := 'Architect';
  elsif v_graduated_count >= 2 and v_avg_score >= 70 then
    v_new_grade := 'Maker';
  elsif v_graduated_count >= 1 and v_avg_score >= 60 then
    v_new_grade := 'Builder';
  else
    v_new_grade := 'Rookie';
  end if;

  -- Only update + audit if the grade changed or the denormalized counters drift.
  update members
     set creator_grade    = v_new_grade,
         total_graduated  = v_graduated_count,
         avg_auto_score   = v_avg_score,
         grade_recalc_at  = now()
   where id = p_creator_id
     and (
       creator_grade is distinct from v_new_grade
       or total_graduated is distinct from v_graduated_count
       or round(avg_auto_score, 2) is distinct from round(v_avg_score, 2)
     );

  if v_current_grade is distinct from v_new_grade then
    insert into members_grade_history (member_id, previous_grade, new_grade, triggered_by, context)
    values (p_creator_id, v_current_grade, v_new_grade, 'analysis_snapshot',
      jsonb_build_object(
        'graduated_count', v_graduated_count,
        'avg_score', v_avg_score,
        'tech_diversity', v_tech_diversity,
        'applauds_received', v_applauds_received,
        'md_verified', v_md_verified
      ));
  end if;

  return v_new_grade;
end;
$$ language plpgsql security definer;

-- Trigger: after any analysis_snapshots INSERT, recalc the project's creator.
create or replace function on_snapshot_recalc_grade()
returns trigger as $$
declare
  v_creator_id uuid;
begin
  select creator_id into v_creator_id from projects where id = new.project_id;
  if v_creator_id is not null then
    perform recalculate_creator_grade(v_creator_id);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_snapshot_grade_recalc on analysis_snapshots;
create trigger on_snapshot_grade_recalc
  after insert on analysis_snapshots
  for each row execute function on_snapshot_recalc_grade();

-- ═══════════════════════════════════════════════════════════════
-- AP EVENTS — audit trail for every Activity Point change (v0.5)
-- Enables the Scout dashboard to show "why you earned X AP"
-- ═══════════════════════════════════════════════════════════════
create table if not exists ap_events (
  id                  uuid default gen_random_uuid() primary key,
  member_id           uuid references members(id) on delete cascade not null,
  kind                text not null check (kind in (
    'vote',                       -- base reward for a Forecast vote
    'vote_accurate_forecast',     -- bonus when forecasted project graduates (V1)
    'applaud',                    -- base reward for an Applaud
    'applaud_craftsman',          -- bonus when applauded project wins Craftsman (V1)
    'md_download',                -- MD Library free download earned AP
    'bonus',                      -- hand-granted or seasonal event
    'adjustment'                  -- staff correction (positive or negative)
  )),
  ap_delta            integer not null,
  related_vote_id     uuid references votes(id) on delete set null,
  related_applaud_id  uuid references applauds(id) on delete set null,
  related_project_id  uuid references projects(id) on delete set null,
  note                text,
  created_at          timestamptz default now()
);

create index if not exists idx_ap_events_member       on ap_events(member_id, created_at desc);
create index if not exists idx_ap_events_kind         on ap_events(kind);

alter table ap_events enable row level security;
drop policy if exists "Members read own AP events" on ap_events;
create policy "Members read own AP events" on ap_events for select using (auth.uid() = member_id);
drop policy if exists "Service role manages AP events" on ap_events;
create policy "Service role manages AP events" on ap_events for all using (auth.role() = 'service_role');

-- Atomic AP grant: logs an event and updates the member's running total.
-- The members UPDATE fires update_scout_tier() which recomputes tier.
create or replace function grant_ap(
  p_member_id          uuid,
  p_kind               text,
  p_ap_delta           integer,
  p_related_vote_id    uuid default null,
  p_related_applaud_id uuid default null,
  p_related_project_id uuid default null,
  p_note               text default null
)
returns void as $$
begin
  if p_member_id is null or p_ap_delta = 0 then
    return;
  end if;

  insert into ap_events (member_id, kind, ap_delta, related_vote_id, related_applaud_id, related_project_id, note)
  values (p_member_id, p_kind, p_ap_delta, p_related_vote_id, p_related_applaud_id, p_related_project_id, p_note);

  update members
     set activity_points = greatest(0, activity_points + p_ap_delta)
   where id = p_member_id;
end;
$$ language plpgsql security definer;

-- Base AP rewards (V0.5 — simple constants; bonus rules land in V1)
--   Vote cast:    +10 AP
--   Applaud cast: +25 AP
create or replace function on_vote_insert_grant_ap()
returns trigger as $$
begin
  if new.member_id is not null then
    perform grant_ap(new.member_id, 'vote', 10, new.id, null, new.project_id, 'Forecast vote cast');
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_vote_grant_ap on votes;
create trigger on_vote_grant_ap
  after insert on votes
  for each row execute function on_vote_insert_grant_ap();

create or replace function on_applaud_insert_grant_ap()
returns trigger as $$
begin
  if new.member_id is not null then
    perform grant_ap(new.member_id, 'applaud', 25, null, new.id, new.project_id, 'Applaud cast');
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_applaud_grant_ap on applauds;
create trigger on_applaud_grant_ap
  after insert on applauds
  for each row execute function on_applaud_insert_grant_ap();

-- ═══════════════════════════════════════════════════════════════
-- MONTHLY VOTE CAP — enforce Scout tier quota on votes INSERT
-- Bronze 20 · Silver 40 · Gold 60 · Platinum 80
-- ═══════════════════════════════════════════════════════════════
create or replace function monthly_vote_cap(p_tier text)
returns integer as $$
begin
  return case p_tier
    when 'Platinum' then 80
    when 'Gold'     then 60
    when 'Silver'   then 40
    else                 20  -- Bronze
  end;
end;
$$ language plpgsql immutable;

create or replace function enforce_vote_cap_and_increment()
returns trigger as $$
declare
  v_tier text;
  v_used integer;
  v_reset timestamptz;
  v_cap  integer;
begin
  if new.member_id is null then
    return new;   -- anonymous votes (back-compat) bypass the cap
  end if;

  select tier, monthly_votes_used, votes_reset_at
    into v_tier, v_used, v_reset
    from members
   where id = new.member_id
   for update;

  -- Monthly rollover
  if v_reset <= now() then
    v_used := 0;
    update members
       set monthly_votes_used = 0,
           votes_reset_at = (date_trunc('month', now()) + interval '1 month')
     where id = new.member_id;
  end if;

  v_cap := monthly_vote_cap(coalesce(v_tier, 'Bronze'));

  if v_used >= v_cap then
    raise exception 'Monthly vote cap reached for tier %: % / %', coalesce(v_tier, 'Bronze'), v_used, v_cap
      using errcode = 'P0001';
  end if;

  update members
     set monthly_votes_used = monthly_votes_used + 1
   where id = new.member_id;

  -- Stamp the vote with the member's current tier for weighting integrity
  new.scout_tier := coalesce(v_tier, 'Bronze');
  new.weight := case coalesce(v_tier, 'Bronze')
    when 'Platinum' then 3.0
    when 'Gold'     then 2.0
    when 'Silver'   then 1.5
    else                 1.0
  end;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_vote_enforce_cap on votes;
create trigger on_vote_enforce_cap
  before insert on votes
  for each row execute function enforce_vote_cap_and_increment();

-- Applaud weight = Scout tier multiplier (same scale as votes).
create or replace function stamp_applaud_weight()
returns trigger as $$
declare
  v_tier text;
begin
  if new.member_id is null then
    return new;
  end if;
  select tier into v_tier from members where id = new.member_id;
  new.scout_tier := coalesce(v_tier, 'Bronze');
  new.weight := case coalesce(v_tier, 'Bronze')
    when 'Platinum' then 3.0
    when 'Gold'     then 2.0
    when 'Silver'   then 1.5
    else                 1.0
  end;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_applaud_stamp_weight on applauds;
create trigger on_applaud_stamp_weight
  before insert on applauds
  for each row execute function stamp_applaud_weight();

-- ═══════════════════════════════════════════════════════════════
-- VIEWS
-- ═══════════════════════════════════════════════════════════════
drop view if exists project_feed;
create view project_feed as
  select
    p.*,
    coalesce(sum(v.vote_count * v.weight), 0)  as weighted_votes,
    count(distinct v.id)                        as vote_count_raw,
    count(distinct a.id)                        as applaud_count,
    bb.problem                                  as brief_problem,
    bb.features                                 as brief_features,
    bb.ai_tools                                 as brief_tools,
    bb.target_user                              as brief_target
  from projects p
  left join votes v         on v.project_id = p.id
  left join applauds a      on a.project_id = p.id
  left join build_briefs bb on bb.project_id = p.id
  group by p.id, bb.problem, bb.features, bb.ai_tools, bb.target_user
  order by p.created_at desc;

drop view if exists member_stats;
create view member_stats as
  select
    m.*,
    count(distinct p.id)                                                            as total_projects,
    count(distinct p.id) filter (where p.status in ('graduated','valedictorian'))   as graduated_count,
    count(distinct v.id)                                                            as total_votes_cast,
    count(distinct ap.id)                                                           as total_applauds_given,
    monthly_vote_cap(m.tier)                                                        as monthly_vote_cap,
    greatest(0, monthly_vote_cap(m.tier) - m.monthly_votes_used)                    as monthly_votes_remaining
  from members m
  left join projects p  on p.creator_id  = m.id
  left join votes v     on v.member_id   = m.id
  left join applauds ap on ap.member_id  = m.id
  group by m.id;

-- Artifact Library Feed (v1.5 · format × tool · stack tags 포함)
--   1순위: verified_badge DESC (졸업 크리에이터)
--   2순위: is_free DESC       (무료 진입 장벽 완화)
--   3순위: downloads_count DESC (인기)
--   4순위: created_at DESC    (최신)
drop view if exists md_library_feed;
create view md_library_feed as
  select
    ml.*,
    m.display_name         as author_name,
    m.email                as author_email,
    m.creator_grade        as current_author_grade,
    m.avatar_url           as author_avatar_url,
    p.project_name         as source_project_name,
    p.score_total          as source_project_score,
    p.status               as source_project_status
  from md_library ml
  left join members m  on m.id  = ml.creator_id
  left join projects p on p.id  = ml.linked_project_id
  where ml.status = 'published' and ml.is_public = true
  order by
    ml.verified_badge desc,
    ml.is_free desc,
    ml.downloads_count desc,
    ml.created_at desc;

-- Auto-inferred member stack · union of tech_layers across each member's projects
-- Used by Library filter when members.preferred_stack is null.
drop view if exists member_stack_auto;
create view member_stack_auto as
  select
    p.creator_id                                   as member_id,
    array_agg(distinct layer order by layer)       as stack
  from projects p, unnest(p.tech_layers) as layer
  where p.creator_id is not null
  group by p.creator_id;

drop view if exists pipeline_health;
create view pipeline_health as
  select
    s.name                                                  as season,
    s.status                                                as season_status,
    count(p.id)                                             as total_projects,
    count(p.id) filter (where p.status = 'active')                     as active_projects,
    count(p.id) filter (where p.status in ('graduated','valedictorian')) as graduated_projects,
    count(p.id) filter (where p.unlock_level >= 3)                     as unlocked_level_3,
    count(p.id) filter (where p.unlock_level >= 5)                     as unlocked_level_5,
    count(p.id) filter (where p.unlock_level >= 10)                    as unlocked_level_10,
    count(snap.id)                                          as total_snapshots,
    avg(p.score_auto)                                       as avg_auto_score,
    avg(p.score_total)                                      as avg_total_score,
    max(p.created_at)                                       as last_submission_at,
    max(p.last_analysis_at)                                 as last_analysis_at
  from seasons s
  left join projects p            on p.season_id = s.id
  left join analysis_snapshots snap on snap.project_id = p.id
  group by s.id, s.name, s.status;
