-- Audition ticket gifting · member-to-member transfer.
--
-- A member can send N audition tickets from their paid_audits_credit
-- balance to another member. Sender's credit decrements, recipient's
-- increments, and a notification fires for the recipient.
--
-- Free tickets (the 3-per-member quota) are NOT giftable — they're
-- a per-account intro grant, not transferrable. Only paid_audits_credit
-- can be sent.
--
-- Daily limits prevent farming/abuse:
--   · max 5 gift transactions per sender per day
--   · max 20 tickets gifted per sender per day
-- These are runtime-enforced by the RPC.

-- ── ticket_gifts · permanent audit log ──────────────────────────
CREATE TABLE IF NOT EXISTS public.ticket_gifts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id     uuid NOT NULL REFERENCES public.members(id) ON DELETE SET NULL,
  recipient_id  uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  quantity      int  NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  message       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_gifts_sender_created
  ON public.ticket_gifts (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_gifts_recipient_created
  ON public.ticket_gifts (recipient_id, created_at DESC);

ALTER TABLE public.ticket_gifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own ticket_gifts" ON public.ticket_gifts;
CREATE POLICY "members read own ticket_gifts"
  ON public.ticket_gifts
  FOR SELECT
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

GRANT SELECT ON public.ticket_gifts TO authenticated;

-- ── notifications.kind extension ────────────────────────────────
-- Allow 'ticket_gift' as a notification kind.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('applaud', 'forecast', 'comment', 'reaudit', 'ticket_gift'));

-- ── gift_tickets RPC ────────────────────────────────────────────
-- Atomic transfer:
--   1. Verify caller = auth.uid() (sender)
--   2. Recipient ≠ sender (no self-gift)
--   3. Sender has paid_audits_credit ≥ quantity
--   4. Daily limits: ≤ 5 transactions, ≤ 20 tickets/day
--   5. Decrement sender, increment recipient
--   6. Insert ticket_gifts row
--   7. Insert notification for recipient

CREATE OR REPLACE FUNCTION public.gift_tickets(
  p_recipient_id uuid,
  p_quantity     int,
  p_message      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_id        uuid := auth.uid();
  v_sender_credit    int;
  v_recipient_exists boolean;
  v_today_tx_count   int;
  v_today_qty_total  int;
  v_gift_id          uuid;
BEGIN
  IF v_sender_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF p_recipient_id IS NULL OR p_recipient_id = v_sender_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_recipient');
  END IF;

  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_quantity');
  END IF;

  -- Recipient must exist
  SELECT EXISTS(SELECT 1 FROM members WHERE id = p_recipient_id)
    INTO v_recipient_exists;
  IF NOT v_recipient_exists THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'recipient_not_found');
  END IF;

  -- Sender must have enough credit
  SELECT paid_audits_credit INTO v_sender_credit
    FROM members WHERE id = v_sender_id;
  IF v_sender_credit IS NULL OR v_sender_credit < p_quantity THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_credit',
                              'available', COALESCE(v_sender_credit, 0));
  END IF;

  -- Daily abuse limits · 5 transactions, 20 tickets total per day
  SELECT COUNT(*), COALESCE(SUM(quantity), 0)
    INTO v_today_tx_count, v_today_qty_total
    FROM ticket_gifts
   WHERE sender_id = v_sender_id
     AND created_at >= (now() - interval '24 hours');

  IF v_today_tx_count >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_tx_limit',
                              'limit', 5, 'used', v_today_tx_count);
  END IF;
  IF v_today_qty_total + p_quantity > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_qty_limit',
                              'limit', 20, 'used', v_today_qty_total);
  END IF;

  -- Atomic transfer
  UPDATE members SET paid_audits_credit = paid_audits_credit - p_quantity
   WHERE id = v_sender_id AND paid_audits_credit >= p_quantity;
  IF NOT FOUND THEN
    -- Race · credit was spent between check and update
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_credit');
  END IF;

  UPDATE members SET paid_audits_credit = paid_audits_credit + p_quantity
   WHERE id = p_recipient_id;

  -- Audit log
  INSERT INTO ticket_gifts (sender_id, recipient_id, quantity, message)
  VALUES (v_sender_id, p_recipient_id, p_quantity, NULLIF(p_message, ''))
  RETURNING id INTO v_gift_id;

  -- Notification · "{actor} gifted you N audition ticket(s)"
  INSERT INTO notifications (recipient_id, actor_id, kind, target_type, target_id, metadata)
  VALUES (
    p_recipient_id,
    v_sender_id,
    'ticket_gift',
    'ticket_gift',
    v_gift_id,
    jsonb_build_object(
      'quantity', p_quantity,
      'message',  NULLIF(p_message, '')
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'gift_id', v_gift_id,
    'sender_remaining', v_sender_credit - p_quantity,
    'sent', p_quantity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.gift_tickets(uuid, int, text) TO authenticated;

-- ── search_members RPC · for the gift recipient picker ──────────
-- Lightweight prefix/contains search across display_name + email
-- prefix. Excludes the caller (no self-gift) and members without
-- a display_name set (fresh signups). Returns up to 20 rows.
CREATE OR REPLACE FUNCTION public.search_members(p_query text, p_limit int DEFAULT 8)
RETURNS TABLE (
  id            uuid,
  display_name  text,
  avatar_url    text,
  creator_grade text,
  tier          text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (SELECT lower(trim(p_query)) AS s)
  SELECT m.id, m.display_name, m.avatar_url, m.creator_grade, m.tier::text
  FROM members m, q
  WHERE m.display_name IS NOT NULL
    AND length(q.s) >= 2
    AND m.id <> auth.uid()
    AND lower(m.display_name) LIKE q.s || '%'   -- prefix match preferred
  ORDER BY m.activity_points DESC NULLS LAST, m.created_at ASC
  LIMIT GREATEST(1, LEAST(20, p_limit));
$$;

GRANT EXECUTE ON FUNCTION public.search_members(text, int) TO authenticated;
