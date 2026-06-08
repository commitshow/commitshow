-- Legit.Show — listing ownership verification (domain meta-tag).
--
-- An owner proves control of the listing's domain by placing a
-- <meta name="legit-verify" content="<token>"> tag on the site (or a DNS TXT
-- record), then we fetch and confirm it. verified_by/verified_at drive the
-- "verified owner" badge and unlock owner management. The token is per-listing
-- and not sensitive — passing verification still requires actually controlling
-- the domain — so it stays readable.

alter table public.listings
  add column if not exists verify_token text,
  add column if not exists verified_by uuid references public.members(id) on delete set null,
  add column if not exists verified_at timestamptz;

grant select (verify_token, verified_by, verified_at) on public.listings to anon, authenticated;
