-- encore-auto-tweet · fire @commitshow trajectory tweet on production encore.
--
-- Triggers off encores AFTER INSERT, kind='production' only. Streak /
-- climb / spotlight get their own milestone cards in V1.5+ (per
-- §11-NEW.2.1) so we keep this firing narrow for now — one auto-tweet
-- per project graduation, not four.
--
-- The actual eligibility gates (score ≥ 85, status != 'preview',
-- 14d cooldown, social_share_disabled = false) live in the auto-tweet
-- Edge Function. This trigger just hands off the project_id +
-- kind='trajectory' and lets that function decide whether to post.
--
-- Reuses the _email_dispatch_config singleton for the supabase_url +
-- service_role_key — same auth pattern the email pipeline uses, no
-- new secrets table to provision.
--
-- Trigger is fire-and-forget via pg_net.http_post; a slow X API never
-- blocks the encore INSERT transaction.

CREATE OR REPLACE FUNCTION public.fire_trajectory_tweet_on_encore()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  v_config record;
BEGIN
  -- Production encore only · the graduation moment. Other encore kinds
  -- (streak / climb / spotlight) earn separate milestone cards.
  IF NEW.kind <> 'production' THEN
    RETURN NEW;
  END IF;

  SELECT supabase_url, service_role_key INTO v_config
  FROM public._email_dispatch_config
  WHERE id = 1;

  IF v_config IS NULL OR v_config.service_role_key IS NULL OR v_config.supabase_url IS NULL THEN
    -- Dev / unconfigured env · skip silently. Encore insert must not
    -- fail just because tweet wiring isn't set up.
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_config.supabase_url || '/functions/v1/auto-tweet',
    headers := jsonb_build_object(
      'apikey',        v_config.service_role_key,
      'Authorization', 'Bearer ' || v_config.service_role_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'project_id', NEW.project_id,
      'kind',       'trajectory'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fire_trajectory_tweet_on_encore ON public.encores;
CREATE TRIGGER trg_fire_trajectory_tweet_on_encore
  AFTER INSERT ON public.encores
  FOR EACH ROW
  EXECUTE FUNCTION public.fire_trajectory_tweet_on_encore();
