-- Drop the 4-arg dispatch_email overload that 20260505_email_dispatch_override.sql
-- left in place when it added the 5-arg version. Keeping both made every
-- 3-arg call (welcome trigger, future welcome-likes) ambiguous —
-- PostgreSQL throws "function dispatch_email(unknown, uuid, jsonb) is
-- not unique" and the entire transaction rolls back. Auth signup runs
-- the welcome trigger inline, so the rollback cascaded into a failed
-- auth.users INSERT — every Google + email signup since 2026-05-05
-- has been crashing with a generic error in the client.
--
-- The 5-arg version is a strict superset of the 4-arg (the new
-- p_recipient_addr_override defaults to NULL → identical behavior to
-- the old form when omitted), so dropping the 4-arg is safe.

DROP FUNCTION IF EXISTS public.dispatch_email(text, uuid, jsonb, text);

-- Sanity check · 3-arg call now resolves unambiguously.
DO $$
BEGIN
  PERFORM dispatch_email('welcome', '00000000-0000-0000-0000-000000000000'::uuid, '{}'::jsonb);
EXCEPTION WHEN OTHERS THEN
  -- The recipient uuid is a placeholder · we expect "no auth.users row
  -- with that id" / "template not found" / etc. — but NOT the
  -- ambiguity error. Re-raise only if it looks like the bug came back.
  IF SQLERRM ILIKE '%not unique%' OR SQLERRM ILIKE '%could not choose%' THEN
    RAISE;
  END IF;
END $$;
