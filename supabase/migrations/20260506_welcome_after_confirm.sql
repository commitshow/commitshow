-- Move the welcome email from "members INSERT" to "auth.users
-- email_confirmed_at transitions to non-NULL". Currently the welcome
-- mail goes out immediately on signup — the confirmation email and
-- welcome email arrive together, which is confusing and pollutes
-- inboxes for users who never confirm.
--
-- New behavior:
--   · Email + password signup     → confirmation only on signup;
--                                    welcome fires when the user clicks
--                                    confirm and email_confirmed_at
--                                    flips from NULL to a timestamp.
--   · OAuth (Google, GitHub, X, …) → email_confirmed_at is set on the
--                                    INSERT itself, so welcome fires
--                                    immediately as before.
--
-- Trigger ordering: on_auth_user_created (handle_new_user) runs before
-- trg_welcome_on_confirm because Postgres fires same-event triggers in
-- alphabetical order — by then public.members has the new row, so the
-- welcome dispatcher can read display_name from it.

-- 1) Drop the old members-INSERT trigger.
DROP TRIGGER IF EXISTS trg_dispatch_welcome ON public.members;

-- 2) Re-aim the dispatcher at auth.users.
CREATE OR REPLACE FUNCTION public.dispatch_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name text;
BEGIN
  -- Only fire when email_confirmed_at gains a value.
  IF NOT (
       (TG_OP = 'INSERT' AND NEW.email_confirmed_at IS NOT NULL)
    OR (TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NULL
                          AND NEW.email_confirmed_at IS NOT NULL)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_display_name
    FROM public.members
   WHERE id = NEW.id;

  PERFORM public.dispatch_email(
    'welcome',
    NEW.id,
    jsonb_build_object(
      'display_name', COALESCE(v_display_name, 'there'),
      'member_id',    NEW.id::text
    ),
    -- dedupe on user id alone · a user only ever gets ONE welcome
    -- regardless of how many times email_confirmed_at gets touched.
    'once'
  );
  RETURN NEW;
END;
$$;

-- 3) Wire to auth.users (INSERT for OAuth, UPDATE OF email_confirmed_at
--    for email-password signup confirm clicks).
DROP TRIGGER IF EXISTS trg_welcome_on_confirm ON auth.users;
CREATE TRIGGER trg_welcome_on_confirm
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_welcome_email();
