-- ───────────────────────────────────────────────────────────────────────────
-- X (Twitter) OAuth identity · members.x_handle + sync helper
-- ───────────────────────────────────────────────────────────────────────────
-- CLAUDE.md §18-B specifies X OAuth as a sign-in option AND a profile-level
-- connection — and a "verified by X" badge once the link is set. This
-- migration is the storage + reconcile layer:
--
--   1. members.x_handle           — denormalized screen name (e.g. "k_ceo")
--   2. members.x_provider_id      — stable X user id (the canonical key)
--   3. members.x_connected_at     — first-link timestamp
--
-- Two write paths:
--
--   · handle_new_user · runs on a brand-new auth.users INSERT. If the
--     signup came from the Twitter OAuth provider, we sync x_handle right
--     after the row lands.
--
--   · sync_x_identity(uuid) RPC · called from the frontend after an
--     existing member adds X via Supabase's identity-link flow (click
--     "Connect X" on the profile page · redirected to OAuth · returned).
--     Idempotent · runs on every link/relink without clobbering an
--     already-set x_connected_at.
--
-- Disconnect path: a separate disconnect_x_identity() RPC clears the
-- columns. Removing the X identity from auth.users itself is a Supabase-
-- admin operation we do client-side via supabase.auth.unlinkIdentity().
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS x_handle       text,
  ADD COLUMN IF NOT EXISTS x_provider_id  text,
  ADD COLUMN IF NOT EXISTS x_connected_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_members_x_provider_id
  ON public.members (x_provider_id)
  WHERE x_provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_members_x_handle
  ON public.members (lower(x_handle))
  WHERE x_handle IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- sync_x_identity(p_user_id) — pull X identity from auth.users into members.
-- ───────────────────────────────────────────────────────────────────────────
-- Reads from auth.users (privileged) so it has to be SECURITY DEFINER. The
-- caller can only update their OWN row — guarded by an auth.uid() check
-- that matches p_user_id. Service-role JWT bypasses the check (used by
-- handle_new_user and admin tools).
--
-- Where Twitter OAuth metadata lives in Supabase Auth:
--   raw_user_meta_data → { preferred_username, user_name, name, ... }
--   user identity row in auth.identities, identity_data → {
--      provider_id, screen_name (legacy), preferred_username, sub, ...
--   } where provider='twitter'.
--
-- We prefer auth.identities (provider-scoped) over raw_user_meta_data
-- (last-wins) so a user who later signs in with Google doesn't blank their
-- X handle.
CREATE OR REPLACE FUNCTION public.sync_x_identity(p_user_id uuid)
RETURNS public.members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_handle      text;
  v_provider_id text;
  v_row         public.members;
  v_caller      uuid := auth.uid();
  v_role        text := auth.role();
BEGIN
  -- Auth gate: caller must be either service-role OR linking their own row.
  IF v_role <> 'service_role' AND (v_caller IS NULL OR v_caller <> p_user_id) THEN
    RAISE EXCEPTION 'Not authorized to sync X identity for another user';
  END IF;

  -- Pull from auth.identities · provider-scoped, survives multi-provider users.
  SELECT
    COALESCE(
      identity_data->>'preferred_username',
      identity_data->>'user_name',
      identity_data->>'screen_name'
    ),
    COALESCE(
      identity_data->>'provider_id',
      identity_data->>'sub',
      identity_data->>'id'
    )
    INTO v_handle, v_provider_id
    FROM auth.identities
   WHERE user_id = p_user_id
     AND provider = 'twitter'
   ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
   LIMIT 1;

  IF v_handle IS NULL AND v_provider_id IS NULL THEN
    -- No twitter identity present · nothing to sync. Don't clobber existing data.
    SELECT * INTO v_row FROM public.members WHERE id = p_user_id;
    RETURN v_row;
  END IF;

  UPDATE public.members
     SET x_handle       = COALESCE(v_handle,      x_handle),
         x_provider_id  = COALESCE(v_provider_id, x_provider_id),
         x_connected_at = COALESCE(x_connected_at, now())
   WHERE id = p_user_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_x_identity(uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- disconnect_x_identity(p_user_id) — clear the columns.
-- ───────────────────────────────────────────────────────────────────────────
-- Mirror of sync_x_identity but for unlinking. The actual auth.identities
-- row removal goes through supabase.auth.unlinkIdentity() in the client;
-- this RPC just clears the denormalized columns on members.
CREATE OR REPLACE FUNCTION public.disconnect_x_identity(p_user_id uuid)
RETURNS public.members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    public.members;
  v_caller uuid := auth.uid();
  v_role   text := auth.role();
BEGIN
  IF v_role <> 'service_role' AND (v_caller IS NULL OR v_caller <> p_user_id) THEN
    RAISE EXCEPTION 'Not authorized to disconnect X for another user';
  END IF;

  UPDATE public.members
     SET x_handle       = NULL,
         x_provider_id  = NULL,
         x_connected_at = NULL
   WHERE id = p_user_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.disconnect_x_identity(uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- handle_new_user — auto-populate x_handle when signup uses X OAuth
-- ───────────────────────────────────────────────────────────────────────────
-- Existing trigger already inserts a `members` row from new auth.users;
-- this version additionally calls sync_x_identity if the signup happened
-- via the twitter provider.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.members (id, email, display_name, avatar_url)
  VALUES (
    new.id,
    new.email,
    COALESCE(
      NULLIF(btrim(new.raw_user_meta_data->>'display_name'), ''),
      NULLIF(btrim(new.raw_user_meta_data->>'preferred_username'), ''),
      NULLIF(btrim(new.raw_user_meta_data->>'name'), ''),
      split_part(COALESCE(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  );

  -- If signed up via X OAuth, the auth.identities row for provider='twitter'
  -- should already exist by the time this fires. Try syncing — sync_x_identity
  -- is no-op if there's no twitter identity yet.
  PERFORM public.sync_x_identity(new.id);

  RETURN new;
END;
$$;
