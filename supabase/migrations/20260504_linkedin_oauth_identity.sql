-- ───────────────────────────────────────────────────────────────────────────
-- LinkedIn OAuth identity · members.linkedin_handle + sync helper
-- ───────────────────────────────────────────────────────────────────────────
-- Mirror of 20260502_x_oauth_identity.sql for LinkedIn (provider key
-- 'linkedin_oidc' in Supabase Auth · OpenID Connect surface). Adds the
-- denormalized handle + provider id columns and the SECURITY DEFINER
-- sync RPC the frontend calls after every signin/link cycle.
--
-- LinkedIn OIDC metadata layout (raw_user_meta_data + auth.identities
-- identity_data):
--   sub                 — stable LinkedIn member URN (canonical key)
--   name / given_name + family_name
--   preferred_username  — the "vanity" URL slug (linkedin.com/in/<slug>)
--   picture             — profile picture URL
--   email / email_verified
--
-- We store:
--   linkedin_handle       → preferred_username (the /in/<slug> path)
--   linkedin_provider_id  → sub
--   linkedin_connected_at → first-link timestamp
--
-- Disconnect: separate RPC clears the columns. Unlinking the LinkedIn
-- identity itself is a client-side supabase.auth.unlinkIdentity() call.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS linkedin_handle       text,
  ADD COLUMN IF NOT EXISTS linkedin_provider_id  text,
  ADD COLUMN IF NOT EXISTS linkedin_connected_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_members_linkedin_provider_id
  ON public.members (linkedin_provider_id)
  WHERE linkedin_provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_members_linkedin_handle
  ON public.members (lower(linkedin_handle))
  WHERE linkedin_handle IS NOT NULL;

-- members table uses column-level GRANT SELECT (privacy pattern hiding
-- email). New columns must be granted explicitly or every PostgREST
-- read that includes them returns 42501 — same class of bug as
-- 20260430_ladder_column_grants.sql, 20260503_paid_audits_credit_grant.sql,
-- and 20260503_member_oauth_handle_grants.sql.
GRANT SELECT (
  linkedin_handle,
  linkedin_provider_id,
  linkedin_connected_at
) ON public.members TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- sync_linkedin_identity(p_user_id) — pull LinkedIn identity into members.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_linkedin_identity(p_user_id uuid)
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
    RAISE EXCEPTION 'Not authorized to sync LinkedIn identity for another user';
  END IF;

  -- Pull from auth.identities · LinkedIn OIDC stores fields under
  -- identity_data with the OIDC standard claim names.
  SELECT
    COALESCE(
      identity_data->>'preferred_username',
      identity_data->>'vanityName',
      identity_data->>'name'
    ),
    COALESCE(
      identity_data->>'sub',
      identity_data->>'provider_id',
      identity_data->>'id'
    )
    INTO v_handle, v_provider_id
    FROM auth.identities
   WHERE user_id = p_user_id
     AND provider = 'linkedin_oidc'
   ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
   LIMIT 1;

  IF v_handle IS NULL AND v_provider_id IS NULL THEN
    -- No linkedin identity present · nothing to sync. Don't clobber.
    SELECT * INTO v_row FROM public.members WHERE id = p_user_id;
    RETURN v_row;
  END IF;

  UPDATE public.members
     SET linkedin_handle       = COALESCE(v_handle,      linkedin_handle),
         linkedin_provider_id  = COALESCE(v_provider_id, linkedin_provider_id),
         linkedin_connected_at = COALESCE(linkedin_connected_at, now())
   WHERE id = p_user_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_linkedin_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_linkedin_identity(uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- disconnect_linkedin_identity(p_user_id) — clear the columns.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.disconnect_linkedin_identity(p_user_id uuid)
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
    RAISE EXCEPTION 'Not authorized to disconnect LinkedIn identity for another user';
  END IF;

  UPDATE public.members
     SET linkedin_handle       = NULL,
         linkedin_provider_id  = NULL,
         linkedin_connected_at = NULL
   WHERE id = p_user_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.disconnect_linkedin_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disconnect_linkedin_identity(uuid) TO authenticated, service_role;
