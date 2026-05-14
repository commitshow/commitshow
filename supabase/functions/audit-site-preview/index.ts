// audit-site-preview — public-facing entrypoint for URL Fast Lane (§15-E).
//
// Sister of audit-preview, but takes a deployed site URL instead of a
// GitHub URL. No repo means no Source Hygiene · Production Maturity (most
// of it) · Tech Diversity · Brief Integrity slots — partial audit cap
// ~32/50 by design. Trade-off accepted in exchange for:
//   · closed-source SaaS founders entering the platform (90%+ of bias)
//   · viral "audit this URL" hook (paste-anyone's-site memes)
//   · 30-second first-touch with login-after-result funnel
//
// Flow:
//   1. Normalize site_url → canonical origin
//   2. Look up existing preview project by live_url (status='preview' · github_url IS NULL)
//      · exists + fresh snapshot (< 7d) → return cached
//      · cache miss → 3-tier rate limit (IP + per-domain + global) → trigger analyze-project → 202
//   3. Web hook polls projects.last_analysis_at until snapshot lands.
//
// Rate limits (preview_rate_limits — same table as CLI walk-on):
//   · IP cap         ip:<hash>        anon 5/day · authed 50/day  (cached + fresh)
//   · Domain cap     domain:<host>    5/day per-domain (cache miss only)
//   · Global cap     global           shared with audit-preview · 2000/day cache-miss platform-wide
//
// Login is intentionally NOT required to invoke — the result page funnels
// users to login post-result (try-then-signup pattern). Anonymous walk-on
// audits stay creator_id=null and surface as preview rows; ladder/HoF
// auto-tweet are gated by §18-B.4 (status != 'preview' AND creator_id IS NOT NULL).

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

const CACHE_TTL_MS         = 7 * 24 * 60 * 60 * 1000   // 7 days · same as CLI walk-on
const RATE_ANON_PER_IP     = 3                         // 2026-05-09 · was 5 · CF free tier 60-120/day cap binding ahead of this anyway
const RATE_AUTHED_PER_IP   = 10                        // 2026-05-09 · was 50 · power-users still fine, abuse vector tightened
const RATE_PER_DOMAIN      = 5                         // §15-E.4 abuse defense — same domain ≤5/day
const RATE_GLOBAL_DAILY    = 2000                      // shared global ceiling with audit-preview

// Reject result tag · the caller can distinguish 'malformed input' from
// 'GitHub repo URL accidentally pasted here'.
type CanonResult =
  | { ok: true;  origin: string; host: string }
  | { ok: false; reason: 'invalid' | 'blocked_host' | 'repo_url' }

