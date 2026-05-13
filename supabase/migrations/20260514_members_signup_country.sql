-- ───────────────────────────────────────────────────────────────────────────
-- members.signup_country · 2-letter ISO country code captured at sign-in
-- ───────────────────────────────────────────────────────────────────────────
-- We already have country at the request layer (CF-IPCountry) but the per-
-- request analytics tables (visitor_hits) are visitor_hash keyed, not
-- member_id keyed by design (cookie-free). So /admin members list had no
-- country signal even though we have geo on every Cloudflare hit.
--
-- Capture path: client reads `/cdn-cgi/trace` after a successful sign-in,
-- pulls the `loc=KR` line, upserts members.signup_country if null.
-- /cdn-cgi/trace is free, Cloudflare-served, and CORS-friendly from any
-- origin behind Cloudflare. No third-party IP-geo API needed.
--
-- Column-level GRANT pattern · per the column_grants memory, members rows
-- only return the columns the role is explicitly granted. anon needs read
-- for the admin RPC to surface country in the members list (server-side
-- service_role bypass also works). authenticated needs UPDATE on this
-- column so the client-side sync write succeeds for the row itself.
-- ───────────────────────────────────────────────────────────────────────────

alter table members
  add column if not exists signup_country char(2);

create index if not exists idx_members_signup_country
  on members (signup_country)
  where signup_country is not null;

grant select (signup_country) on members to anon;
grant select (signup_country) on members to authenticated;
grant update (signup_country) on members to authenticated;
