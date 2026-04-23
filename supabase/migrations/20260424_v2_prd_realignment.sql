-- ════════════════════════════════════════════════════════════════════════════
-- 20260424_v2_prd_realignment.sql
--
-- commit.show PRD v2 schema migration. Anchors:
--   CLAUDE.md §1-A (v2 delta 7가지)
--   CLAUDE.md §6   (%-based graduation · Applaud is community-signal only)
--   CLAUDE.md §7.5 (Applaud polymorphic target · 1 toggle per item)
--   CLAUDE.md §9   (Vote uniform weight = 1.0 · tier caps monthly quota only)
--   CLAUDE.md §13  (new tables: community_posts · post_tags · office_hours_events
--                   comment_upvotes · ballot_wallets · awards_ledger · x_mentions)
--   CLAUDE.md §13-B (Creator Community 4 menus)
--
-- Sequenced as user-confirmed:
--   ① Clear all applauds data  ② Single migration file  ③ RLS + triggers included
--
-- Run this in Supabase SQL Editor once. Idempotent guards (`if (not) exists`)
-- let reruns finish cleanly.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] Tear down v1.8 applaud artifacts (Craft Award Week track)
-- ────────────────────────────────────────────────────────────────────────────
drop view    if exists project_applaud_signals cascade;
drop trigger if exists on_applaud_grant_ap on applauds;
drop trigger if exists on_applaud_stamp_weight on applauds;
drop function if exists on_applaud_insert_grant_ap() cascade;
drop function if exists stamp_applaud_weight() cascade;
drop index   if exists idx_applauds_axis;

-- User-confirmed: clear all applaud data. CASCADE drops the legacy FK from
-- ap_events.related_applaud_id so we can re-add it against the new table.
drop table   if exists applauds cascade;

-- ────────────────────────────────────────────────────────────────────────────
-- [B] Comments — baseline table (required for applaud target_type='comment'
--     and for comment_upvotes)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists comments (
  id           uuid        default gen_random_uuid() primary key,
  project_id   uuid        references projects(id) on delete cascade not null,
  member_id    uuid        references members(id)  on delete set null,
  parent_id    uuid        references comments(id) on delete cascade,
  text         text        not null,
  upvote_count integer     default 0,
  simhash      text,
  created_at   timestamptz default now()
);

create index if not exists idx_comments_project on comments(project_id, created_at desc);
create index if not exists idx_comments_parent  on comments(parent_id);

alter table comments enable row level security;
drop policy if exists "Anyone can read comments"         on comments;
drop policy if exists "Auth users insert own comments"   on comments;
drop policy if exists "Members edit own comments"        on comments;
drop policy if exists "Members delete own comments"      on comments;

create policy "Anyone can read comments"
  on comments for select using (true);
create policy "Auth users insert own comments"
  on comments for insert with check (auth.uid() = member_id);
create policy "Members edit own comments"
  on comments for update using (auth.uid() = member_id);
create policy "Members delete own comments"
  on comments for delete using (auth.uid() = member_id);

-- ────────────────────────────────────────────────────────────────────────────
-- [C] Community posts — Build Logs · Stacks · Asks · Office Hours (§13-B)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists community_posts (
  id                uuid        default gen_random_uuid() primary key,
  author_id         uuid        references members(id) on delete set null,
  type              text        not null check (type in
                      ('build_log','stack','ask','office_hours')),
  subtype           text,       -- stack:  recipe|prompt|review
                                -- ask:    looking_for|available|feedback
                                -- office_hours: ama|toolmaker|pair_building
  title             text        not null,
  tldr              text,
  body              text,
  tags              jsonb       default '[]'::jsonb,
  linked_project_id uuid        references projects(id) on delete set null,
  status            text        default 'published' check (status in
                      ('draft','published','archived','resolved','expired')),
  published_at      timestamptz default now(),
  created_at        timestamptz default now()
);

create index if not exists idx_community_posts_type
  on community_posts(type, published_at desc);
create index if not exists idx_community_posts_author
  on community_posts(author_id, created_at desc);
