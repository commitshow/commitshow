-- Widen applauds.target_type to cover community-post additions · 2026-05-15
--
-- Original set (20260424 v2 PRD realignment):
--   product · comment · build_log · stack · brief · recommit
--
-- Missing for full coverage of Creator Community (§13-B):
--   · ask           — Ask posts (looking-for / available / feedback)
--   · office_hours  — Office Hours posts
--   · open_mic      — Open Mic posts (added 2026-05-13)
--   · post_comment  — comments on ANY community post
--                     (community_post_comments · 20260515)
--
-- Same polymorphic shape as before · target_id points at the row of the
-- type, member_id stays the author. UNIQUE(member_id, target_type, target_id)
-- still enforces 1-item-1-applaud per CLAUDE.md §7.5.

alter table applauds
  drop constraint if exists applauds_target_type_check;

alter table applauds
  add constraint applauds_target_type_check
  check (target_type in (
    'product', 'comment', 'build_log', 'stack', 'brief', 'recommit',
    'ask', 'office_hours', 'open_mic', 'post_comment'
  ));
