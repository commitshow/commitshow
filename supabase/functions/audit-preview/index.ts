// audit-preview — public-facing entrypoint for CLI previews on unregistered repos.
//
// Flow:
//   1. Normalize github_url → canonical owner/repo
//   2. Rate limit per IP (preview_rate_limits table · 5/day anon, 20/day authed)
//   3. Look up existing project row by github_url
//      · exists + fresh snapshot (< 7d) → return cached (no cost)
//      · exists + stale → trigger analyze-project (1 Claude call)
//      · not found → create preview row + trigger analyze-project
//   4. Return the snapshot JSON the CLI already consumes
//
// Design contract:
//   · Preview rows use status='preview' + season_id=null · all public feeds
//     already filter these out (projectQueries uses explicit status lists ·
//     season_standings requires season_id is not null).
//   · Preview rows can be "upgraded" to full audition by /submit if the same
//     github_url is re-submitted by its owner (logic lives in /submit, not here).
//   · Full Claude depth — expert_panel + scout_brief 5+3 + axis_scores — is
//     preserved. The only things preview projects DON'T get are Scout forecasts,
//     season ranking, Hall of Fame, and applauds (all gated by real audition).

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

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000   // 7 days per-URL cache
const RATE_ANON    = 5                          // preview calls per day
const RATE_AUTHED  = 20

// Canonicalize `https://github.com/Owner/repo.git/` → `https://github.com/owner/repo`
function canonicalGithub(url: string): { canonical: string; slug: string } | null {
  const m = url.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i)
  if (!m) return null
  const owner = m[1]
  const repo  = m[2].replace(/\.git$/i, '')
  return {
    canonical: `https://github.com/${owner}/${repo}`,
    slug:      `${owner}/${repo}`,
  }
}

function ipHash(req: Request): string {
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  // Simple non-crypto hash · bucket-level attribution is enough for rate limiting.
  let h = 5381
  for (let i = 0; i < ip.length; i++) h = ((h << 5) + h + ip.charCodeAt(i)) | 0
  return `ip_${(h >>> 0).toString(36)}`
}

async function enforceRateLimit(admin: any, req: Request): Promise<{ ok: true } | { ok: false; message: string; limit: number; count: number }> {
  const auth = req.headers.get('authorization')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const isAuthed = !!auth && auth !== `Bearer ${anonKey}` && auth !== 'Bearer '
  const limit = isAuthed ? RATE_AUTHED : RATE_ANON
  const key = ipHash(req)
  const today = new Date().toISOString().slice(0, 10)

  // Single atomic increment via RPC · returns post-increment count.
  const { data, error } = await admin.rpc('increment_preview_rate_limit', { p_ip_hash: key, p_day: today })
  if (error) {
    console.error('rate_limit rpc failed', error.message)
    return { ok: true }  // fail open · don't block users on our own infra hiccup
  }
  const count = typeof data === 'number' ? data : 1

  if (count > limit) {
    return { ok: false, message: `Rate limit exceeded (${limit}/day). Try tomorrow or sign in for a higher cap.`, limit, count }
  }
  return { ok: true }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let body: { github_url?: string; live_url?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (!body.github_url) return json({ error: 'github_url required' }, 400)

  const canon = canonicalGithub(body.github_url)
  if (!canon) return json({ error: 'Not a GitHub URL', input: body.github_url }, 400)

  // Rate limit
  const rl = await enforceRateLimit(admin, req)
  if (!rl.ok) return json({ error: 'rate_limited', message: rl.message, limit: rl.limit, count: rl.count }, 429)

  // 1. Look up existing project by canonical github_url
  const { data: existing } = await admin
    .from('projects')
    .select('id, project_name, github_url, live_url, score_total, score_auto, score_forecast, score_community, status, creator_id, creator_name, creator_grade, last_analysis_at, season_id')
    .ilike('github_url', `${canon.canonical}%`)
    .limit(1)
    .maybeSingle()

  let projectId: string
  let isCacheHit = false

  if (existing) {
    projectId = existing.id
    // Cache hit if a snapshot exists and is younger than CACHE_TTL_MS
    const { data: lastSnap } = await admin
      .from('analysis_snapshots')
      .select('created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastSnap?.created_at) {
      const age = Date.now() - new Date(lastSnap.created_at).getTime()
      if (age < CACHE_TTL_MS) isCacheHit = true
    }
  } else {
    // 2. Create a preview shadow project row
    const { data: created, error: createErr } = await admin
      .from('projects')
      .insert({
        github_url:   canon.canonical,
        live_url:     body.live_url ?? null,
        project_name: canon.slug.split('/')[1],
        status:       'preview',
        season_id:    null,
        description:  `Preview audit · ${canon.slug}`,
      })
      .select('id')
      .single()
    if (createErr || !created) return json({ error: 'Failed to create preview project', detail: createErr?.message }, 500)
    projectId = created.id
  }

  // 3. Cache hit — return the cached envelope immediately.
  if (isCacheHit) {
    return json(await buildEnvelope(admin, projectId, true))
  }

  // 3b. Cache miss — fire analyze-project in the background via
  // EdgeRuntime.waitUntil and respond with 202 + project_id so the CLI
  // can poll. Chained fetch would hit the 60s edge wall for Claude runs.
  const analyzeUrl = `${SUPABASE_URL}/functions/v1/analyze-project`
  const analyzePromise = fetch(analyzeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ project_id: projectId, trigger_type: existing ? 'resubmit' : 'initial' }),
  }).catch(e => console.error('bg analyze failed', e?.message ?? e))

  // @ts-ignore — EdgeRuntime is injected by Supabase
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(analyzePromise)

  return new Response(JSON.stringify({
    project_id:  projectId,
    status:      'running',
    is_preview:  !existing,
    cache_hit:   false,
    poll_after_ms: 5000,
  }), {
    status: 202,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})

async function buildEnvelope(admin: any, projectId: string, cacheHit: boolean) {
  const { data: proj } = await admin
    .from('projects')
    .select('id, project_name, github_url, live_url, score_total, score_auto, score_forecast, score_community, status, creator_id, creator_name, creator_grade, last_analysis_at')
    .eq('id', projectId)
    .single()

  const { data: snap } = await admin
    .from('analysis_snapshots')
    .select('id, project_id, created_at, trigger_type, score_total, score_auto, score_forecast, score_community, score_total_delta, rich_analysis')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    project:    proj,
    snapshot:   snap,
    standing:   null,
    is_preview: proj?.status === 'preview',
    cache_hit:  cacheHit,
  }
}