create index if not exists idx_community_posts_linked
  on community_posts(linked_project_id);

alter table community_posts enable row level security;
drop policy if exists "Published posts readable"  on community_posts;
drop policy if exists "Auth users author posts"   on community_posts;
drop policy if exists "Authors edit own posts"    on community_posts;
drop policy if exists "Authors delete own posts"  on community_posts;

create policy "Published posts readable"
  on community_posts for select
  using (status in ('published','resolved','expired') or auth.uid() = author_id);
create policy "Auth users author posts"
  on community_posts for insert
  with check (auth.uid() = author_id);
create policy "Authors edit own posts"
  on community_posts for update using (auth.uid() = author_id);
create policy "Authors delete own posts"
  on community_posts for delete using (auth.uid() = author_id);

-- ────────────────────────────────────────────────────────────────────────────
-- [D] Post tags — normalized tag index (filter·discovery)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists post_tags (
  post_id uuid references community_posts(id) on delete cascade,
  tag     text,
  primary key (post_id, tag)
);

create index if not exists idx_post_tags_tag on post_tags(tag);

alter table post_tags enable row level security;
drop policy if exists "Anyone can read post tags"    on post_tags;
drop policy if exists "Authors insert own post tags" on post_tags;
drop policy if exists "Authors delete own post tags" on post_tags;

create policy "Anyone can read post tags"
  on post_tags for select using (true);
create policy "Authors insert own post tags"
  on post_tags for insert
  with check (exists (
    select 1 from community_posts p
     where p.id = post_tags.post_id and p.author_id = auth.uid()
  ));
create policy "Authors delete own post tags"
  on post_tags for delete
  using (exists (
    select 1 from community_posts p
     where p.id = post_tags.post_id and p.author_id = auth.uid()
  ));

-- ────────────────────────────────────────────────────────────────────────────
-- [E] Office hours events (§13-B.6)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists office_hours_events (
  id              uuid        default gen_random_uuid() primary key,
  host_id         uuid        references members(id) on delete set null,
  scheduled_at    timestamptz not null,
  format          text        not null check (format in
                    ('ama','toolmaker','pair_building')),
  title           text        not null,
  description     text,
  discord_url     text,
  recording_url   text,
  summary_post_id uuid        references community_posts(id) on delete set null,
  attendees_count integer     default 0,
  created_at      timestamptz default now()
);

create index if not exists idx_office_hours_scheduled
  on office_hours_events(scheduled_at desc);

alter table office_hours_events enable row level security;
drop policy if exists "Anyone can read office hours"   on office_hours_events;
drop policy if exists "Hosts manage own office hours"  on office_hours_events;

create policy "Anyone can read office hours"
  on office_hours_events for select using (true);
create policy "Hosts manage own office hours"
  on office_hours_events for all
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

-- ────────────────────────────────────────────────────────────────────────────
-- [F] Applauds — v2 polymorphic (§1-A ①③ · §7.5)
--     target_type ∈ {product, comment, build_log, stack, brief, recommit}
--     1 toggle per (member_id, target_type, target_id) · unlimited overall
--     No weight · no scout_tier · no season_id. Community-signal only.
-- ────────────────────────────────────────────────────────────────────────────
create table applauds (
  id          uuid        default gen_random_uuid() primary key,
  member_id   uuid        not null references members(id) on delete cascade,
  target_type text        not null check (target_type in
                ('product','comment','build_log','stack','brief','recommit')),
  target_id   uuid        not null,
  created_at  timestamptz default now(),
  unique (member_id, target_type, target_id)
);

create index idx_applauds_member on applauds(member_id, created_at desc);
create index idx_applauds_target on applauds(target_type, target_id);

alter table applauds enable row level security;
create policy "Anyone can read applauds"
  on applauds for select using (true);
create policy "Auth users insert own applauds"
  on applauds for insert with check (auth.uid() = member_id);
create policy "Members delete own applauds"
  on applauds for delete using (auth.uid() = member_id);

