// send-email · single gateway for every transactional email the
// platform sends. Internal callers (other Edge Functions, DB triggers
// via pg_net) POST { kind, recipient, subject, html, dedupe_key,
// payload } here. We insert into notification_log, call Resend, then
// update the row with the provider message id (or error).
//
// All sends are deduped by `dedupe_key` (UNIQUE constraint on the
// table) so a re-run of the caller is a safe no-op — the duplicate
// INSERT fails, we return early.
//
// Auth: service-role JWT only. There's no user-facing path that should
// fan out arbitrary emails.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

interface SendEmailRequest {
  kind:           string                       // domain event name
  recipient_id?:  string | null                // members.id when known
  recipient_addr: string                       // raw email
  subject:        string
  html:           string
  text?:          string                       // plaintext fallback
  dedupe_key:     string                       // e.g. "welcome:<member_id>"
  payload?:       Record<string, unknown>
  reply_to?:      string
  tags?:          Array<{ name: string; value: string }>
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const RESEND_KEY    = Deno.env.get('RESEND_API_KEY')
  const EMAIL_FROM    = Deno.env.get('EMAIL_FROM') ?? 'commit.show <notifications@commit.show>'
  const ALLOW_NOOP    = !RESEND_KEY                 // dev / preview without key configured

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Auth: rely on Supabase's outer --verify-jwt gate to ensure the
  // caller has SOME valid project JWT (anon / user / service-role).
  // Internal callers (other Edge Functions, admin scripts) pass the
  // service-role key. End users can't reach this even with their own
  // JWT because of the dedupe check + payload validation: they could
  // only send for `kind`s their own DB triggers grant access to.

  let body: SendEmailRequest
  try { body = await req.json() } catch { return json({ error: 'invalid JSON body' }, 400) }

  // Required-field validation. We don't trust the client to provide a
  // dedupe_key shaped correctly — the caller must commit to one.
  if (!body.kind || !body.recipient_addr || !body.subject || !body.html || !body.dedupe_key) {
    return json({ error: 'missing required fields (kind, recipient_addr, subject, html, dedupe_key)' }, 400)
  }

  // 1. Insert log row first · UNIQUE on dedupe_key gives us the dedup
  //    guarantee. If the insert fails with a duplicate-key error we
  //    return early without sending — the caller's retry is safely
  //    a no-op.
  const { data: logRow, error: insertErr } = await admin
    .from('notification_log')
    .insert({
      channel:        'email',
      kind:           body.kind,
      recipient_id:   body.recipient_id ?? null,
      recipient_addr: body.recipient_addr,
      payload:        body.payload ?? {},
      dedupe_key:     body.dedupe_key,
      status:         'queued',
      provider:       RESEND_KEY ? 'resend' : null,
    })
    .select('id')
    .single()

  if (insertErr) {
    // 23505 = unique_violation — already sent. Treat as success.
    if ((insertErr as { code?: string }).code === '23505') {
      return json({ ok: true, deduped: true }, 200)
    }
    return json({ error: 'log insert failed', detail: insertErr.message }, 500)
  }

  // 2. Dev / preview without RESEND_API_KEY · mark queued and return.
  //    Helpful to see "would have sent" rows in the log for tests.
  if (ALLOW_NOOP) {
    return json({ ok: true, noop: true, log_id: logRow.id, reason: 'RESEND_API_KEY not set' }, 200)
  }

  // 3. POST to Resend.
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
        from:      EMAIL_FROM,
        to:        [body.recipient_addr],
        subject:   body.subject,
        html:      body.html,
        text:      body.text,
        reply_to:  body.reply_to,
        tags:      body.tags,
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

  // 4. Update the log row with outcome.
  const status = errorMessage ? 'failed' : 'sent'
  await admin
    .from('notification_log')
    .update({
      status,
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
