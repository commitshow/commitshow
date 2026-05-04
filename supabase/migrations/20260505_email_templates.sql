-- Email template registry · separates "what to say" (data, editable
-- from /admin) from "when to send" (DB triggers, code-locked).
--
-- Caller (a trigger or scheduled job) invokes dispatch_email(kind,
-- recipient_id, payload). The function:
--   1. Loads the row matching `kind` from email_templates
--   2. Substitutes {{var}} placeholders against the payload jsonb
--   3. POSTs to the send-email Edge Function via pg_net
--   4. Returns the template id (or NULL when disabled / missing)
-- send-email handles dedupe_key uniqueness + Resend round-trip +
-- notification_log writes — no work duplicated here.
--
-- _email_dispatch_config holds the URL + service-role key the trigger
-- needs to call back into the Edge Function. RLS denies anon/auth
-- reads outright; only service_role (who runs SECURITY DEFINER fns)
-- can SELECT. The values get loaded once via psql post-migration.

-- ── 1. Templates registry ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_templates (
  kind          text         PRIMARY KEY,
  subject       text         NOT NULL,
  html_body     text         NOT NULL,
  text_body     text,
  variables     text[]       NOT NULL DEFAULT '{}',
  enabled       boolean      NOT NULL DEFAULT true,
  description   text,
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  updated_by    uuid         REFERENCES public.members(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_email_templates_updated_by ON email_templates(updated_by);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_templates_admin_all ON public.email_templates;
CREATE POLICY email_templates_admin_all
  ON public.email_templates
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM members WHERE members.id = auth.uid() AND members.is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM members WHERE members.id = auth.uid() AND members.is_admin = true)
  );

-- ── 2. Dispatch config · service-role only ────────────────────
CREATE TABLE IF NOT EXISTS public._email_dispatch_config (
  id                int          PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- enforce single row
  supabase_url      text         NOT NULL,
  service_role_key  text         NOT NULL,
  updated_at        timestamptz  NOT NULL DEFAULT now()
);
ALTER TABLE public._email_dispatch_config ENABLE ROW LEVEL SECURITY;
-- No policies created · service_role bypasses RLS, all other roles get nothing.
-- Even an admin with malicious intent can't SELECT the key from the SQL
-- editor unless they're acting AS the service role.

REVOKE ALL ON public._email_dispatch_config FROM anon, authenticated;

