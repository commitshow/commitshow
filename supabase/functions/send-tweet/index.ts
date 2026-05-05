// send-tweet · server-side X (Twitter) v2 API caller.
//
// Flow:
//   1. Authenticate caller. Two paths:
//        · System post (kind='official') · service_role JWT required.
//          Pulls token from x_official_account.
//        · Member post (kind='member')   · normal JWT, member_id taken
//          from auth.uid(). Pulls token from x_oauth_tokens by member_id.
//   2. Refresh access_token if expires_at within 60s of now.
//   3. POST https://api.x.com/2/tweets · body { text }.
//   4. Insert x_share_log row with status + tweet_id (or error).
//   5. Return { tweet_id } on success.
//
// Idempotency · caller can pass dedupe_key. If a x_share_log row
// already exists with that key + status='sent', we no-op and return
// the prior tweet_id. Prevents duplicate posts on retry / replay.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck — Deno runtime

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

const X_TWEETS_URL = 'https://api.x.com/2/tweets'
const X_TOKEN_URL  = 'https://api.x.com/2/oauth2/token'
const TEXT_LIMIT   = 280

interface TokenRow {
  access_token:  string
  refresh_token: string | null
  expires_at:    string
  scopes:        string
}

async function refreshIfNeeded(
  admin: any,
  table: 'x_official_account' | 'x_oauth_tokens',
  whereCol: 'singleton' | 'member_id',
  whereVal: any,
  row: TokenRow,
): Promise<string> {
  const expiresAt = new Date(row.expires_at).getTime()
  const now = Date.now()
  // Refresh if expiring within 60s · gives the X API call comfortable
  // headroom even on a slow network.
  if (expiresAt > now + 60_000) {
    return row.access_token
  }
  if (!row.refresh_token) {
    throw new Error('Access token expired and no refresh_token available · re-authorize required')
  }
  const clientId = Deno.env.get('X_CLIENT_ID')
  if (!clientId) throw new Error('X_CLIENT_ID not configured')

  // X OAuth 2.0 PKCE refresh · public client (Client Secret optional
  // depending on app type; if confidential, we'd send Basic auth).
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: row.refresh_token,
    client_id:     clientId,
  })
  const clientSecret = Deno.env.get('X_CLIENT_SECRET')
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (clientSecret) {
    headers['Authorization'] = 'Basic ' + btoa(`${clientId}:${clientSecret}`)
  }

  const res = await fetch(X_TOKEN_URL, { method: 'POST', headers, body })
  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`X token refresh failed (${res.status}): ${errBody}`)
  }
  const data = await res.json() as {
    access_token:  string
    refresh_token?: string
    expires_in:    number
    scope?:        string
  }
  const newAccess  = data.access_token
  const newRefresh = data.refresh_token ?? row.refresh_token
  const newExpiry  = new Date(Date.now() + (data.expires_in * 1000)).toISOString()

  await admin.from(table).update({
    access_token:  newAccess,
    refresh_token: newRefresh,
    expires_at:    newExpiry,
    scopes:        data.scope ?? row.scopes,
    updated_at:    new Date().toISOString(),
  }).eq(whereCol, whereVal)

  return newAccess
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let body: {
    kind:          'official' | 'member'
    text:          string
    trigger_kind?: string                  // default 'system' for official, required for member
    source_id?:    string
    source_table?: string
    dedupe_key?:   string
    member_id?:    string                  // service_role can post on behalf of any member
  }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  if (!body.text || typeof body.text !== 'string') {
    return json({ error: 'text required' }, 400)
  }
  if (body.text.length > TEXT_LIMIT) {
    return json({ error: `text exceeds ${TEXT_LIMIT} chars (${body.text.length})` }, 400)
  }

  // Auth · two paths.
  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Authorization header required' }, 401)

  const isServiceRole = jwt === SERVICE_KEY
  let memberId: string | null = null
  if (body.kind === 'member') {
    if (isServiceRole) {
      // Trusted caller (DB trigger / Edge → Edge) can specify member_id.
      memberId = body.member_id ?? null
      if (!memberId) return json({ error: 'member_id required when called as service_role' }, 400)
    } else {
      const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
      if (userErr || !userData?.user) return json({ error: 'Invalid auth token' }, 401)
      memberId = userData.user.id
    }
    if (!body.trigger_kind || body.trigger_kind === 'system') {
      return json({ error: 'trigger_kind required for member posts (and must not be "system")' }, 400)
    }
  } else if (body.kind === 'official') {
    if (!isServiceRole) {
      return json({ error: 'Official-account posts require service_role' }, 403)
    }
  } else {
    return json({ error: 'kind must be "official" or "member"' }, 400)
  }

  // Idempotency · short-circuit on prior successful send for the
  // same dedupe_key.
  if (body.dedupe_key) {
    const { data: prior } = await admin
      .from('x_share_log')
      .select('tweet_id, status')
      .eq('dedupe_key', body.dedupe_key)
      .maybeSingle()
    if (prior?.status === 'sent') {
      return json({ tweet_id: prior.tweet_id, deduped: true })
    }
  }

  // Resolve token row.
  let accessToken: string
  let logRow: { table: string; whereCol: string; whereVal: any }
  if (body.kind === 'official') {
    const { data: tok, error } = await admin
      .from('x_official_account')
      .select('access_token, refresh_token, expires_at, scopes')
      .eq('singleton', true)
      .maybeSingle()
    if (error || !tok) {
      return json({ error: 'Official account token not configured' }, 500)
    }
    try {
      accessToken = await refreshIfNeeded(admin, 'x_official_account', 'singleton', true, tok as TokenRow)
    } catch (e) {
      return json({ error: (e as Error).message }, 502)
    }
    logRow = { table: 'x_official_account', whereCol: 'singleton', whereVal: true }
  } else {
    const { data: tok, error } = await admin
      .from('x_oauth_tokens')
      .select('access_token, refresh_token, expires_at, scopes')
      .eq('member_id', memberId)
      .maybeSingle()
    if (error || !tok) {
      return json({ error: 'No X token for this member · ask them to link X with tweet.write scope' }, 400)
    }
    try {
      accessToken = await refreshIfNeeded(admin, 'x_oauth_tokens', 'member_id', memberId, tok as TokenRow)
    } catch (e) {
      return json({ error: (e as Error).message }, 502)
    }
    logRow = { table: 'x_oauth_tokens', whereCol: 'member_id', whereVal: memberId }
  }

  // POST tweet.
  const tweetRes = await fetch(X_TWEETS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ text: body.text }),
  })
  const tweetBody = await tweetRes.json()

  if (!tweetRes.ok) {
    await admin.from('x_share_log').insert([{
      member_id:    body.kind === 'member' ? memberId : null,
      trigger_kind: body.trigger_kind ?? 'system',
      source_id:    body.source_id ?? null,
      source_table: body.source_table ?? null,
      dedupe_key:   body.dedupe_key ?? null,
      text_posted:  body.text,
      status:       'failed',
      error:        JSON.stringify(tweetBody).slice(0, 500),
    }])
    return json({ error: 'X API rejected the tweet', details: tweetBody }, 502)
  }

  const tweetId = tweetBody?.data?.id ?? null

  // Bump last_used_at on the token row · purely diagnostic.
  await admin.from(logRow.table).update({ last_used_at: new Date().toISOString() })
    .eq(logRow.whereCol, logRow.whereVal)

  await admin.from('x_share_log').insert([{
    member_id:    body.kind === 'member' ? memberId : null,
    trigger_kind: body.trigger_kind ?? 'system',
    source_id:    body.source_id ?? null,
    source_table: body.source_table ?? null,
    dedupe_key:   body.dedupe_key ?? null,
    text_posted:  body.text,
    tweet_id:     tweetId,
    status:       'sent',
    posted_at:    new Date().toISOString(),
  }])

  return json({ tweet_id: tweetId })
})
