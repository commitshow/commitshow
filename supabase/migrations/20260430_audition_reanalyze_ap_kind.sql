-- Snapshot insertion was silently failing for every resubmit / weekly
-- audit on a different commit_sha. Trace:
--
--   on_analysis_snapshot_audition (AFTER INSERT trigger) calls
--     grant_ap(creator_id, 'audition_reanalyze', 15, ...)
--   grant_ap inserts into activity_point_ledger (kind = 'audition_reanalyze')
--   activity_point_ledger.kind CHECK had 'audition_climb' + 'audition_streak'
--     but NOT 'audition_reanalyze' → trigger throws → INSERT rolls back
--
-- analyze-project caught snapErr but logged-and-continued, so the
-- projects table still got updated with new scores (last_analysis_at +
-- lh_*) while no snapshot row was actually created. Symptom: project
-- detail page showed score in the hero card but the audit timeline
-- stayed stuck at the last successful (pre-trigger-bug) snapshot, and
-- the most recent audit's lighthouse / breakdown details were missing.
--
-- Fix: add 'audition_reanalyze' to the allowed kind set.

ALTER TABLE activity_point_ledger DROP CONSTRAINT IF EXISTS activity_point_ledger_kind_check;
ALTER TABLE activity_point_ledger ADD CONSTRAINT activity_point_ledger_kind_check
CHECK (kind = ANY (ARRAY[
  'vote'::text, 'vote_accurate_forecast'::text,
  'applaud_sent'::text, 'applaud_received'::text,
  'build_log'::text, 'stack'::text, 'ask'::text,
  'office_hours_host'::text, 'office_hours_attend'::text,
  'comment'::text, 'comment_upvote_received'::text,
  'creator_commit'::text, 'brief_discuss'::text,
  'x_mention'::text, 'md_download'::text,
  'early_spotter'::text,
  'audition_reanalyze'::text,
  'audition_climb'::text,
  'audition_streak'::text,
  'bonus'::text, 'adjustment'::text
]));
