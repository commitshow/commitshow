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

// Standard Webhooks signature · base64(HMAC-SHA256(`${id}.${ts}.${body}`, secret))
// `signature` header is space-separated list of `v1,<base64>` entries.
async function verifySignature(
  rawBody: string,
  hookId:  string,
  hookTs:  string,
  hookSig: string,
  secretRaw: string,
): Promise<boolean> {
  if (!secretRaw) return false
  // Standard Webhooks: secret is prefixed `whsec_` and base64-encoded
  // bytes. Strip the prefix and base64-decode for the HMAC key.
  const trimmed = secretRaw.startsWith('whsec_') ? secretRaw.slice('whsec_'.length) : secretRaw
  const keyBytes = Uint8Array.from(atob(trimmed), c => c.charCodeAt(0))

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', keyBytes,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])

  const signed = await crypto.subtle.sign('HMAC', key,
    enc.encode(`${hookId}.${hookTs}.${rawBody}`))
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)))

  // The header carries one or more `v1,<sig>` pairs separated by space.
  const parts = hookSig.split(' ')
  for (const p of parts) {
    const [version, sig] = p.split(',')
    if (version === 'v1' && sig === expected) return true
  }
  return false
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

  // Read raw body once · we need the exact bytes for signature
  // verification. Re-parse as JSON afterwards.
  const rawBody = await req.text()

  const HOOK_SECRET = Deno.env.get('AUTH_HOOK_SECRET') ?? ''
  if (!HOOK_SECRET) {
    return json({ error: 'AUTH_HOOK_SECRET not configured' }, 500)
  }

  const hookId  = req.headers.get('webhook-id')        ?? ''
  const hookTs  = req.headers.get('webhook-timestamp') ?? ''
  const hookSig = req.headers.get('webhook-signature') ?? ''
  if (!hookId || !hookTs || !hookSig) {
    return json({ error: 'missing webhook headers' }, 401)
  }
  const ok = await verifySignature(rawBody, hookId, hookTs, hookSig, HOOK_SECRET)
  if (!ok) return json({ error: 'invalid signature' }, 401)

  let payload: AuthHookPayload
  try { payload = JSON.parse(rawBody) } catch { return json({ error: 'invalid JSON body' }, 400) }

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
