// cli-link-poll · CLI polls here with poll_token to retrieve the
// minted API token once the user has approved on web.
// Returns 'pending' until approved · 'ok' with token once approved.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let body: { poll_token?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const pollToken = (body.poll_token ?? '').trim()
  if (!pollToken) return json({ error: 'poll_token required' }, 400)

  const { data: row, error } = await admin
    .from('cli_link_codes')
    .select('id, status, api_token, approved_by, expires_at')
    .eq('poll_token', pollToken)
    .maybeSingle()
  if (error) return json({ error: 'Lookup failed', detail: error.message }, 500)
  if (!row)  return json({ error: 'Unknown poll_token' }, 404)

  if (new Date(row.expires_at).getTime() < Date.now() && row.status !== 'consumed') {
    await admin.from('cli_link_codes').update({ status: 'expired' }).eq('id', row.id)
    return json({ status: 'expired', message: 'Code expired · re-run commitshow login' }, 410)
  }

  if (row.status === 'pending') {
    return json({ status: 'pending' })
  }
  if (row.status === 'expired') {
    return json({ status: 'expired' }, 410)
  }
  if (row.status === 'consumed') {
    return json({ status: 'consumed', message: 'Token already retrieved · re-run commitshow login' }, 410)
  }
  if (row.status === 'approved' && row.api_token) {
    // Mark consumed so the token can't be re-fetched from this row.
    // (Token itself remains valid for its 90-day TTL · cli_link_codes
    // is just the bridge.)
    await admin
      .from('cli_link_codes')
      .update({ status: 'consumed', consumed_at: new Date().toISOString(), api_token: null })
      .eq('id', row.id)
    return json({
      status:    'ok',
      api_token: row.api_token,
      user_id:   row.approved_by,
    })
  }
  return json({ error: 'Unexpected state' }, 500)
})
