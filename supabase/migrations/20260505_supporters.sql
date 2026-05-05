-- Supporters · Vote → Supporter conversion (B-1 Sprint Step 3).
--
-- A vote is a one-time forecast bet, but the strategy doc framing
-- (2026-05-04 Hans review) is: each Scout who votes for a project
-- becomes its *supporter* — a soft, persistent rooting relationship.
-- When the project re-audits, supporters get a notification ("the
-- thing you backed just bumped to 78"). When the project earns Encore,
-- supporters get credit on their profile ("supporting 3 projects · 1
-- reached Encore").
--
-- Implementation:
--   1. supporters table · UNIQUE (supporter_id, project_id) — one row
--      per relationship, denormalized vote_count_total + last_vote_at
--      for cheap profile reads.
--   2. AFTER INSERT trigger on votes upserts the supporters row.
--   3. AFTER INSERT trigger on analysis_snapshots fans out a
--      'reaudit' notification to every supporter (skips the 'initial'
--      snapshot — supporters didn't exist at Round 1).
--   4. notifications.kind CHECK extended with 'reaudit'.

-- 1. Supporters table.
CREATE TABLE IF NOT EXISTS public.supporters (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  supporter_id      uuid          NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  project_id        uuid          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  first_voted_at    timestamptz   NOT NULL DEFAULT now(),
  last_voted_at     timestamptz   NOT NULL DEFAULT now(),
  vote_count_total  int           NOT NULL DEFAULT 0,
  -- Spotter tier of the FIRST vote on this project — drives the
  -- "Early Supporter" badge later. A scout who downgrades from First
  -- to Spotter doesn't lose the original tier.
  first_spotter_tier text         CHECK (first_spotter_tier IN ('first', 'early', 'spotter')),
  UNIQUE (supporter_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_supporters_supporter ON public.supporters(supporter_id, last_voted_at DESC);
CREATE INDEX IF NOT EXISTS idx_supporters_project   ON public.supporters(project_id);

ALTER TABLE public.supporters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supporters_public_read ON public.supporters;
CREATE POLICY supporters_public_read ON public.supporters FOR SELECT USING (true);
GRANT SELECT ON public.supporters TO anon, authenticated;

-- 2. Vote → Supporter upsert trigger.
CREATE OR REPLACE FUNCTION public.upsert_supporter_on_vote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.member_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO supporters (supporter_id, project_id, first_voted_at, last_voted_at, vote_count_total, first_spotter_tier)
  VALUES (NEW.member_id, NEW.project_id, NEW.created_at, NEW.created_at, 1, NEW.spotter_tier)
  ON CONFLICT (supporter_id, project_id) DO UPDATE
     SET last_voted_at    = GREATEST(supporters.last_voted_at, EXCLUDED.last_voted_at),
         vote_count_total = supporters.vote_count_total + 1;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vote_upsert_supporter ON public.votes;
CREATE TRIGGER trg_vote_upsert_supporter
  AFTER INSERT ON public.votes
  FOR EACH ROW
  EXECUTE FUNCTION upsert_supporter_on_vote();

-- 3. Re-audit fan-out · notify supporters on resubmit/weekly snapshots.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN ('applaud', 'forecast', 'comment', 'reaudit'));

CREATE OR REPLACE FUNCTION public.notify_supporters_on_reaudit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_owner uuid;
BEGIN
  -- Initial snapshot has no supporters yet — they appear *after* a vote
  -- happens. season_end snapshots are notified separately by the
  -- season-close engine, not here.
  IF NEW.trigger_type NOT IN ('resubmit', 'weekly') THEN
    RETURN NEW;
  END IF;

  SELECT creator_id INTO v_project_owner FROM projects WHERE id = NEW.project_id;

  INSERT INTO notifications (recipient_id, actor_id, kind, target_type, target_id, project_id, metadata)
  SELECT
    s.supporter_id,
    v_project_owner,                    -- the creator who triggered the re-audit
    'reaudit',
    'project',
    NEW.project_id,
    NEW.project_id,
    jsonb_build_object(
      'snapshot_id',   NEW.id,
      'trigger_type',  NEW.trigger_type,
      'score_total',   NEW.score_total,
      'score_delta',   NEW.score_total_delta
    )
  FROM supporters s
  WHERE s.project_id = NEW.project_id
    AND s.supporter_id <> COALESCE(v_project_owner, '00000000-0000-0000-0000-000000000000'::uuid);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reaudit_notify_supporters ON public.analysis_snapshots;
CREATE TRIGGER trg_reaudit_notify_supporters
  AFTER INSERT ON public.analysis_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION notify_supporters_on_reaudit();

-- 4. Backfill · seed supporters from existing votes (one row per
--    distinct member×project, summed vote_count, earliest first_voted_at,
--    spotter_tier from the FIRST vote).
INSERT INTO supporters (supporter_id, project_id, first_voted_at, last_voted_at, vote_count_total, first_spotter_tier)
SELECT
  v.member_id,
  v.project_id,
  MIN(v.created_at)                                      AS first_voted_at,
  MAX(v.created_at)                                      AS last_voted_at,
  COUNT(*)::int                                          AS vote_count_total,
  (ARRAY_AGG(v.spotter_tier ORDER BY v.created_at ASC))[1] AS first_spotter_tier
FROM votes v
WHERE v.member_id IS NOT NULL
GROUP BY v.member_id, v.project_id
ON CONFLICT (supporter_id, project_id) DO NOTHING;
