-- ───────────────────────────────────────────────────────────────────────────
-- email sync · empty string → NULL · auth.users.email → members.email
-- ───────────────────────────────────────────────────────────────────────────
-- Two cleanups now that X provider is live with the "Request email from
-- users" toggle on:
--
--   (1) handle_new_user wrote new.email as-is. Supabase passes "" (empty
--       string) when the OAuth provider gave no email — that landed in
--       members.email as "" instead of NULL, breaking IS NULL checks
--       elsewhere. Now we normalise via NULLIF.
--
--   (2) sync_x_identity already pulls x_handle / x_provider_id when a user
--       links X. Extend it to also fan auth.users.email → members.email
--       so accounts that linked X *before* the email toggle was on get
--       their address backfilled the first time the sync runs after they
--       sign in again. Same security posture (caller must own the row or
--       be service-role).
-- ───────────────────────────────────────────────────────────────────────────

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
    NULLIF(btrim(COALESCE(new.email, '')), ''),
    COALESCE(
      NULLIF(btrim(new.raw_user_meta_data->>'display_name'), ''),
      NULLIF(btrim(new.raw_user_meta_data->>'preferred_username'), ''),
      NULLIF(btrim(new.raw_user_meta_data->>'name'), ''),
      NULLIF(split_part(COALESCE(new.email, ''), '@', 1), '')
    ),
    new.raw_user_meta_data->>'avatar_url'
  );

  PERFORM public.sync_x_identity(new.id);

  RETURN new;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- sync_x_identity — pull X identity AND email from auth.users / auth.identities
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_x_identity(p_user_id uuid)
RETURNS public.members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_handle      text;
  v_provider_id text;
  v_email       text;
  v_row         public.members;
  v_caller      uuid := auth.uid();
  v_role        text := auth.role();
BEGIN
  IF v_role <> 'service_role' AND (v_caller IS NULL OR v_caller <> p_user_id) THEN
    RAISE EXCEPTION 'Not authorized to sync X identity for another user';
  END IF;

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

  -- Prefer auth.users.email (post-toggle X gives it; for non-X providers
  -- it's set directly). Fall back to per-identity email if present.
  SELECT NULLIF(btrim(COALESCE(email, '')), '') INTO v_email
    FROM auth.users WHERE id = p_user_id;

  IF v_email IS NULL THEN
    SELECT NULLIF(btrim(COALESCE(identity_data->>'email', '')), '')
      INTO v_email
      FROM auth.identities
     WHERE user_id = p_user_id
       AND provider = 'twitter'
     ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF v_handle IS NULL AND v_provider_id IS NULL AND v_email IS NULL THEN
    SELECT * INTO v_row FROM public.members WHERE id = p_user_id;
    RETURN v_row;
  END IF;

  UPDATE public.members
     SET x_handle       = COALESCE(v_handle,      x_handle),
         x_provider_id  = COALESCE(v_provider_id, x_provider_id),
         x_connected_at = COALESCE(x_connected_at, CASE WHEN v_handle IS NOT NULL OR v_provider_id IS NOT NULL THEN now() END),
         email          = COALESCE(v_email, email)
   WHERE id = p_user_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Backfill: any existing members with email='' (Supabase's empty-string
-- placeholder for "OAuth provider returned no email") get NULL. This is a
-- one-shot cleanup of pre-migration rows; new rows go through the
-- normalising trigger above.
UPDATE public.members SET email = NULL WHERE email = '';
