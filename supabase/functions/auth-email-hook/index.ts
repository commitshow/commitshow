// auth-email-hook · Supabase Auth Send Email Hook handler.
//
// Supabase Auth POSTs to this endpoint whenever it would otherwise
// send an email itself (signup confirmation, magic link, password
// recovery, invite, email change). We:
//   1. Verify the Standard Webhooks HMAC signature against
//      AUTH_HOOK_SECRET (set via supabase secrets · matches
//      the secret pasted into the Hook config in Supabase Dashboard).
//   2. Pull the matching `auth_*` row from email_templates.
//   3. Substitute {{confirmation_url}}, {{display_name}}, {{email}}
//      then POST to Resend through the same path the rest of our
//      transactional mail uses (notification_log row, dedupe key,
//      provider id captured).
//
// The verify URL Supabase wants the user to click is built per the
// docs · redirect_to defaults to site_url when missing.
//
// References:
//   · https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
//   · https://www.standardwebhooks.com/

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
// Standard Webhooks · Supabase Auth Hook is a Standard-Webhooks compliant
// sender. Using the canonical library means we don't reimplement the
// HMAC + base64 + secret-prefix dance ourselves (which is exactly what
// kept signing 401 in the previous direct-crypto path). Library is
// loaded from the same esm.sh CDN the rest of our Edge Functions use.
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

interface AuthHookPayload {
  user: {
    id:              string
    email?:          string
    user_metadata?:  Record<string, unknown>
    raw_user_meta_data?: Record<string, unknown>
  }
  email_data: {
    token:               string
    token_hash:          string
    redirect_to?:        string
    email_action_type:   'signup' | 'recovery' | 'invite' | 'magiclink' | 'email_change' | 'email_change_current' | 'email_change_new' | string
    site_url:            string
    token_new?:          string
    token_hash_new?:     string
  }
}

const ACTION_TO_TEMPLATE: Record<string, string> = {
  signup:               'auth_signup_confirmation',
  magiclink:            'auth_magic_link',
  recovery:             'auth_recovery',
  invite:               'auth_invite',
  email_change:         'auth_email_change',
  email_change_current: 'auth_email_change',
  email_change_new:     'auth_email_change',
}