// Canonical origin: `https://Example.COM/path?x=1#h` → `https://example.com`.
// `www.` stripped so foo.com / www.foo.com dedupe to the same row.
//
// Special case · GitHub repo URLs (`github.com/owner/repo[/...]`). Before
// 2026-05-15 these silently collapsed to `https://github.com` and audited
// the GitHub homepage — every repo paste produced the same useless row.
// Now we reject them with reason='repo_url' so the caller can route the
// request to the CLI walk-on path (audit-preview · which actually reads
// the repo).
function canonicalSiteUrl(input: string): CanonResult {
  try {
    const trimmed = input.trim()
    if (!/^https?:\/\//i.test(trimmed)) return { ok: false, reason: 'invalid' }
    const u = new URL(trimmed)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'invalid' }
    const host = u.host.toLowerCase().replace(/^www\./, '')
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
      return { ok: false, reason: 'blocked_host' }
    }
    if (host === 'commit.show' || host.endsWith('.commit.show')) {
      return { ok: false, reason: 'blocked_host' }
    }
    // GitHub repo URL · 'github.com/owner/repo' (path with at least 2 segments)
    // belongs on the CLI walk-on path, not the URL fast lane.
    if (host === 'github.com' && /^\/[^/]+\/[^/]+/.test(u.pathname)) {
      return { ok: false, reason: 'repo_url' }
    }
    return { ok: true, origin: `${u.protocol}//${host}`, host }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function ipKey(req: Request): string {
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  return `ip:${djb2(ip)}`
}

function domainKey(host: string): string {
  return `domain:${djb2(host)}`
}

function isAuthed(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  return !!auth && auth !== `Bearer ${anon}` && auth !== 'Bearer '
}

function isAdmin(req: Request): boolean {
  const token  = req.headers.get('x-admin-token') ?? ''
  const secret = Deno.env.get('ADMIN_TOKEN') ?? ''
  return !!secret && token === secret
}

async function bumpAndCheck(
  admin: any,
  bucketKey: string,
  limit: number,
  today: string,
): Promise<{ ok: boolean; count: number; limit: number }> {
  const { data, error } = await admin.rpc('increment_preview_rate_limit', {
    p_ip_hash: bucketKey,
    p_day:     today,
  })
  if (error) {
    console.error('rate_limit rpc failed', bucketKey, error.message)
    return { ok: true, count: 0, limit }   // fail open
  }
  const count = typeof data === 'number' ? data : 1
  return { ok: count <= limit, count, limit }
}

async function peekCount(admin: any, key: string, today: string): Promise<number> {
  const { data } = await admin
    .from('preview_rate_limits')
    .select('count')
    .eq('ip_hash', key)
    .eq('day', today)
    .maybeSingle()
  return data?.count ?? 0
}

function nextResetIso(): string {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return next.toISOString()
}

interface RateQuota {
  reset_at:        string
  ip:     { count: number; limit: number; remaining: number; tier: 'anon' | 'authed' }
  domain: { count: number; limit: number; remaining: number }
  global: { count: number; limit: number; remaining: number }
}

interface RateLimitDecision { ok: true; quota: RateQuota }
interface RateLimitDeny     { ok: false; reason: 'ip_cap' | 'domain_cap' | 'global_cap'; message: string; limit: number; count: number; quota: RateQuota }

async function enforceRateLimit(
  admin: any,
  req: Request,
  host: string,
  willCostClaude: boolean,
): Promise<RateLimitDecision | RateLimitDeny> {
  const today = new Date().toISOString().slice(0, 10)
  const reset_at = nextResetIso()
  const authed = isAuthed(req)
  const ipLimit = authed ? RATE_AUTHED_PER_IP : RATE_ANON_PER_IP
  const ipB = ipKey(req)

  // Always count IP (cache hit included — defends scraping cached data)
  const ip = await bumpAndCheck(admin, ipB, ipLimit, today)
  if (!ip.ok) {
    const dom = await peekCount(admin, domainKey(host), today)
    const glo = await peekCount(admin, 'global', today)
    return {
      ok: false, reason: 'ip_cap',
      message: `Daily limit reached for your IP (${ip.count}/${ip.limit}). Resets at midnight UTC.`,
      limit: ip.limit, count: ip.count,
      quota: {
        reset_at,
        ip:     { count: ip.count, limit: ip.limit, remaining: Math.max(0, ip.limit - ip.count), tier: authed ? 'authed' : 'anon' },
        domain: { count: dom, limit: RATE_PER_DOMAIN, remaining: Math.max(0, RATE_PER_DOMAIN - dom) },
        global: { count: glo, limit: RATE_GLOBAL_DAILY, remaining: Math.max(0, RATE_GLOBAL_DAILY - glo) },
      },
    }
  }

  if (!willCostClaude) {
    // Cache hit · skip domain/global caps but show current counts
    const dom = await peekCount(admin, domainKey(host), today)
    const glo = await peekCount(admin, 'global', today)
    return {
      ok: true,
      quota: {
        reset_at,
        ip:     { count: ip.count, limit: ip.limit, remaining: Math.max(0, ip.limit - ip.count), tier: authed ? 'authed' : 'anon' },
        domain: { count: dom, limit: RATE_PER_DOMAIN, remaining: Math.max(0, RATE_PER_DOMAIN - dom) },
        global: { count: glo, limit: RATE_GLOBAL_DAILY, remaining: Math.max(0, RATE_GLOBAL_DAILY - glo) },
      },
    }
  }

  // Cache miss · burn domain + global budget
  const [dom, glo] = await Promise.all([
    bumpAndCheck(admin, domainKey(host), RATE_PER_DOMAIN, today),
    bumpAndCheck(admin, 'global', RATE_GLOBAL_DAILY, today),
  ])
  if (!dom.ok) {
    return {
      ok: false, reason: 'domain_cap',
      message: `This domain hit the daily audit cap (${dom.count}/${dom.limit}). Try again after midnight UTC.`,
      limit: dom.limit, count: dom.count,
      quota: {
        reset_at,
        ip:     { count: ip.count, limit: ip.limit, remaining: Math.max(0, ip.limit - ip.count), tier: authed ? 'authed' : 'anon' },
        domain: { count: dom.count, limit: dom.limit, remaining: Math.max(0, dom.limit - dom.count) },
        global: { count: glo.count, limit: glo.limit, remaining: Math.max(0, glo.limit - glo.count) },
      },
    }
  }
  if (!glo.ok) {
    return {
      ok: false, reason: 'global_cap',
      message: `Platform-wide daily audit cap reached (${glo.count}/${glo.limit}). Resets at midnight UTC.`,
      limit: glo.limit, count: glo.count,
      quota: {
        reset_at,
        ip:     { count: ip.count, limit: ip.limit, remaining: Math.max(0, ip.limit - ip.count), tier: authed ? 'authed' : 'anon' },
        domain: { count: dom.count, limit: dom.limit, remaining: Math.max(0, dom.limit - dom.count) },
        global: { count: glo.count, limit: glo.limit, remaining: Math.max(0, glo.limit - glo.count) },
      },
    }
  }
  return {
    ok: true,
    quota: {
      reset_at,
      ip:     { count: ip.count, limit: ip.limit, remaining: Math.max(0, ip.limit - ip.count), tier: authed ? 'authed' : 'anon' },
      domain: { count: dom.count, limit: dom.limit, remaining: Math.max(0, dom.limit - dom.count) },
      global: { count: glo.count, limit: glo.limit, remaining: Math.max(0, glo.limit - glo.count) },
    },
  }
}

// DNS TXT opt-out (§15-E.4). If the domain owner has set
// `_commitshow.<domain> TXT "audit=no"`, we refuse to fetch — channel for
// owner-level global refusal that gstack-style competitors don't offer.
// Cheap (~50ms) · only one DoH lookup per audit · cached by Cloudflare DNS.
async function checkDnsOptOut(host: string): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1500)
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=_commitshow.${host}&type=TXT`, {
      headers: { accept: 'application/dns-json' },
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!r.ok) return false
    const j = await r.json() as { Answer?: Array<{ data?: string }> }
    if (!Array.isArray(j.Answer)) return false
    return j.Answer.some(a => /audit\s*=\s*no/i.test((a.data ?? '').replace(/^"|"$/g, '')))
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let body: { site_url?: string; force?: boolean; source?: string | null }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (!body.site_url) return json({ error: 'site_url required' }, 400)
  const force  = body.force === true
  const source = (body.source ?? '').toString().trim().slice(0, 64) || null

  const canon = canonicalSiteUrl(body.site_url)
  if (!canon.ok) {
    if (canon.reason === 'repo_url') {
      // GitHub repo URL pasted into the URL fast lane · forward to the
      // CLI walk-on path (audit-preview) which actually reads the repo.
      // Response shape is identical (same buildEnvelope output), so the
      // Hero hook renders the result with no extra branching.
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
      const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      try {
        const upstream = await fetch(`${SUPABASE_URL}/functions/v1/audit-preview`, {
          method: 'POST',
          headers: {
            'Content-Type':     'application/json',
            'Authorization':    `Bearer ${SERVICE_KEY}`,
            'cf-connecting-ip': req.headers.get('cf-connecting-ip') ?? '',
            'User-Agent':       req.headers.get('user-agent') ?? '',
          },
          body: JSON.stringify({
            github_url: body.site_url,
            force:      body.force === true,
            source:     body.source ?? 'hero-hook-repo-redirect',
          }),
        })
        const upstreamText = await upstream.text()
        return new Response(upstreamText, {
          status:  upstream.status,
          headers: { ...CORS, 'content-type': 'application/json' },
        })
      } catch (e) {
        return json({
          error:   'repo_url_forward_failed',
          message: `Couldn't reach the CLI walk-on audit path · ${(e as Error)?.message ?? 'unknown error'}`,
          input:   body.site_url,
        }, 502)
      }
    }
    return json({
      error:   'invalid_url',
      message: 'Provide a public https URL (e.g. https://yoursite.com). Localhost · private IPs · commit.show itself are blocked.',
      input:   body.site_url,
    }, 400)
  }

  // Resolve authenticated caller (browser session JWT). When present, stamp
  // creator_id on newly created previews so claim flow short-circuits.
  let authedUserId: string | null = null
  if (isAuthed(req)) {
    try {
      const callerJwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
      const { data: userData } = await admin.auth.getUser(callerJwt)
      if (userData?.user?.id) authedUserId = userData.user.id
    } catch { /* anonymous */ }
  }

  // DNS opt-out · skipped for admin overrides (debugging tools)
  if (!isAdmin(req)) {
    const optedOut = await checkDnsOptOut(canon.host)
    if (optedOut) {
      return json({
        error:   'domain_opted_out',
        host:    canon.host,
        message: `${canon.host} declined audits via DNS TXT (_commitshow record).`,
      }, 403)
    }
  }

  // Look up existing preview project for this origin
  const { data: existing } = await admin
    .from('projects')
    .select('id, project_name, live_url, score_total, score_auto, status, creator_id, last_analysis_at')
    .is('github_url', null)
    .eq('status', 'preview')
    .ilike('live_url', `${canon.origin}%`)
    .limit(1)
    .maybeSingle()

  let projectId: string | null = existing?.id ?? null

  // Cache hit decision · 7d TTL · skip if force=true
  let isCacheHit = false
  if (existing && existing.last_analysis_at && !force) {
    const age = Date.now() - new Date(existing.last_analysis_at).getTime()
    if (age < CACHE_TTL_MS) isCacheHit = true
  }

  // Admin bypass · skip rate limits entirely
  let rl: RateLimitDecision | RateLimitDeny
  if (isAdmin(req)) {
    rl = {
      ok: true,
      quota: {
        reset_at: nextResetIso(),
        ip:     { count: 0, limit: 9999, remaining: 9999, tier: 'authed' },
        domain: { count: 0, limit: 9999, remaining: 9999 },
        global: { count: 0, limit: 9999, remaining: 9999 },
      },
    }
  } else {
    rl = await enforceRateLimit(admin, req, canon.host, !isCacheHit)
    if (!rl.ok) {
      return json({
        error:   'rate_limited',
        reason:  rl.reason,
        message: rl.message,
        quota:   rl.quota,
      }, 429)
    }
  }

  // Telemetry · log into cli_audit_calls (same table used by audit-preview ·
  // source='web-fast-lane' or whatever the caller passed). github_url=null
  // distinguishes URL fast lane rows from CLI repo walk-ons. url_hash uses
  // the host so we can group repeat audits of the same domain in admin UI.
  async function logCall(extra: { engine_fired: boolean; snapshot_id: string | null; cache_hit: boolean }) {
    try {
      await admin.from('cli_audit_calls').insert({
        github_url:     null,                         // §15-E URL lane signal · null = no repo
        url_hash:       djb2(canon.host),             // joins with preview_rate_limits domain key
        ip_hash:        ipKey(req),
        cache_hit:      extra.cache_hit,
        engine_fired:   extra.engine_fired,
        snapshot_id:    extra.snapshot_id,
        source:         source ?? 'web-fast-lane',
        raw_user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
      })
    } catch (e) { console.warn('[audit-site-preview] cli_audit_calls insert failed', (e as Error)?.message) }
  }

  // Cache hit — return immediately
  if (isCacheHit && projectId) {
    const env = await buildEnvelope(admin, projectId, true)
    void logCall({ engine_fired: false, snapshot_id: null, cache_hit: true })
    return json({ ...env, quota: rl.quota })
  }

  // Cache miss — create preview row if needed
  if (!projectId) {
    const projectName = canon.host.replace(/^www\./, '')
    const { data: created, error: createErr } = await admin
      .from('projects')
      .insert({
        github_url:   null,                            // §15-E URL fast lane = no repo
        live_url:     canon.origin,
        project_name: projectName,
        creator_id:   authedUserId,                    // anon walk-on stays null · claimable later
        status:       'preview',
        season_id:    null,
        description:  `URL audit · ${canon.host}`,
      })
      .select('id')
      .single()
    if (createErr || !created) {
      return json({ error: 'Failed to create preview project', detail: createErr?.message }, 500)
    }
    projectId = created.id
  } else if (!existing!.creator_id && authedUserId) {
    await admin.from('projects').update({ creator_id: authedUserId }).eq('id', projectId)
  }

  // Fire analyze-project in background
  const analyzeUrl = `${SUPABASE_URL}/functions/v1/analyze-project`
  const analyzePromise = fetch(analyzeUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body:    JSON.stringify({
      project_id:   projectId,
      trigger_type: existing ? 'resubmit' : 'initial',
    }),
  }).catch(e => console.error('bg analyze failed', e?.message ?? e))

  // @ts-ignore EdgeRuntime injected by Supabase
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(analyzePromise)

  void logCall({ engine_fired: true, snapshot_id: null, cache_hit: false })

  return new Response(JSON.stringify({
    project_id:    projectId,
    status:        'running',
    is_preview:    !existing,
    cache_hit:     false,
    poll_after_ms: 5000,
    quota:         rl.quota,
  }), {
    status:  202,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})

async function buildEnvelope(admin: any, projectId: string, cacheHit: boolean) {
  const { data: proj } = await admin
    .from('projects')
    .select('id, project_name, live_url, score_total, score_auto, status, creator_id, last_analysis_at')
    .eq('id', projectId)
    .single()

  const { data: snap } = await admin
    .from('analysis_snapshots')
    .select('id, project_id, created_at, trigger_type, score_total, score_auto, score_total_delta, rich_analysis')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    project_id:    projectId,
    project:       proj,
    latest_snapshot: snap,
    cache_hit:     cacheHit,
    status:        snap ? 'ready' : 'running',
  }
}
