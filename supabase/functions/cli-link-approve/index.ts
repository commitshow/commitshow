// cli-link-approve · web browser POSTs here when the signed-in user
// clicks Authorize on /cli/link. Verifies the caller, marks the row
// approved, mints a long-lived API token (Supabase-format JWT signed
// with the project JWT secret · sub=user.id · 90-day TTL).
//
// CLI's poll then exchanges this for the same token via cli-link-poll.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { create as jwtCreate, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// 90-day JWT lifetime — long enough that CLI users don't re-login often,
// short enough that compromise has bounded impact. Refresh flow is a
// follow-up (V1.5+); for now CLI re-runs `commitshow login` on expiry.
const TOKEN_TTL_DAYS = 90

async function importJwtKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

async function mintApiToken(userId: string, supabaseUrl: string, jwtSecret: string): Promise<string> {
  const key = await importJwtKey(jwtSecret)
  const iat = getNumericDate(0)
  const exp = getNumericDate(TOKEN_TTL_DAYS * 86_400)
  return jwtCreate(
    { alg: 'HS256', typ: 'JWT' },
    {
      sub:  userId,
      role: 'authenticated',
      aud:  'authenticated',
      iss:  supabaseUrl,
      iat,
      exp,
      // marker so we can distinguish CLI-minted tokens from browser
      // sessions during audit logging if we ever need to.
      app_metadata: { provider: 'commitshow-cli' },
    },
    key,
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const JWT_SECRET   = Deno.env.get('SUPABASE_JWT_SECRET')!
  if (!JWT_SECRET) return json({ error: 'SUPABASE_JWT_SECRET not set' }, 500)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Verify caller via their browser session JWT (Supabase auth header).
  const authHeader = req.headers.get('authorization') ?? ''
  const callerJwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!callerJwt) return json({ error: 'Authorization header required' }, 401)
  const { data: userData, error: userErr } = await admin.auth.getUser(callerJwt)
  if (userErr || !userData?.user) return json({ error: 'Invalid auth token' }, 401)
  const userId = userData.user.id

  let body: { code?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const code = (body.code ?? '').toUpperCase().trim()
  if (!/^[0-9A-F]{6}$/.test(code)) return json({ error: 'Invalid code format · 6 hex chars expected' }, 400)

  // Look up the row · must be pending and unexpired.
  const { data: row, error: lookupErr } = await admin
    .from('cli_link_codes')
    .select('id, status, expires_at')
    .eq('code', code)
    .maybeSingle()
  if (lookupErr) return json({ error: 'Lookup failed', detail: lookupErr.message }, 500)
  if (!row)       return json({ error: 'Unknown or expired code' }, 404)
  if (row.status !== 'pending') return json({ error: `Code already ${row.status}` }, 409)
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await admin.from('cli_link_codes').update({ status: 'expired' }).eq('id', row.id)
    return json({ error: 'Code expired · re-run commitshow login' }, 410)
  }

  // Mint the API token + mark row approved. The poll endpoint reads
  // cli_link_codes.api_token and returns it to the polling CLI.
  let apiToken: string
  try {
    apiToken = await mintApiToken(userId, SUPABASE_URL, JWT_SECRET)
  } catch (e) {
    return json({ error: 'Token mint failed', detail: (e as Error)?.message }, 500)
  }

  const { error: updateErr } = await admin
    .from('cli_link_codes')
    .update({
      status:      'approved',
      approved_by: userId,
      approved_at: new Date().toISOString(),
      api_token:   apiToken,
      // Extend TTL once approved so the CLI has 24h to fetch the token.
      expires_at:  new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq('id', row.id)
  if (updateErr) return json({ error: 'Approval write failed', detail: updateErr.message }, 500)

  return json({ ok: true, approved_user_id: userId })
})
