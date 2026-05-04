-- Add optional p_recipient_addr_override to dispatch_email so admin
-- "Send test to me" UI can send to any inbox (e.g. han@commit.show
-- monitoring inbox) without requiring that address to be a registered
-- member. p_recipient_id stays required for notification_log
-- attribution; the override only changes which email gets the message.

CREATE OR REPLACE FUNCTION public.dispatch_email(
  p_kind                    text,
  p_recipient_id            uuid,
  p_payload                 jsonb   DEFAULT '{}'::jsonb,
  p_dedupe_suffix           text    DEFAULT NULL,
  p_recipient_addr_override text    DEFAULT NULL
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
  SELECT * INTO v_template
    FROM email_templates
   WHERE kind = p_kind AND enabled = true;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_config FROM _email_dispatch_config WHERE id = 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Override beats auth.users lookup. Useful for admin tests + any
  -- future case where we want to email a not-yet-registered address.
  IF p_recipient_addr_override IS NOT NULL THEN
    v_recipient := p_recipient_addr_override;
  ELSE
    SELECT email INTO v_recipient FROM auth.users WHERE id = p_recipient_id;
  END IF;
  IF v_recipient IS NULL THEN RETURN NULL; END IF;

  v_subject := substitute_template_vars(v_template.subject,   p_payload);
  v_html    := substitute_template_vars(v_template.html_body, p_payload);
  v_text    := CASE WHEN v_template.text_body IS NOT NULL
                    THEN substitute_template_vars(v_template.text_body, p_payload)
                    ELSE NULL END;

  v_dedupe_key := p_kind || ':' || p_recipient_id::text;
  IF p_dedupe_suffix IS NOT NULL THEN
    v_dedupe_key := v_dedupe_key || ':' || p_dedupe_suffix;
  END IF;

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
