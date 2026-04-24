-- ════════════════════════════════════════════════════════════════════════════
-- 20260425_activity_point_kind_backfill.sql
--
-- The v2 schema migration (20260424_v2_prd_realignment.sql) rewrote the
-- activity_point_ledger.kind CHECK list to the v2 canonical values. That
-- dropped 'audition_climb' and 'audition_streak' — kinds that the older
-- 20260420_audition_rewards.sql trigger (on_snapshot_audition_reward)
-- still fires via grant_ap() on every new analysis_snapshots row.
--
-- Left unpatched, a Creator's "Re-analyze" click raises P0001
-- "new row for relation activity_point_ledger violates check constraint".
-- This migration re-adds the two audition kinds so the streak reward path
-- survives v2.
--
-- Non-destructive · idempotent.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table activity_point_ledger
  drop constraint if exists activity_point_ledger_kind_check;

alter table activity_point_ledger
  add constraint activity_point_ledger_kind_check check (kind in (
    'vote',                    -- Forecast base reward
    'vote_accurate_forecast',  -- season-end bonus (V1)
    'applaud_sent',            -- future (applaud AP · fractional · batched)
    'applaud_received',        -- future (applaud received · batched)
    'build_log',               -- Community Build Log published
    'stack',                   -- Community Stack card published
    'ask',                     -- Asks board posted
    'office_hours_host',       -- Hosted Office Hours
    'office_hours_attend',     -- Attended Office Hours
    'comment',                 -- Comment written
    'comment_upvote_received', -- Your comment was upvoted
    'creator_commit',          -- Creator shipped a Commit
    'brief_discuss',           -- Participated in Core Intent thread
    'x_mention',               -- @commitshow or #commitshow detected
    'md_download',             -- MD Library download earned
    'early_spotter',           -- Early Spotter hit bonus
    'audition_climb',          -- re-added · audition round improved score
    'audition_streak',         -- re-added · 3 consecutive climbs bonus
    'bonus',                   -- hand-granted seasonal event
    'adjustment'               -- staff correction
  ));

commit;
