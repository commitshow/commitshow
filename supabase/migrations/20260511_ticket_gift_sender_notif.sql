-- ticket gifting · sender-side notification (kind = 'ticket_gift_sent').
--
-- v1 of gift_tickets only inserted a recipient notification. Sender
-- saw a one-shot "Sent!" step inside the dialog but no persistent
-- record · the bell stayed quiet. User feedback: 'I don't get a
-- notification when my gift was received.'
--
-- v2: insert a second notification on the SENDER side too with
-- kind='ticket_gift_sent'. Recipient-side celebration modal
-- (TicketGiftCelebration) listens for kind='ticket_gift' only, so
-- the sender's notification doesn't trigger the centered popup —
-- it just lives in the bell.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('applaud', 'forecast', 'comment', 'reaudit', 'ticket_gift', 'ticket_gift_sent'));

-- Extend the gift_tickets RPC. Same atomic flow, just one extra
-- INSERT for the sender record. Both notifications share the same
-- ticket_gift_id target so they can cross-reference if needed.

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
  v_recipient_name   text;
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

  SELECT EXISTS(SELECT 1 FROM members WHERE id = p_recipient_id), m.display_name
    INTO v_recipient_exists, v_recipient_name
    FROM members m WHERE m.id = p_recipient_id;
  IF NOT COALESCE(v_recipient_exists, FALSE) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'recipient_not_found');
  END IF;

  SELECT paid_audits_credit INTO v_sender_credit
    FROM members WHERE id = v_sender_id;
  IF v_sender_credit IS NULL OR v_sender_credit < p_quantity THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_credit',
                              'available', COALESCE(v_sender_credit, 0));
  END IF;

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

  UPDATE members SET paid_audits_credit = paid_audits_credit - p_quantity
   WHERE id = v_sender_id AND paid_audits_credit >= p_quantity;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_credit');
  END IF;

  UPDATE members SET paid_audits_credit = paid_audits_credit + p_quantity
   WHERE id = p_recipient_id;

  INSERT INTO ticket_gifts (sender_id, recipient_id, quantity, message)
  VALUES (v_sender_id, p_recipient_id, p_quantity, NULLIF(p_message, ''))
  RETURNING id INTO v_gift_id;

  -- Recipient notification · "{actor} gifted you N audition ticket(s)"
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

  -- Sender notification · "Your gift of N ticket(s) was delivered to {recipient}".
  -- actor_id is the RECIPIENT here (so the bell's actor avatar shows
  -- who got the gift, which is the more meaningful face from the
  -- sender's perspective). Recipient display_name surfaced via the
  -- existing notification_feed join through actor_id.
  INSERT INTO notifications (recipient_id, actor_id, kind, target_type, target_id, metadata)
  VALUES (
    v_sender_id,
    p_recipient_id,
    'ticket_gift_sent',
    'ticket_gift',
    v_gift_id,
    jsonb_build_object(
      'quantity',       p_quantity,
      'recipient_name', v_recipient_name,
      'message',        NULLIF(p_message, '')
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
