-- Seed the first showcase Library listing · supabase-resend-auth.
-- Published by K Master (1@1.com · primary admin) — relies on the
-- admin publish bypass added in 20260506_admin_publish_bypass.sql.
--
-- This is an "imperative" agent_skill (multi-file installer that
-- writes to the user's Supabase project), so the listing surfaces
-- inputs (Resend key, sender, brand, hook secret) and bundle paths
-- so prospective installers know what they are agreeing to before
-- running.

WITH admin_id AS (
  SELECT id FROM members WHERE email = '1@1.com' LIMIT 1
)
INSERT INTO public.md_library (
  creator_id,
  title,
  description,
  category,
  intent,
  tags,
  target_format,
  target_tools,
  stack_tags,
  variables,
  bundle_files,
  preview,
  content_md,
  price_cents,
  verified_badge,
  status,
  is_public
)
SELECT
  admin_id.id,
  'supabase-resend-auth',
  'One-shot installer that wires Resend in as the Supabase Auth email sender — signup confirmation, magic link, password reset, invite, email change. Battle-tested through 15 distinct failure modes.',
  'Auth/Payment',
  'connect_service',
  ARRAY['supabase','resend','auth','email','edge-function','transactional','custom-smtp'],
  'agent_skill',
  '["claude-code"]'::jsonb,
  '["supabase","resend","deno","postgres"]'::jsonb,
  -- Declarative inputs the installer prompts for. Every imperative
  -- pack should expose this shape so the marketplace card can render
  -- "Asks for: …" before install. Pack-manifest v0.1 (will become
  -- pack.yaml when the manifest schema is finalized).
  '[
    {"key":"BRAND_NAME","label":"Brand name shown in emails","secret":false},
    {"key":"BRAND_TAGLINE","label":"Brand tagline (small caps under wordmark)","secret":false,"optional":true},
    {"key":"RESEND_API_KEY","label":"Resend API key (re_…)","secret":true},
    {"key":"EMAIL_FROM","label":"Verified Resend sender","secret":false},
    {"key":"AUTH_HOOK_SECRET","label":"Webhook secret (v1,whsec_… from Dashboard)","secret":true,"deferred":true}
  ]'::jsonb,
  '[
    "functions/auth-email-hook/index.ts",
    "functions/send-email/index.ts",
    "migrations/01_notification_log.sql",
    "migrations/02_email_templates.sql",
    "migrations/03_auth_email_templates.sql",
    "scripts/install.sh",
    "SKILL.md",
    "README.md"
  ]'::jsonb,
  -- preview · short pitch shown on the row card
  E'Wire Resend as Supabase Auth''s email sender. Confirmation · magic link · recovery · invite · email change all routed through your branded domain. Encodes 15 known pitfalls so the next project skips the 4-hour debug session.',
  -- content_md · rendered on the detail page
  E'## What this installs

**Two Edge Functions**:
- `auth-email-hook` — receives Supabase Auth''s webhook, verifies via the Standard Webhooks library, looks up the matching `auth_*` template, sends through Resend.
- `send-email` — generic gateway for all transactional mail. Writes audit rows to `notification_log` with dedupe.

**Three migrations**:
- `notification_log` (audit + dedupe unique on `dedupe_key`)
- `email_templates` registry + `dispatch_email()` SQL function
- 5 seeded auth templates (brand-placeholdered): signup confirmation, magic link, recovery, invite, email change

**`install.sh`** — pulls secrets via macOS hidden-answer dialogs, runs migrations, deploys functions with `--no-verify-jwt`, sets secrets, prints the Hook URL for Dashboard registration.

## Prerequisites

`.env.local` at your project root must contain:

```
SUPABASE_PROJECT_REF=...
DATABASE_URL=postgres://...
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Plus a Resend account with a **verified sender domain** (DKIM/SPF green).

## After install · two manual Dashboard steps

1. Authentication → Hooks → Send Email Hook → enable + paste URL the installer prints
2. Generate secret → **click "Update hook" to save** (easy to skip — Dashboard silently keeps the old secret) → re-run installer with the new value

## Why imperative

The original integration took several hours of live debugging because each layer (Supabase secret-name reservation, JWT toggle, Standard Webhooks signature, Dashboard Save click, Resend domain verification, FK race during signup, IP-level rate-limit gate, Gmail anchor recolor) has its own silent failure mode. This skill encodes the working configuration so the next project skips all of it.

## What gets touched on your project

- 2 Edge Functions deployed (`auth-email-hook`, `send-email`)
- 3 SQL migrations applied (`notification_log`, `email_templates`, `auth_*` template seeds)
- 3 secrets set on the Edge Function project (`RESEND_API_KEY`, `EMAIL_FROM`, `AUTH_HOOK_SECRET`)
- 1 row inserted into `_email_dispatch_config` (singleton for the dispatcher function to call back into send-email)

Source is fully open in `bundle_files` — read every line before running.',
  0,                  -- free
  true,               -- verified · admin showcase
  'published',
  true
FROM admin_id
ON CONFLICT DO NOTHING;
