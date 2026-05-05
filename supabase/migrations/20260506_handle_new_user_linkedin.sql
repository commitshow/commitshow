-- handle_new_user wires sync_x_identity + sync_github_identity but
-- forgets sync_linkedin_identity. Effect: a fresh signup via LinkedIn
-- OAuth lands a members row with all linkedin_* columns NULL, even
-- though auth.identities has the LinkedIn identity row. The user
-- can later trigger a sync via the /me account-link UI, but the
-- first paint of /me / /scouts/:id / /creators/:id misses their
-- LinkedIn handle. Adding the call closes the gap.
--
-- All three sync_* functions are SECURITY DEFINER + tolerate the
-- "no identity row" case by no-oping, so the call is safe even when
-- the user signed up via Google or email.

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
      NULLIF(btrim(new.raw_user_meta_data->>'user_name'), ''),
      NULLIF(btrim(new.raw_user_meta_data->>'name'), ''),
      NULLIF(split_part(COALESCE(new.email, ''), '@', 1), '')
    ),
    new.raw_user_meta_data->>'avatar_url'
  );

  PERFORM public.sync_x_identity(new.id);
  PERFORM public.sync_github_identity(new.id);
  PERFORM public.sync_linkedin_identity(new.id);

  RETURN new;
END;
$$;
