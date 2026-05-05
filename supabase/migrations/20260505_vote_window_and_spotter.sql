-- Vote 14-day window + Early Spotter tiers — B-1 Sprint Step 2.
--
-- Strategy doc decision (2026-05-05): a Vote/Forecast on a project is
-- only meaningful when there's still uncertainty about whether the
-- project will reach Encore (85+). Votes cast 6 months after the first
-- audit don't carry forecasting signal — by then the score has plateaued.
--
-- So Vote opens at Round 1 (initial audit) and closes 14 days later.
-- Within those 14d, the *earlier* you bet, the more credit you earn:
--
--   First   (≤ 24h since Round 1)  → +50 AP bonus
--   Early   (24h – 3d)              → +20 AP bonus
--   Spotter (3d – 14d)              → +10 AP bonus
--   Closed  (> 14d)                 → vote rejected
--
-- Bonus is on top of the flat +10 AP that on_vote_grant_ap already
-- emits on every vote. Round-1 reference is the earliest snapshot of
-- trigger_type='initial' for the project.

-- 1. Spotter tier column on votes (audit record + drives Early Spotter
--    badge counts on the Scout profile later).
ALTER TABLE public.votes
  ADD COLUMN IF NOT EXISTS spotter_tier text
    CHECK (spotter_tier IN ('first', 'early', 'spotter'));

-- 2. Helper: window state for a project. Returns NULL row when the
--    project has no initial snapshot yet (= window not opened, vote
--    should be blocked too — there's no audit to forecast against).
CREATE OR REPLACE FUNCTION public.vote_window_state(p_project_id uuid)
RETURNS TABLE (
  opened_at  timestamptz,
  closes_at  timestamptz,
  is_open    boolean,
  tier_now   text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_opened timestamptz;
  v_now    timestamptz := now();
BEGIN
  SELECT MIN(created_at) INTO v_opened
    FROM analysis_snapshots
   WHERE project_id = p_project_id
     AND trigger_type = 'initial';

  IF v_opened IS NULL THEN
    RETURN QUERY SELECT NULL::timestamptz, NULL::timestamptz, false, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_opened,
    v_opened + INTERVAL '14 days',
    v_now <= v_opened + INTERVAL '14 days',
    CASE
      WHEN v_now <= v_opened + INTERVAL '24 hours' THEN 'first'
      WHEN v_now <= v_opened + INTERVAL '3 days'   THEN 'early'
      WHEN v_now <= v_opened + INTERVAL '14 days'  THEN 'spotter'
      ELSE NULL
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vote_window_state(uuid) TO anon, authenticated;

-- 3. BEFORE INSERT trigger · enforces window + stamps spotter_tier.
--    Name 'on_vote_window' fires after 'on_vote_enforce_cap' (alphabetical:
--    e < w) so cap check still happens first — no point burning a vote
--    quota slot on a vote that'll get rejected for window.
CREATE OR REPLACE FUNCTION public.enforce_vote_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state record;
BEGIN
  -- Anonymous votes (legacy) skip window enforcement — they have no
  -- AP to grant anyway and can't be Early Spotters.
  IF NEW.member_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_state FROM vote_window_state(NEW.project_id);

  IF v_state.opened_at IS NULL THEN
    RAISE EXCEPTION 'Cannot vote on a project that has no audit yet'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_state.is_open THEN
    RAISE EXCEPTION 'Forecast window closed for this project (opened %, closed %)',
      v_state.opened_at, v_state.closes_at
      USING ERRCODE = 'P0001';
  END IF;

  NEW.spotter_tier := v_state.tier_now;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_vote_window ON public.votes;
CREATE TRIGGER on_vote_window
  BEFORE INSERT ON public.votes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_vote_window();

-- 4. AFTER INSERT trigger · grants the spotter-tier AP bonus on top of
--    the flat +10 emitted by on_vote_grant_ap. Kept separate (instead
--    of folding into grant_ap) so the bonus shows up as its own
--    'early_spotter' ledger row — easier to audit + display "+50
--    First Spotter on @project" on the profile.
CREATE OR REPLACE FUNCTION public.on_vote_grant_spotter_bonus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bonus int;
  v_note  text;
BEGIN
  IF NEW.member_id IS NULL OR NEW.spotter_tier IS NULL THEN
    RETURN NEW;
  END IF;

  v_bonus := CASE NEW.spotter_tier
    WHEN 'first'   THEN 50
    WHEN 'early'   THEN 20
    WHEN 'spotter' THEN 10
    ELSE 0
  END;

  IF v_bonus = 0 THEN
    RETURN NEW;
  END IF;

  v_note := CASE NEW.spotter_tier
    WHEN 'first'   THEN 'First Spotter (≤ 24h)'
    WHEN 'early'   THEN 'Early Spotter (≤ 3d)'
    WHEN 'spotter' THEN 'Spotter (≤ 14d)'
  END;

  PERFORM grant_ap(
    NEW.member_id,
    'early_spotter',
    v_bonus,
    NEW.id,
    NULL,
    NEW.project_id,
    v_note
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vote_grant_spotter_bonus ON public.votes;
CREATE TRIGGER trg_vote_grant_spotter_bonus
  AFTER INSERT ON public.votes
  FOR EACH ROW
  EXECUTE FUNCTION on_vote_grant_spotter_bonus();

-- 5. Backfill spotter_tier on existing votes — best-effort, based on
--    the gap between the vote's created_at and the project's Round-1
--    snapshot. Votes with no Round-1 snapshot stay NULL.
UPDATE public.votes v
   SET spotter_tier = CASE
     WHEN v.created_at <= s.first_initial + INTERVAL '24 hours' THEN 'first'
     WHEN v.created_at <= s.first_initial + INTERVAL '3 days'   THEN 'early'
     WHEN v.created_at <= s.first_initial + INTERVAL '14 days'  THEN 'spotter'
     ELSE NULL
   END
  FROM (
    SELECT project_id, MIN(created_at) AS first_initial
      FROM analysis_snapshots
     WHERE trigger_type = 'initial'
     GROUP BY project_id
  ) s
 WHERE s.project_id = v.project_id
   AND v.spotter_tier IS NULL
   AND v.member_id IS NOT NULL;
