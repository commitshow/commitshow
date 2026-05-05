-- Founder pricing — strategy doc §7.2.
--
-- First 1,000 paying auditions land at $49 (= $10 cost + $39 deposit)
-- instead of the standard $99 (= $20 cost + $79 deposit). YC-style
-- launch incentive · price-per-paying-audition is global, not per
-- member, so a creator's 4th and 5th audition both qualify for $49
-- as long as the global counter is still under the cap.
--
-- Tunable via app_settings so we can:
--   - bump the cap mid-run if launch traction exceeds 1,000
--   - adjust founder_price_cents if we want a $59 mid-tier later
--   - flip founder_window_open=false to short-circuit the discount
--
-- The edge function reads these on every checkout request, so changes
-- take effect on the next purchase without a redeploy.

-- 1. Seed the three Founder-pricing settings.
INSERT INTO app_settings (key, value, description) VALUES
  ('founder_window_open',  'true'::jsonb,
   'When true, paying auditions count toward the founder discount until the cap is reached. Flip to false to disable the discount globally.'),
  ('founder_audition_cap', '1000'::jsonb,
   'Maximum number of paid auditions that get founder pricing. Counter = COUNT(payments) WHERE status=succeeded AND kind=audit_fee.'),
  ('founder_price_cents',  '4900'::jsonb,
   'Price in cents charged while founder window is open. Standard price ($99/9900) lives in the edge function constant.')
ON CONFLICT (key) DO NOTHING;

-- 2. Helper · returns the current paid-audition count + whether the
--    next purchase is still inside the founder window. Used by both
--    the edge function (for actual pricing) and the client lib (for
--    "947 founder spots left" UI). Counts succeeded audit_fee rows.
CREATE OR REPLACE FUNCTION public.founder_pricing_status()
RETURNS TABLE (
  window_open   boolean,
  cap           int,
  paid_count    int,
  remaining     int,
  price_cents   int
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open    boolean;
  v_cap     int;
  v_count   int;
  v_price   int;
BEGIN
  SELECT (value)::boolean        INTO v_open  FROM app_settings WHERE key = 'founder_window_open';
  SELECT (value)::int            INTO v_cap   FROM app_settings WHERE key = 'founder_audition_cap';
  SELECT (value)::int            INTO v_price FROM app_settings WHERE key = 'founder_price_cents';

  SELECT COUNT(*)::int INTO v_count
    FROM payments
   WHERE kind = 'audit_fee'
     AND status = 'succeeded';

  RETURN QUERY SELECT
    COALESCE(v_open,  false),
    COALESCE(v_cap,   0),
    v_count,
    GREATEST(0, COALESCE(v_cap, 0) - v_count),
    COALESCE(v_price, 4900);
END;
$$;

GRANT EXECUTE ON FUNCTION public.founder_pricing_status() TO anon, authenticated;
