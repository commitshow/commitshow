-- Bulk audit-fee purchase support.
--
-- Until now each `audit_fee` payment row was treated as +1 ticket — the
-- payments_sync_audit_credit trigger granted exactly one credit on
-- success, revoked one on refund. Bulk purchase means a single Stripe
-- session can buy N tickets at once (1-10 per checkout) so the trigger
-- needs to read the actual count from the payment row.
--
-- New column: payments.quantity int (default 1, check 1..10). Existing
-- rows are stamped quantity=1 by the default + backfill.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS quantity int NOT NULL DEFAULT 1
                                              CHECK (quantity BETWEEN 1 AND 10);

-- Backfill any pre-existing rows in case the default didn't apply
-- (DEFAULT covers new rows only on add — but the IF NOT EXISTS path
-- might have skipped the default backfill on some Postgres versions).
UPDATE public.payments SET quantity = 1 WHERE quantity IS NULL;

-- Replace the trigger to honor quantity. Same lifecycle (succeeded
-- grants · refunded revokes), just N at a time.
CREATE OR REPLACE FUNCTION public.payments_sync_audit_credit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_qty int;
BEGIN
  -- Only audit_fee payments touch the credit counter.
  IF COALESCE(NEW.kind, OLD.kind) <> 'audit_fee' THEN
    RETURN NEW;
  END IF;

  v_qty := COALESCE(NEW.quantity, 1);

  -- Status went pending/anything → succeeded · grant N credits.
  IF (TG_OP = 'INSERT' AND NEW.status = 'succeeded') OR
     (TG_OP = 'UPDATE' AND OLD.status <> 'succeeded' AND NEW.status = 'succeeded') THEN
    UPDATE public.members
       SET paid_audits_credit = paid_audits_credit + v_qty
     WHERE id = NEW.member_id;
  END IF;

  -- Status went succeeded → refunded · revoke up to N credits, floor 0.
  -- We can't tell which specific credits were redeemed already, so we
  -- revoke the whole quantity but never go below 0 (some may have been
  -- spent on auditions before the refund).
  IF TG_OP = 'UPDATE' AND OLD.status = 'succeeded' AND NEW.status = 'refunded' THEN
    UPDATE public.members
       SET paid_audits_credit = GREATEST(0, paid_audits_credit - v_qty)
     WHERE id = NEW.member_id;
  END IF;

  RETURN NEW;
END;
$$;
