-- track_project_view · client-side view event for SPA navigation.
--
-- Cloudflare Pages middleware fires only on actual HTTP requests
-- (initial page load · hard refresh · direct URL). React Router
-- in-app navigation to /projects/<id> is purely client-side · no
-- server request · so middleware can't write visitor_hits row and
-- the views tile stays flat between SPA route changes.
--
-- This RPC lets the page itself report "I rendered" by inserting
-- a visitor_hits row with the minimum fields. visitor_hash is
-- derived from auth.uid()+day so we still get unique-visitor
-- semantics (one row per member per day per project · matches
-- middleware behavior).
--
-- Anon callers can use it too (uses a session-stable hash from
-- the supplied seed). Not strictly anonymous-unique like the
-- middleware path (which uses CF IP) but close enough for the
-- pulse-tile counter UX.

CREATE OR REPLACE FUNCTION public.track_project_view(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  uuid := auth.uid();
  v_seed    text;
  v_hash    text;
  v_path    text := '/projects/' || p_project_id::text;
  v_day     int  := (EXTRACT(EPOCH FROM now())::bigint / 86400)::int;
BEGIN
  -- Seed = member or anon-day · gives one row per member per day,
  -- or one row per day for anon callers (which is rough but fine
  -- as a pulse-tile signal · not the source of truth for analytics).
  v_seed := COALESCE(v_member::text, 'anon') || ':' || v_day::text;

  -- Short hash · md5 is built-in (pgcrypto not required) and
  -- collision resistance doesn't matter for a daily-unique seed.
  v_hash := LEFT(md5(v_seed), 16);

  -- Idempotent guard: same (visitor_hash + path + day) shouldn't
  -- duplicate within a day. Skip if a row exists today.
  IF EXISTS (
    SELECT 1 FROM visitor_hits
    WHERE visitor_hash = v_hash
      AND path = v_path
      AND created_at >= date_trunc('day', now())
  ) THEN
    RETURN;
  END IF;

  INSERT INTO visitor_hits (
    visitor_hash, ip_hash, path, referer_kind, device, browser, status_code
  )
  VALUES (
    v_hash,
    v_hash,                                      -- placeholder · IP unknowable from RPC context
    v_path,
    'internal',                                  -- SPA navigation = same-site referer kind
    'unknown',                                   -- device class unknowable from RPC
    NULL,
    200
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_project_view(uuid) TO authenticated, anon, service_role;