-- [F.1] Self-applaud prevention (§1-A ③ · ownership check per target_type)
create or replace function prevent_self_applaud()
returns trigger as $$
declare
  v_owner uuid;
begin
  case new.target_type
    when 'product' then
      select creator_id into v_owner
        from projects where id = new.target_id;
    when 'comment' then
      select member_id into v_owner
        from comments where id = new.target_id;
    when 'build_log' then
      select author_id into v_owner
        from community_posts
       where id = new.target_id and type = 'build_log';
    when 'stack' then
      select author_id into v_owner
        from community_posts
       where id = new.target_id and type = 'stack';
    when 'brief' then
      select p.creator_id into v_owner
        from build_briefs b
        join projects p on p.id = b.project_id
       where b.id = new.target_id;
    when 'recommit' then
      select p.creator_id into v_owner
        from analysis_snapshots s
        join projects p on p.id = s.project_id
       where s.id = new.target_id;
  end case;

  if v_owner is not null and v_owner = new.member_id then
    raise exception 'Self-applaud blocked (% / %)', new.target_type, new.target_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_applaud_prevent_self on applauds;
create trigger on_applaud_prevent_self
  before insert on applauds
  for each row execute function prevent_self_applaud();

comment on table applauds is
  'v2 polymorphic applaud (§1-A ①③ · §7.5). 1 toggle per (member, target_type, target_id). No weight · no scout tier · community-signal only.';

-- ────────────────────────────────────────────────────────────────────────────
-- [G] Comment upvotes — drives comments.upvote_count
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists comment_upvotes (
  comment_id uuid        references comments(id) on delete cascade,
  member_id  uuid        references members(id)  on delete cascade,
  created_at timestamptz default now(),
  primary key (comment_id, member_id)
);

alter table comment_upvotes enable row level security;
drop policy if exists "Anyone can read comment upvotes" on comment_upvotes;
drop policy if exists "Auth users upvote"               on comment_upvotes;
drop policy if exists "Members remove own upvote"       on comment_upvotes;

create policy "Anyone can read comment upvotes"
  on comment_upvotes for select using (true);
create policy "Auth users upvote"
  on comment_upvotes for insert with check (auth.uid() = member_id);
create policy "Members remove own upvote"
  on comment_upvotes for delete using (auth.uid() = member_id);

create or replace function bump_comment_upvote()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    update comments
       set upvote_count = upvote_count + 1
     where id = new.comment_id;
  elsif (tg_op = 'DELETE') then
    update comments
       set upvote_count = greatest(0, upvote_count - 1)
     where id = old.comment_id;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists on_comment_upvote_bump on comment_upvotes;
create trigger on_comment_upvote_bump
  after insert or delete on comment_upvotes
  for each row execute function bump_comment_upvote();

-- ────────────────────────────────────────────────────────────────────────────
-- [H] Ballot wallets — canonical monthly Vote quota ledger (§13.1 · V1 hookup)
--     Added here as the target table; the vote cap trigger will migrate to
--     consume it in P2 (for now members.monthly_votes_used stays primary).
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists ballot_wallets (
  member_id  uuid        references members(id) on delete cascade,
  month      date        not null,
  total      integer     not null,
  used       integer     default 0,
  reserved   integer     default 0,
  updated_at timestamptz default now(),
  primary key (member_id, month)
);

alter table ballot_wallets enable row level security;
drop policy if exists "Members read own ballot wallet"     on ballot_wallets;
drop policy if exists "Service role manages ballot wallets" on ballot_wallets;

create policy "Members read own ballot wallet"
  on ballot_wallets for select using (auth.uid() = member_id);
