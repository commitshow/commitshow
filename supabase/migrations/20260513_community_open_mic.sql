-- ───────────────────────────────────────────────────────────────────────────
-- Community · Open Mic post type (2026-05-13)
-- ───────────────────────────────────────────────────────────────────────────
-- Lightweight short-form post type for the Creator Community. Lives next
-- to the existing four (build_log · stack · ask · office_hours) but with
-- a looser body convention — visitors drop a one-liner, react to others,
-- treat it like a brand-managed pinboard. V1 launch surface; the other
-- four stay tab-noted but disabled in the UI until V1.5.
--
-- DB change is minimal · just allow 'open_mic' on the existing CHECK
-- constraint. Notifications view + applauds RLS already key off the
-- canonical type list (rebuilt below to include open_mic so future
-- mentions / applauds on Open Mic posts route correctly).
-- ───────────────────────────────────────────────────────────────────────────

-- Widen community_posts.type CHECK · only change needed at the DB layer.
-- Notifications target_type has no CHECK constraint in prod (live data
-- uses 'product' · 'comment_reply' · etc, all enum-free), and the
-- notifications_resolved view from the original migration was never
-- deployed — so neither needs to be touched for open_mic to work.
alter table community_posts
  drop constraint if exists community_posts_type_check;
alter table community_posts
  add constraint community_posts_type_check
  check (type in ('build_log','stack','ask','office_hours','open_mic'));
