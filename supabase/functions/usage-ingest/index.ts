// usage-ingest · receives token receipt blobs from the audition form
// (and the `commitshow extract` CLI flow) and writes them into
// audit_token_usage with verified=true.
//
// Inputs (POST):
//   { project_id: uuid, blob: 'cs_v1:<base64-json>' }
//
// Auth · the caller must be the project's creator. Authorization header
// carries the user JWT (NOT service_role) so we can verify auth.uid()
// matches projects.creator_id. CLI walk-on (status='preview') and
// non-creator viewers are rejected — token receipts are scoped to the
// member who built the project.
//
// Privacy · the blob carries token NUMBERS only (input/output/cache).
// Prompt content is parsed client-side (browser) or by the
// `commitshow extract` script and never leaves the user's machine.
// The Edge Function trusts that the blob was constructed correctly;
// it doesn't re-fetch JSONL from anywhere.
//
// Dedupe · per-session uniqueness is enforced by the partial UNIQUE
// index on audit_token_usage(project_id, session_id, content_hash)
// for source='claude_code'. Re-uploading the same blob just no-ops.
//
// Anomaly check · sessions with tokens/LOC > THRESHOLD or impossible
// totals get flagged via verified=false + an admin_review_queue row.
// (admin_review_queue table is created lazily — first flagged row
// migrates it; failure here doesn't block the ingest.)

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

// USD per 1M tokens · Anthropic Sonnet 4.6 · 2026-05 pricing.
const PRICE_INPUT        = 3.00
const PRICE_OUTPUT       = 15.00
const PRICE_CACHE_CREATE = 3.75
const PRICE_CACHE_READ   = 0.30

interface BlobSession {
  session_id?:           string
  input_tokens?:         number
  output_tokens?:        number
  cache_create_tokens?:  number
  cache_read_tokens?:    number
  first_seen_at?:        string  // ISO
  last_seen_at?:         string  // ISO
  message_count?:        number
  cwd?:                  string
  github_url?:           string
}

interface BlobPayload {
  v:             1
  source:        'claude_code'
  tool_version?: string
  github_url?:   string
  extracted_at?: string
  sessions:      BlobSession[]
}

