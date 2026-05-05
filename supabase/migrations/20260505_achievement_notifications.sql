-- Achievement notifications · drives the auto-popup share prompt.
--
-- When a creator earns something share-worthy (Encore on any track,
-- spotlight pick, milestone) we drop a notifications row with kind=
-- 'achievement'. Next time they load the site (or in real time via
-- supabase realtime), a small modal pops up with a pre-composed
-- tweet and a "Share on X" button — same intent-based flow we
-- already use elsewhere, just nudged at the right moment.
--
-- This is the strategy doc §4.2 spirit on a shorter rope: no per-
-- user OAuth needed, no auto-post without consent · just a one-tap
-- prompt at the moment the creator is most likely to share. V1.5+
-- can swap the modal's button for a true OAuth auto-post if we want.

-- 1. Extend notifications.kind CHECK.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN ('applaud', 'forecast', 'comment', 'reaudit', 'achievement'));

-- 2. Encore-earned notification · drops a row when an encore is
--    issued. metadata carries the share-template slot values so the
--    client can compose without an extra fetch.
CREATE OR REPLACE FUNCTION public.notify_creator_on_encore()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_id   uuid;
  v_project_name text;
  v_score        int;
BEGIN
  SELECT creator_id, project_name, score_total
    INTO v_creator_id, v_project_name, v_score
    FROM projects WHERE id = NEW.project_id;

  IF v_creator_id IS NULL THEN
    RETURN NEW;   -- walk-on / preview projects · no owner to notify
  END IF;

  INSERT INTO notifications (recipient_id, actor_id, kind, target_type, target_id, project_id, metadata)
  VALUES (
    v_creator_id,
    NULL,
    'achievement',
    'encore',
    NEW.id,
    NEW.project_id,
    jsonb_build_object(
      'subkind',      'encore',
      'encore_kind',  NEW.kind,
      'serial',       NEW.serial,
      'project_name', v_project_name,
      'score',        v_score,
      'earned_score', NEW.earned_score,
      -- Which user_share template the modal should drive · 'graduation'
      -- works for production track ("just hit the bar"), and acts as a
      -- reasonable default for the other 3 tracks until we seed
      -- per-track templates.
      'template_id',  'graduation'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_creator_on_encore ON public.encores;
CREATE TRIGGER trg_notify_creator_on_encore
  AFTER INSERT ON public.encores
  FOR EACH ROW
  EXECUTE FUNCTION notify_creator_on_encore();

-- 3. Backfill · drop an unread achievement notification for every
--    Encore that was issued before this trigger existed. Skips
--    encores whose owner has already deleted their project.
INSERT INTO notifications (recipient_id, actor_id, kind, target_type, target_id, project_id, metadata)
SELECT
  p.creator_id,
  NULL,
  'achievement',
  'encore',
  e.id,
  e.project_id,
  jsonb_build_object(
    'subkind',      'encore',
    'encore_kind',  e.kind,
    'serial',       e.serial,
    'project_name', p.project_name,
    'score',        p.score_total,
    'earned_score', e.earned_score,
    'template_id',  'graduation',
    'backfilled',   true
  )
FROM encores e
JOIN projects p ON p.id = e.project_id
WHERE p.creator_id IS NOT NULL
  -- Don't double-notify if a row was already inserted (e.g. partial
  -- migration replay). Match on (recipient, target_id) since target_id
  -- is the encore.id (unique).
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
     WHERE n.recipient_id = p.creator_id
       AND n.target_id    = e.id
       AND n.kind         = 'achievement'
  );
