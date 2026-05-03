-- 20260503_stripe_payments.sql added paid_audits_credit to members but didn't
-- GRANT SELECT on it. members uses column-level SELECT grants (see
-- 20260425140000_email_column_grants.sql · meant to keep email private), so a
-- new column without an explicit GRANT is invisible to anon + authenticated —
-- PostgREST returns 42501 'permission denied for table members' the moment
-- the client includes the column in its select list.
--
-- Symptom in production: every checkRegistrationEligibility() read failed
-- silently, so paidCredit defaulted to 0 even after a successful Stripe
-- webhook flipped the credit to 1. The post-checkout polling loop never
-- detected the credit and the user got stranded on 'Payment received ·
-- finalizing' indefinitely.
--
-- Same class of bug as 20260430_ladder_column_grants.sql (ladder columns on
-- projects). Fix is identical: explicit column-level GRANT.

GRANT SELECT (paid_audits_credit) ON public.members TO anon, authenticated;