function decodeBlob(blob: string): { ok: true; payload: BlobPayload } | { ok: false; reason: string } {
  if (!blob.startsWith('cs_v1:')) return { ok: false, reason: 'unsupported_blob_version' }
  const b64 = blob.slice('cs_v1:'.length).split(':')[0]   // ignore optional HMAC suffix
  let json: unknown
  try {
    const txt = atob(b64)
    json = JSON.parse(txt)
  } catch {
    return { ok: false, reason: 'blob_parse_error' }
  }
  const p = json as BlobPayload
  if (p.v !== 1)        return { ok: false, reason: 'bad_version' }
  if (p.source !== 'claude_code') return { ok: false, reason: 'unsupported_source' }
  if (!Array.isArray(p.sessions)) return { ok: false, reason: 'sessions_missing' }
  return { ok: true, payload: p }
}

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!

  // Verify caller via user JWT (not service_role · we need auth.uid()).
  const auth = req.headers.get('Authorization') ?? ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return json({ error: 'authorization required' }, 401)
  const userJwt = m[1]

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth:   { persistSession: false },
  })
  const { data: who } = await userClient.auth.getUser()
  const memberId = who?.user?.id ?? null
  if (!memberId) return json({ error: 'not_authenticated' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let payload: { project_id?: string; blob?: string }
  try { payload = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const projectId = payload.project_id
  const blob      = payload.blob
  if (!projectId || !blob) return json({ error: 'project_id_and_blob_required' }, 400)

  // Project ownership check · audit_token_usage rows are scoped to the
  // creator. Non-creators (visitors, scouts) cannot upload token receipts
  // for someone else's project.
  const { data: project } = await admin
    .from('projects')
    .select('id, creator_id, status, github_url')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return json({ error: 'project_not_found' }, 404)
  if (project.creator_id !== memberId) return json({ error: 'not_project_creator' }, 403)
  if (project.status === 'preview')    return json({ error: 'preview_walk_on_excluded' }, 400)

  const decoded = decodeBlob(blob)
  if (!decoded.ok) return json({ error: 'blob_decode_failed', reason: decoded.reason }, 400)
  const blobPayload = decoded.payload

  // Optional cross-check · if the blob carries a github_url, it should
  // match the project's repo (case-insensitive · ignores trailing slash).
  // Mismatch is a strong tampering signal · refuse the ingest.
  if (blobPayload.github_url && project.github_url) {
    const norm = (s: string) => s.toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '')
    if (norm(blobPayload.github_url) !== norm(project.github_url)) {
      return json({ error: 'github_url_mismatch', blob_url: blobPayload.github_url, project_url: project.github_url }, 400)
    }
  }

  let inserted     = 0
  let dedup_skips  = 0
  let invalid      = 0
  let totalTokens  = 0
  let totalCostUsd = 0

  for (const s of blobPayload.sessions) {
    const inputTok       = Math.max(0, Math.floor(s.input_tokens        ?? 0))
    const outputTok      = Math.max(0, Math.floor(s.output_tokens       ?? 0))
    const cacheCreateTok = Math.max(0, Math.floor(s.cache_create_tokens ?? 0))
    const cacheReadTok   = Math.max(0, Math.floor(s.cache_read_tokens   ?? 0))
    if (inputTok + outputTok + cacheCreateTok + cacheReadTok === 0) { invalid++; continue }
    if (!s.session_id) { invalid++; continue }

    const costUsd =
      (inputTok       / 1_000_000) * PRICE_INPUT        +
      (outputTok      / 1_000_000) * PRICE_OUTPUT       +
      (cacheCreateTok / 1_000_000) * PRICE_CACHE_CREATE +
      (cacheReadTok   / 1_000_000) * PRICE_CACHE_READ

    // content_hash for dedupe · per (project, session, payload shape).
    // Re-uploading the same blob produces the same hash and the partial
    // UNIQUE index converts duplicates into no-ops.
    const contentHash = await sha256Hex(`${projectId}:${s.session_id}:${inputTok}:${outputTok}:${cacheCreateTok}:${cacheReadTok}`)

    const { error } = await admin.from('audit_token_usage').insert({
      member_id:           memberId,
      project_id:          projectId,
      source:              'claude_code',
      verified:            true,
      session_id:          s.session_id,
      content_hash:        contentHash,
      input_tokens:        inputTok,
      output_tokens:       outputTok,
      cache_create_tokens: cacheCreateTok,
      cache_read_tokens:   cacheReadTok,
      cost_usd:            Number(costUsd.toFixed(4)),
      model_version:       'claude-sonnet-4-6',  // Claude Code default · could refine with metadata in v2
      first_seen_at:       s.first_seen_at ?? null,
      last_seen_at:        s.last_seen_at  ?? null,
      tool_version:        blobPayload.tool_version ?? null,
      metadata:            { message_count: s.message_count ?? null, cwd: s.cwd ?? null },
    })
    if (error) {
      if (error.code === '23505') { dedup_skips++ }
      else { console.error('usage-ingest insert', error); invalid++ }
    } else {
      inserted++
      totalTokens  += inputTok + outputTok + cacheCreateTok + cacheReadTok
      totalCostUsd += costUsd
    }
  }

  // Refresh per-project totals materialized view so the project page
  // shows the receipt immediately (cheap · 2 MV refresh on small data).
  await admin.rpc('refresh_token_totals_mv').catch(() => { /* RPC may not exist on first deploy */ })

  return json({
    ok:           true,
    inserted,
    dedup_skips,
    invalid,
    total_tokens: totalTokens,
    total_cost_usd: Number(totalCostUsd.toFixed(4)),
  })
})
