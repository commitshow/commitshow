-- ticket_balance(p_member_id) caller check.
--
-- The original v1 of this RPC (20260511_backstage_status.sql) accepted
-- any p_member_id and returned the corresponding member's ticket
-- balance. Verification audit flagged this as low-severity info leak —
-- ticket counts aren't sensitive, but caller=target is the cleaner
-- contract (matches audition_project's auth.uid() ownership check).
--
-- Force the caller to be the target so a logged-in user can only read
-- their own balance. Service role bypasses RLS but also bypasses this
-- check because auth.uid() is null in the service-role context — to
-- preserve worker access (e.g. an admin tool needing arbitrary
-- members' balances) we still allow the call when auth.uid() is null.

CREATE OR REPLACE FUNCTION public.ticket_balance(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_free_quota   int := 3;
  v_prior_active int;
  v_credit       int;
BEGIN
  -- Caller=target enforcement. Only authenticated callers reading
  -- their OWN balance get a result. Anonymous service-role callers
  -- (auth.uid() IS NULL) keep arbitrary access for ops/admin.
  IF v_caller IS NOT NULL AND v_caller <> p_member_id THEN
    RETURN jsonb_build_object('error', 'caller_target_mismatch');
  END IF;

  SELECT COUNT(*) INTO v_prior_active
  FROM projects
  WHERE creator_id = p_member_id
    AND status IN ('active', 'graduated', 'valedictorian', 'retry');

  SELECT paid_audits_credit INTO v_credit FROM members WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'free_remaining', GREATEST(0, v_free_quota - v_prior_active),
    'paid_credit',    COALESCE(v_credit, 0),
    'total_tickets',  GREATEST(0, v_free_quota - v_prior_active) + COALESCE(v_credit, 0),
    'free_quota',     v_free_quota,
    'prior_active',   v_prior_active
  );
END;
$$;
