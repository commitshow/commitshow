-- Trust Level · Discourse-style automatic privilege progression.
-- Strategy doc §5.7.
--
-- Five levels — TL0 New through TL4 Leader. The first four bump
-- automatically off measurable signals (account age, AP, comment
-- count, GitHub connect); TL4 is reserved for manual appointment by
-- ops. The level grants ambient privileges (comment cap, post
-- publish, surfacing weight) without a separate moderator queue —
-- "earned progression" is the moat against spam-flag fatigue.
--
-- Phase 1 deliberately skips the strategy doc's "acted_on" criterion
-- (would need a comments.acted_on flag set by the creator) — proxy
-- with comment_count instead. Switch criteria later without
-- migrating data: just edit recompute_trust_level().
--
-- Levels can only ratchet UP via the auto-bump path. A member who
-- earned TL2 keeps it even if they later go quiet — the level
-- represents prior contribution, not current activity. (Manual
-- demotions are still possible by direct UPDATE.)

-- 1. Column · NOT NULL with default 0 so every existing member starts
--    at TL0 ("New") and gets bumped on the next recompute pass.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS trust_level int NOT NULL DEFAULT 0
    CHECK (trust_level BETWEEN 0 AND 4),
  ADD COLUMN IF NOT EXISTS trust_level_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_members_trust_level ON public.members(trust_level);

-- 2. Computer · returns the level a member SHOULD be at given their
--    current signals. Caller is responsible for clamping to ratchet-
--    up-only behavior. Reads cheap aggregates only — no joins to
--    rich history tables.
CREATE OR REPLACE FUNCTION public.compute_trust_level(p_member_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_age_days       int;
  v_ap             int;
  v_comments       int;
  v_github         boolean;
BEGIN
  SELECT
    EXTRACT(EPOCH FROM (now() - created_at)) / 86400,
    COALESCE(activity_points, 0),
    github_handle IS NOT NULL
  INTO v_age_days, v_ap, v_github
    FROM members WHERE id = p_member_id;

  IF v_age_days IS NULL THEN RETURN 0; END IF;

  SELECT COUNT(*)::int INTO v_comments
    FROM comments
   WHERE member_id = p_member_id AND kind = 'human';

  -- TL3 Regular · 60 days + 200 AP + 20 comments.
  -- (Strategy doc said acted-on ≥ 5 — proxy with comments since we
  -- don't track acted-on yet. 20 is harder than 5 so this isn't a
  -- gift; tighten when acted-on lands.)
  IF v_age_days >= 60 AND v_ap >= 200 AND v_comments >= 20 THEN
    RETURN 3;
  END IF;

  -- TL2 Member · 30 days + 50 AP + 5 comments.
  IF v_age_days >= 30 AND v_ap >= 50 AND v_comments >= 5 THEN
    RETURN 2;
  END IF;

  -- TL1 Basic · 7 days OR (GitHub connected + 5 comments). The
  -- GitHub shortcut rewards connecting an OAuth identity early —
  -- abuse-resistant signup → faster comment-cap relief.
  IF v_age_days >= 7 OR (v_github AND v_comments >= 5) THEN
    RETURN 1;
  END IF;

  RETURN 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_trust_level(uuid) TO authenticated;

-- 3. Recompute · ratchet-up only. Returns new level. Called from
--    triggers + can be invoked manually.
CREATE OR REPLACE FUNCTION public.recompute_trust_level(p_member_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current int;
  v_target  int;
BEGIN
  SELECT trust_level INTO v_current FROM members WHERE id = p_member_id;
  IF v_current IS NULL THEN RETURN 0; END IF;

  -- TL4 is appointed-only — never auto-promote into or out of it.
  IF v_current >= 4 THEN RETURN v_current; END IF;

  v_target := compute_trust_level(p_member_id);

  IF v_target > v_current THEN
    UPDATE members
       SET trust_level    = v_target,
           trust_level_at = now()
     WHERE id = p_member_id;
    RETURN v_target;
  END IF;

  RETURN v_current;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_trust_level(uuid) TO authenticated;

-- 4. Triggers · recompute on signals that could push a member up.
--    Comments INSERT (more comments) and AP grants (activity_point_ledger
--    INSERT) are the two recurring drivers. Account-age threshold (7d
--    for TL1) needs a periodic sweep — handled by the daily cron once
--    we wire it; until then, the next AP grant or comment will pick
--    them up since recompute_trust_level checks all conditions.
CREATE OR REPLACE FUNCTION public.tg_recompute_trust_on_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.kind = 'human' AND NEW.member_id IS NOT NULL THEN
    PERFORM recompute_trust_level(NEW.member_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_trust_on_comment ON public.comments;
CREATE TRIGGER trg_recompute_trust_on_comment
  AFTER INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION tg_recompute_trust_on_comment();

CREATE OR REPLACE FUNCTION public.tg_recompute_trust_on_ap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.member_id IS NOT NULL THEN
    PERFORM recompute_trust_level(NEW.member_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_trust_on_ap ON public.activity_point_ledger;
CREATE TRIGGER trg_recompute_trust_on_ap
  AFTER INSERT ON public.activity_point_ledger
  FOR EACH ROW
  EXECUTE FUNCTION tg_recompute_trust_on_ap();

-- 5. Backfill · run recompute_trust_level over every existing member.
--    Cheap (one query per member) but bounded by member count, fine
--    at current scale.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM members LOOP
    PERFORM recompute_trust_level(r.id);
  END LOOP;
END $$;
