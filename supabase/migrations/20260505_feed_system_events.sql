-- Activity Feed system cards · strategy doc §5.3.
--
-- The /community feed already shows system comments for `registered`
-- and `score_jump` events. This migration adds the remaining 3 event
-- kinds the strategy doc calls out as Day-1 cards:
--
--   forecast      — Scout cast a forecast on a project
--   encore        — project earned an Encore on any of the 4 tracks
--   library       — a creator published an artifact to the Library
--
-- Each lands as a comments row (kind='system', member_id=NULL) on the
-- relevant project. The CommunityFeedPage already detects system rows
-- via member_id IS NULL OR kind='system' and renders them as the CS
-- branded card, so no client-side work is needed for these cards to
-- show up — they just appear in the feed.
--
-- The remaining 2 strategy cards (Climb of the Day / Frame Spotlight)
-- are scheduled rituals — pg_cron territory — and stay deferred per
-- the "Cron is the last thing we ship" memory.

-- Helper · pulls a member's display_name with a stable fallback so
-- the card text never reads "null forecasted maa 80".
CREATE OR REPLACE FUNCTION public._feed_member_label(p_member_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(display_name, 'A scout') FROM members WHERE id = p_member_id;
$$;

-- 1. Forecast event · INSERT system comment when a vote is cast.
CREATE OR REPLACE FUNCTION public.feed_event_forecast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       text;
  v_score       int;
  v_text        text;
BEGIN
  IF NEW.member_id IS NULL OR NEW.predicted_score IS NULL THEN
    RETURN NEW;
  END IF;

  v_actor := _feed_member_label(NEW.member_id);
  v_score := NEW.predicted_score;

  -- Spotter tier flavor — First/Early Spotter get extra emphasis since
  -- those are the heirloom rows. Plain Spotter and post-window casts
  -- get the muted line. Vote count >1 means a ×N conviction pile.
  v_text := CASE NEW.spotter_tier
    WHEN 'first'   THEN format('★ First Spotter · %s called %s/100 within 24h.',          v_actor, v_score)
    WHEN 'early'   THEN format('Early Spotter · %s forecasts %s/100.',                    v_actor, v_score)
    WHEN 'spotter' THEN format('%s forecasts %s/100.',                                    v_actor, v_score)
    ELSE                format('%s called %s/100.',                                       v_actor, v_score)
  END;

  IF NEW.vote_count > 1 THEN
    v_text := v_text || format(' (×%s conviction)', NEW.vote_count);
  END IF;

  INSERT INTO comments (project_id, member_id, text, kind, event_kind, event_meta)
  VALUES (
    NEW.project_id,
    NULL,
    v_text,
    'system',
    'forecast',
    jsonb_build_object(
      'vote_id',        NEW.id,
      'predicted',      NEW.predicted_score,
      'spotter_tier',   NEW.spotter_tier,
      'vote_count',     NEW.vote_count,
      'actor_member_id', NEW.member_id
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_event_forecast ON public.votes;
CREATE TRIGGER trg_feed_event_forecast
  AFTER INSERT ON public.votes
  FOR EACH ROW
  EXECUTE FUNCTION feed_event_forecast();

-- 2. Encore event · INSERT system comment on each Encore issued.
CREATE OR REPLACE FUNCTION public.feed_event_encore()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind_label text;
  v_symbol     text;
  v_why        text;
  v_text       text;
BEGIN
  -- Mirror the kind metadata in src/lib/encore.ts so the feed reads
  -- the same as the badge.
  v_kind_label := CASE NEW.kind
    WHEN 'production' THEN 'Encore'
    WHEN 'streak'     THEN 'Streak Encore'
    WHEN 'climb'      THEN 'Climb Encore'
    WHEN 'spotlight'  THEN 'Spotlight Encore'
    ELSE                   'Encore'
  END;
  v_symbol := CASE NEW.kind
    WHEN 'production' THEN '★'
    WHEN 'streak'     THEN '⟳'
    WHEN 'climb'      THEN '↗'
    WHEN 'spotlight'  THEN '✦'
    ELSE                   '★'
  END;
  v_why := CASE NEW.kind
    WHEN 'production' THEN 'score crossed 85'
    WHEN 'streak'     THEN 'sustained quality'
    WHEN 'climb'      THEN 'biggest leap from Round 1'
    WHEN 'spotlight'  THEN 'community-driven pick'
    ELSE                   'gate cleared'
  END;

  v_text := format('%s %s #%s earned · %s.', v_symbol, v_kind_label, NEW.serial, v_why);

  INSERT INTO comments (project_id, member_id, text, kind, event_kind, event_meta)
  VALUES (
    NEW.project_id,
    NULL,
    v_text,
    'system',
    'encore',
    jsonb_build_object(
      'encore_id',    NEW.id,
      'encore_kind',  NEW.kind,
      'serial',       NEW.serial,
      'earned_score', NEW.earned_score,
      'earned_meta',  NEW.earned_meta
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_event_encore ON public.encores;
CREATE TRIGGER trg_feed_event_encore
  AFTER INSERT ON public.encores
  FOR EACH ROW
  EXECUTE FUNCTION feed_event_encore();

-- 3. Library publish event · INSERT system comment when an artifact
--    transitions to published. Skips updates to other fields so a
--    re-edit doesn't spam the feed.
CREATE OR REPLACE FUNCTION public.feed_event_library_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      text;
  v_format     text;
  v_text       text;
  v_project_id uuid;
BEGIN
  -- Only fire when status flips into a published state. Library rows
  -- not tied to a project still need a "home" for the comment — fall
  -- back to the artifact's linked_project_id; if there's none, skip.
  IF (TG_OP = 'UPDATE' AND OLD.status = NEW.status) THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('published', 'live') THEN
    RETURN NEW;
  END IF;

  v_project_id := NEW.linked_project_id;
  IF v_project_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_actor := _feed_member_label(NEW.creator_id);
  v_format := CASE NEW.target_format
    WHEN 'mcp_config'    THEN 'MCP Config'
    WHEN 'ide_rules'     THEN 'IDE Rules'
    WHEN 'agent_skill'   THEN 'Agent Skill'
    WHEN 'project_rules' THEN 'Project Rules'
    WHEN 'prompt_pack'   THEN 'Prompt Pack'
    WHEN 'patch_recipe'  THEN 'Patch Recipe'
    WHEN 'scaffold'      THEN 'Scaffold'
    ELSE                      'Artifact'
  END;
  v_text := format('%s published "%s" · %s.', v_actor, NEW.title, v_format);

  INSERT INTO comments (project_id, member_id, text, kind, event_kind, event_meta)
  VALUES (
    v_project_id,
    NULL,
    v_text,
    'system',
    'library_publish',
    jsonb_build_object(
      'md_id',           NEW.id,
      'target_format',   NEW.target_format,
      'title',           NEW.title,
      'actor_member_id', NEW.creator_id
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_event_library_publish ON public.md_library;
CREATE TRIGGER trg_feed_event_library_publish
  AFTER INSERT OR UPDATE OF status ON public.md_library
  FOR EACH ROW
  EXECUTE FUNCTION feed_event_library_publish();