-- ── 3. {{var}} substitution helper ────────────────────────────
CREATE OR REPLACE FUNCTION public.substitute_template_vars(
  p_template text,
  p_payload  jsonb
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_result text := p_template;
  v_key    text;
  v_value  text;
BEGIN
  -- Iterate every top-level key in payload, replace {{key}} → value
  FOR v_key, v_value IN
    SELECT key, COALESCE(value #>> '{}', '')   -- jsonb to text
      FROM jsonb_each(p_payload)
  LOOP
    v_result := replace(v_result, '{{' || v_key || '}}', v_value);
  END LOOP;
  RETURN v_result;
END;
$$;

-- ── 4. Dispatch function ──────────────────────────────────────
-- Returns the request_id from pg_net (or NULL when no template / config /
-- recipient email). NEVER raises — we don't want a missing template to
-- block the underlying business operation (member signup, etc.).
CREATE OR REPLACE FUNCTION public.dispatch_email(
  p_kind          text,
  p_recipient_id  uuid,
  p_payload       jsonb DEFAULT '{}'::jsonb,
  p_dedupe_suffix text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  v_template     record;
  v_config       record;
  v_recipient    text;
  v_subject      text;
  v_html         text;
  v_text         text;
  v_dedupe_key   text;
  v_request_id   bigint;
BEGIN
  -- Load template (skip silently when disabled / missing).
  SELECT * INTO v_template
    FROM email_templates
   WHERE kind = p_kind AND enabled = true;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Load dispatch config (URL + service-role key).
  SELECT * INTO v_config FROM _email_dispatch_config WHERE id = 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Resolve recipient email from auth.users.
  SELECT email INTO v_recipient FROM auth.users WHERE id = p_recipient_id;
  IF v_recipient IS NULL THEN RETURN NULL; END IF;

  -- Substitute {{vars}} in subject + bodies.
  v_subject := substitute_template_vars(v_template.subject,   p_payload);
  v_html    := substitute_template_vars(v_template.html_body, p_payload);
  v_text    := CASE WHEN v_template.text_body IS NOT NULL
                    THEN substitute_template_vars(v_template.text_body, p_payload)
                    ELSE NULL END;

  -- Dedupe key: kind:recipient[:suffix] — caller can pass a payload-
  -- specific suffix (e.g. project_id, snapshot_id) to allow multiple
  -- sends of the same kind across different references.
  v_dedupe_key := p_kind || ':' || p_recipient_id::text;
  IF p_dedupe_suffix IS NOT NULL THEN
    v_dedupe_key := v_dedupe_key || ':' || p_dedupe_suffix;
  END IF;

  -- Async POST to send-email · pg_net returns immediately, the actual
  -- HTTP call runs out-of-band so a slow Resend never blocks the
  -- triggering business operation.
  SELECT net.http_post(
    url     := v_config.supabase_url || '/functions/v1/send-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_config.service_role_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'kind',           p_kind,
      'recipient_id',   p_recipient_id,
      'recipient_addr', v_recipient,
      'subject',        v_subject,
      'html',           v_html,
      'text',           v_text,
      'dedupe_key',     v_dedupe_key,
      'payload',        p_payload
    )
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

-- ── 5. Welcome trigger · members AFTER INSERT ─────────────────
CREATE OR REPLACE FUNCTION public.dispatch_welcome_email() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM dispatch_email(
    'welcome',
    NEW.id,
    jsonb_build_object(
      'display_name', COALESCE(NEW.display_name, 'there'),
      'member_id',    NEW.id::text
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_welcome ON public.members;
CREATE TRIGGER trg_dispatch_welcome
  AFTER INSERT ON public.members
  FOR EACH ROW
  EXECUTE FUNCTION dispatch_welcome_email();

-- ── 6. Seed default template ──────────────────────────────────
-- Plain natural-language tone (no fancy unicode in subject, no
-- "Edge Function is live" automation-tropes — those got our smoke
-- test sent to junk on first delivery). HTML stays minimal so it
-- renders well in narrow gmail/zoho cards. text_body for the
-- multipart/alternative fallback.
INSERT INTO public.email_templates (kind, subject, html_body, text_body, variables, description)
VALUES (
  'welcome',
  'Welcome to commit.show',
  '<div style="font-family:system-ui,-apple-system,sans-serif;color:#0F2040;max-width:560px;margin:0 auto;padding:24px">'
  '<p style="font-size:14px;letter-spacing:0.1em;color:#888;margin:0 0 4px;font-family:DM Mono,monospace">commit.show</p>'
  '<h1 style="font-family:Playfair Display,Georgia,serif;font-size:28px;font-weight:700;line-height:1.15;margin:0 0 16px">Welcome, {{display_name}}.</h1>'
  '<p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 14px">You just joined the vibe-coding league — the place where AI-assisted projects get audited and ranked.</p>'
  '<p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 14px">Three things you can do today:</p>'
  '<ul style="font-size:15px;line-height:1.7;color:#333;margin:0 0 18px;padding-left:22px">'
  '<li>Audition your repo · <a href="https://commit.show/submit" style="color:#0F2040">commit.show/submit</a></li>'
  '<li>Walk-on audit any GitHub repo from your terminal · <code style="background:#f4f1ea;padding:2px 6px;border-radius:2px;font-size:13px">npx commitshow audit github.com/&lt;owner&gt;/&lt;repo&gt;</code></li>'
  '<li>Browse what other vibe coders shipped this week · <a href="https://commit.show/ladder" style="color:#0F2040">commit.show/ladder</a></li>'
  '</ul>'
  '<p style="font-size:13px;line-height:1.55;color:#666;margin:24px 0 0;border-top:1px solid #eee;padding-top:16px">'
  'You’re receiving this because you signed up at commit.show. Reply to this email if you have any questions — a real human reads them.'
  '</p>'
  '</div>',
  'Welcome, {{display_name}}.

You just joined the vibe-coding league — the place where AI-assisted projects get audited and ranked.

Three things you can do today:
  - Audition your repo at commit.show/submit
  - Walk-on audit any GitHub repo from your terminal:
      npx commitshow audit github.com/<owner>/<repo>
  - Browse what other vibe coders shipped this week at commit.show/ladder

You''re receiving this because you signed up at commit.show. Reply to this email if you have any questions — a real human reads them.',
  ARRAY['display_name', 'member_id'],
  'Sent immediately after a member row is created (signup via any auth provider).'
)
ON CONFLICT (kind) DO NOTHING;