create policy "Service role manages ballot wallets"
  on ballot_wallets for all using (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────────────────────
-- [I] Awards ledger — unified (Community Award + 상금 + 환급) accounting
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists awards_ledger (
  id           uuid        default gen_random_uuid() primary key,
  member_id    uuid        references members(id) on delete set null,
  month        date,                                -- nullable (refunds, one-offs)
  tier         text,                                -- valedictorian|honors|graduate|
                                                    -- top_scout|category_scout|
                                                    -- top_creator|weekly_scout|...
  type         text        not null check (type in
                 ('badge','credit','feature','cash','gift_card','refund','bonus')),
  amount_cents integer     default 0,
  vendor       text        check (vendor in
                 ('internal','wise','trolley','tremendous','stripe','stripe_refund')),
  vendor_ref   text,
  paid_at      timestamptz,
  note         text,
  created_at   timestamptz default now()
);

create index if not exists idx_awards_ledger_member
  on awards_ledger(member_id, created_at desc);
create index if not exists idx_awards_ledger_type
  on awards_ledger(type);

alter table awards_ledger enable row level security;
drop policy if exists "Members read own awards"         on awards_ledger;
drop policy if exists "Service role manages awards"     on awards_ledger;

create policy "Members read own awards"
  on awards_ledger for select using (auth.uid() = member_id);
create policy "Service role manages awards"
  on awards_ledger for all using (auth.role() = 'service_role');

comment on table awards_ledger is
  'Unified ledger for Community Awards + graduation prize + refunds (§13.2). vendor routes payout rail (wise/trolley/tremendous/stripe_refund).';

-- ────────────────────────────────────────────────────────────────────────────
-- [J] X mentions — external signal tally
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists x_mentions (
  id             uuid        default gen_random_uuid() primary key,
  member_id      uuid        references members(id) on delete set null,
  tweet_id       text        not null unique,
  mentioned_at   timestamptz not null,
  points_granted integer     default 0,
  created_at     timestamptz default now()
);

create index if not exists idx_x_mentions_member
  on x_mentions(member_id, mentioned_at desc);

alter table x_mentions enable row level security;
drop policy if exists "Service role manages x mentions" on x_mentions;

create policy "Service role manages x mentions"
  on x_mentions for all using (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────────────────────
-- [K] Rename ap_events → activity_point_ledger (§13.2)
--     The table keeps its row data. FK to applauds is re-added below.
-- ────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_class where relname = 'ap_events') then
    alter table ap_events rename to activity_point_ledger;
  end if;
end $$;

-- Widen kind check to cover v2 AP sources (Community posts · X mentions · etc.)
alter table activity_point_ledger
  drop constraint if exists ap_events_kind_check,
  drop constraint if exists activity_point_ledger_kind_check;

alter table activity_point_ledger
  add constraint activity_point_ledger_kind_check check (kind in (
    'vote',                   -- Forecast base reward
    'vote_accurate_forecast', -- season-end bonus (V1)
    'applaud_sent',           -- future (applaud AP · fractional · batched)
    'applaud_received',       -- future (applaud received · batched)
    'build_log',              -- Community Build Log published
    'stack',                  -- Community Stack card published
    'ask',                    -- Asks board posted
    'office_hours_host',      -- Hosted Office Hours
    'office_hours_attend',    -- Attended Office Hours
    'comment',                -- Comment written
    'comment_upvote_received',-- Your comment was upvoted
    'creator_commit',         -- Creator shipped a Commit
    'brief_discuss',          -- Participated in Core Intent thread
    'x_mention',              -- @commitshow or #commitshow detected
    'md_download',            -- MD Library download earned
    'early_spotter',          -- Early Spotter hit bonus
    'bonus',                  -- hand-granted seasonal event
    'adjustment'              -- staff correction
  ));

-- Re-add FK after applauds drop/recreate. Old constraint name may still exist
-- under the ap_events_* prefix since rename preserves FKs.
alter table activity_point_ledger
  drop constraint if exists ap_events_related_applaud_id_fkey,
  drop constraint if exists activity_point_ledger_related_applaud_id_fkey;

alter table activity_point_ledger
  add constraint activity_point_ledger_related_applaud_id_fkey
  foreign key (related_applaud_id) references applauds(id) on delete set null;

-- Repoint RLS policies (they were created against ap_events originally).
drop policy if exists "Members read own AP events"     on activity_point_ledger;
drop policy if exists "Service role manages AP events" on activity_point_ledger;

create policy "Members read own AP events"
  on activity_point_ledger for select using (auth.uid() = member_id);
create policy "Service role manages AP events"
  on activity_point_ledger for all using (auth.role() = 'service_role');

-- Rewire indexes (renamed table carries old names; recreate under the new
-- canonical prefix and drop the legacy aliases if any).
drop index if exists idx_ap_events_member;
drop index if exists idx_ap_events_kind;
create index if not exists idx_activity_point_ledger_member
  on activity_point_ledger(member_id, created_at desc);
create index if not exists idx_activity_point_ledger_kind
  on activity_point_ledger(kind);

-- Refresh grant_ap() to target the renamed table.
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

  insert into activity_point_ledger (
    member_id, kind, ap_delta,
    related_vote_id, related_applaud_id, related_project_id, note
  ) values (
    p_member_id, p_kind, p_ap_delta,
    p_related_vote_id, p_related_applaud_id, p_related_project_id, p_note
  );

  update members
     set activity_points = greatest(0, activity_points + p_ap_delta)
   where id = p_member_id;
end;
$$ language plpgsql security definer;

-- ────────────────────────────────────────────────────────────────────────────
-- [L] Votes — v2 uniform weight + self-vote prevention (§1-A ① · §9)
--     Tier still caps monthly quota, but weight is flat 1.0.
-- ────────────────────────────────────────────────────────────────────────────

-- Allow ×N 몰빵 by dropping the (member_id, project_id, season_id) UNIQUE
-- constraint. Multiple Forecast rows per (member, project) are now valid;
-- each counts as one ballot against the monthly cap.
alter table votes drop constraint if exists votes_member_project_season_uq;

create or replace function enforce_vote_cap_and_increment()
returns trigger as $$
declare
  v_tier          text;
  v_used          integer;
  v_reset         timestamptz;
  v_cap           integer;
  v_project_owner uuid;
begin
  -- Anonymous vote bypass (legacy pre-auth rows)
  if new.member_id is null then
    new.weight := 1.0;
    return new;
  end if;

  -- v2 hard block: self-voting is never allowed.
  select creator_id into v_project_owner
    from projects where id = new.project_id;
  if v_project_owner = new.member_id then
    raise exception 'Creators cannot vote on their own project'
      using errcode = 'P0001';
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
           votes_reset_at     = (date_trunc('month', now()) + interval '1 month')
     where id = new.member_id;
  end if;

  v_cap := monthly_vote_cap(coalesce(v_tier, 'Bronze'));

  if v_used >= v_cap then
    raise exception 'Monthly vote cap reached for tier %: % / %',
      coalesce(v_tier, 'Bronze'), v_used, v_cap
      using errcode = 'P0001';
  end if;

  update members
     set monthly_votes_used = monthly_votes_used + 1
   where id = new.member_id;

  -- v2: uniform weight. scout_tier stamped for audit record only.
  new.scout_tier := coalesce(v_tier, 'Bronze');
  new.weight     := 1.0;

  return new;
end;
$$ language plpgsql security definer;

-- Trigger itself is already bound to votes before insert; redefining the
-- function above is enough. Keep this drop+create for idempotency.
drop trigger if exists on_vote_enforce_cap on votes;
create trigger on_vote_enforce_cap
  before insert on votes
  for each row execute function enforce_vote_cap_and_increment();

-- ────────────────────────────────────────────────────────────────────────────
-- [M] Deprecated in v2 (kept for now · replaced in P2)
--
--   • evaluate_graduation(uuid) — still encodes the v1.8 5-AND gate. Superseded
--     by the %-based season-end engine in P2 (§6.2). No longer authoritative.
--   • project_applaud_signals   — not recreated. Applaud signals are now
--     target-type agnostic and surfaced per-target via direct queries.
--   • Craft Award Week UI in src/ — removed in P3.
--
-- No DDL changes here; just documenting the handoff to the next priority.
-- ────────────────────────────────────────────────────────────────────────────

commit;
