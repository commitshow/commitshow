-- Admin · login method visibility on /admin > 사용자 탭.
-- auth.identities is in the auth schema and not exposed to PostgREST,
-- so we expose a SECURITY DEFINER RPC that returns
--   { user_id, providers[] }
-- for every member · admin-gated.

CREATE OR REPLACE FUNCTION public.admin_member_login_methods()
RETURNS TABLE (user_id uuid, providers text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Gate: only admins can call this.
  IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  RETURN QUERY
  SELECT i.user_id, array_agg(DISTINCT i.provider ORDER BY i.provider)
    FROM auth.identities i
   GROUP BY i.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_member_login_methods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_member_login_methods() TO authenticated, service_role;