// Lightweight {{var}} substitution · same shape as the substitute_template_vars
// SQL function used by the dispatch_email path so admins editing in
// /admin/emails see the same syntax across all kinds.
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  console.log('[auth-email-hook] request received', {
    method:   req.method,
    has_id:   !!req.headers.get('webhook-id'),
    has_ts:   !!req.headers.get('webhook-timestamp'),
    has_sig:  !!req.headers.get('webhook-signature'),
    sig_pre:  (req.headers.get('webhook-signature') ?? '').slice(0, 20),
  })

  // Read raw body once · we need the exact bytes for signature
  // verification. Re-parse as JSON afterwards.
  const rawBody = await req.text()

  const HOOK_SECRET = Deno.env.get('AUTH_HOOK_SECRET') ?? ''
  if (!HOOK_SECRET) {
    return json({ error: 'AUTH_HOOK_SECRET not configured' }, 500)
  }

  // standardwebhooks library wants the secret in `whsec_<base64>`
  // form · its constructor base64-decodes whatever follows whsec_.
  // Supabase Dashboard displays the secret as `v1,whsec_<base64>`
  // (the v1, is the scheme version of the SIGNATURE, not the secret).
  // Pass v1, through and the library tries to decode `v1,xxx` and
  // throws "Base64Coder: incorrect characters for decoding". Strip
  // it inside the function so callers can paste either form into
  // AUTH_HOOK_SECRET without surgery.
  let payload: AuthHookPayload
  try {
    const cleaned = HOOK_SECRET.replace(/^v1,/, '')
    const wh = new Webhook(cleaned)
    const headers = {
      'webhook-id':        req.headers.get('webhook-id')        ?? '',
      'webhook-timestamp': req.headers.get('webhook-timestamp') ?? '',
      'webhook-signature': req.headers.get('webhook-signature') ?? '',
    }
    payload = wh.verify(rawBody, headers) as AuthHookPayload
  } catch (e) {
    console.warn('[auth-email-hook] signature verify failed', {
      error:         (e as Error)?.message ?? String(e),
      secret_starts: HOOK_SECRET.slice(0, 12),
      secret_len:    HOOK_SECRET.length,
    })
    return json({ error: 'invalid signature', detail: (e as Error)?.message }, 401)
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const RESEND_KEY   = Deno.env.get('RESEND_API_KEY')
  const EMAIL_FROM   = Deno.env.get('EMAIL_FROM') ?? 'commit.show <notifications@commit.show>'

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const action = payload.email_data.email_action_type
  const templateKind = ACTION_TO_TEMPLATE[action]
  if (!templateKind) {
    // Unknown action · let Auth handle it via its default SMTP rather
    // than swallow silently. We respond 200 so Auth doesn't retry,
    // but no email goes out our side.
    console.warn(`[auth-email-hook] unknown email_action_type: ${action}`)
    return json({ skipped: true, reason: 'unknown email_action_type' }, 200)
  }

  // Look up the template.
  const { data: tpl } = await admin
    .from('email_templates')
    .select('subject, html_body, text_body, enabled')
    .eq('kind', templateKind)
    .maybeSingle()
  if (!tpl || !tpl.enabled) {
    return json({ error: `template missing or disabled: ${templateKind}` }, 500)
  }

  // Compose confirmation_url. Supabase format:
  //   {site_url}/auth/v1/verify?token={token_hash}&type={action}&redirect_to={redirect_to}
  const redirect = payload.email_data.redirect_to || payload.email_data.site_url
  const confirmationUrl = `${payload.email_data.site_url}/auth/v1/verify`
    + `?token=${encodeURIComponent(payload.email_data.token_hash)}`
    + `&type=${encodeURIComponent(action)}`
    + `&redirect_to=${encodeURIComponent(redirect)}`

  // display_name lookup · best-effort. members row may not exist yet
  // for a brand-new signup (race with handle_new_user trigger), so
  // fall back to user_metadata fields and finally the email local part.
  let displayName: string | null = null
  try {
    const { data: m } = await admin
      .from('members')
      .select('display_name')
      .eq('id', payload.user.id)
      .maybeSingle()
    displayName = m?.display_name ?? null
  } catch { /* ignore · trigger may still be running */ }

  const meta = (payload.user.user_metadata ?? payload.user.raw_user_meta_data ?? {}) as Record<string, unknown>
  const fallback = String(meta.display_name ?? meta.preferred_username ?? meta.user_name ?? meta.name ?? '')
  const localPart = (payload.user.email ?? '').split('@')[0] ?? ''
  const finalName = (displayName ?? (fallback || null) ?? (localPart || null) ?? 'there') as string

  const vars = {
    confirmation_url: confirmationUrl,
    display_name:     finalName,
    email:            payload.user.email ?? '',
    site_url:         payload.email_data.site_url,
    token:            payload.email_data.token,
  }

  const subject = fill(tpl.subject, vars)
  const html    = fill(tpl.html_body, vars)
  const text    = tpl.text_body ? fill(tpl.text_body, vars) : null

  // Dedupe key includes the token_hash so each unique link gets its
  // own row (a re-sent confirmation gets a fresh token from Auth).
  const dedupeKey = `${templateKind}:${payload.user.id}:${payload.email_data.token_hash.slice(0, 16)}`

  // Log row · same notification_log table the rest of the email
  // pipeline uses, so /admin/emails surfaces auth mail next to
  // welcome / encore / etc.
  const { data: logRow, error: insertErr } = await admin
    .from('notification_log')
    .insert({
      channel:        'email',
      kind:           templateKind,
      recipient_id:   payload.user.id,
      recipient_addr: payload.user.email,
      payload:        { email_action_type: action, redirect_to: redirect },
      dedupe_key:     dedupeKey,
      status:         'queued',
      provider:       RESEND_KEY ? 'resend' : null,
    })
    .select('id')
    .single()

  if (insertErr) {
    if ((insertErr as { code?: string }).code === '23505') {
      return json({ ok: true, deduped: true }, 200)
    }
    return json({ error: 'log insert failed', detail: insertErr.message }, 500)
  }

  if (!RESEND_KEY) {
    return json({ ok: true, noop: true, log_id: logRow.id, reason: 'RESEND_API_KEY not set' }, 200)
  }

  let providerId:   string | null = null
  let errorMessage: string | null = null
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    EMAIL_FROM,
        to:      [payload.user.email],
        subject,
        html,
        text:    text ?? undefined,
        tags:    [{ name: 'kind', value: templateKind }],
      }),
    })
    const j = await r.json()
    if (!r.ok) {
      errorMessage = `Resend ${r.status}: ${j?.message ?? r.statusText}`
    } else {
      providerId = j?.id ?? null
    }
  } catch (e) {
    errorMessage = `fetch failed: ${(e as Error)?.message ?? e}`
  }

  await admin
    .from('notification_log')
    .update({
      status:        errorMessage ? 'failed' : 'sent',
      provider_id:   providerId,
      error_message: errorMessage,
      sent_at:       errorMessage ? null : new Date().toISOString(),
    })
    .eq('id', logRow.id)

  if (errorMessage) {
    return json({ error: errorMessage, log_id: logRow.id }, 502)
  }
  return json({ ok: true, log_id: logRow.id, provider_id: providerId }, 200)
})
