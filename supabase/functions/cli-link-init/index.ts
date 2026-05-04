// cli-link-init · CLI starts a device-flow login.
// Returns: { code, poll_token, verification_url, expires_in }
// Anonymous · no auth required to start the flow.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// 6 hex chars · easy to read aloud (no I/O/0/1 confusion at this length).
function generateCode(): string {
  const buf = new Uint8Array(3)
  crypto.getRandomValues(buf)
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

const APPROVAL_TTL_MIN = 10
const APP_BASE = 'https://commit.show'

Deno.serve(async (req) => {
  try {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Opportunistically expire stale rows so the table doesn't grow unbounded.
  try { await admin.rpc('cli_link_expire_stale') } catch (e) { console.warn('expire stale failed', e) }

  // Generate code · retry on the rare collision (1 in 16M for 6 hex).
  let code = generateCode()
  for (let i = 0; i < 5; i++) {
    const { data: existing } = await admin
      .from('cli_link_codes')
      .select('id')
      .eq('code', code)
      .in('status', ['pending', 'approved'])
      .maybeSingle()
    if (!existing) break
    code = generateCode()
  }

  const pollToken = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MIN * 60_000).toISOString()

  const { error } = await admin.from('cli_link_codes').insert({
    code,
    poll_token: pollToken,
    expires_at: expiresAt,
  })
  if (error) return json({ error: 'Failed to create link code', detail: error.message }, 500)

  return json({
    code,
    poll_token:       pollToken,
    verification_url: `${APP_BASE}/cli/link?code=${code}`,
    expires_in:       APPROVAL_TTL_MIN * 60,
  })
  } catch (e) {
    console.error('[cli-link-init] uncaught', e)
    return json({ error: 'internal', detail: (e as Error)?.message ?? String(e) }, 500)
  }
})
