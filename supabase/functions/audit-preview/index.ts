// audit-preview — public-facing entrypoint for CLI previews on unregistered repos.
//
// Flow:
//   1. Normalize github_url → canonical owner/repo
//   2. Look up existing project row by github_url
//      · exists + fresh snapshot (< 7d) → return cached (free, lightweight rate-limit)
//      · cache miss → 3-tier rate limit · then trigger analyze-project · respond 202
//   3. CLI polls projects.last_analysis_at until snapshot lands.
//
// Rate-limit tiers (preview_rate_limits table · all keyed by `key text, day date`)
//
//   · IP cap           ip:<hash>        anon 5/day · authed 20/day
//                                       Defends against single-source scraping.
//                                       Counted on EVERY request (cache hit too)
//                                       so a bot can't scrape cached data unbounded.
//
//   · URL cap          url:<hash>       global 5/day per github_url
//                                       Defends against the same URL being audited
//                                       hundreds of times via IP rotation.
//                                       Counted only on cache miss (real Claude cost).
//
//   · Global cap       global           total 800 cache-miss audits/day platform-wide
//                                       Hard ceiling on Claude spend
//                                       (≈ $40-80/day worst case at $0.05-0.10/audit).
//                                       Counted only on cache miss.
//
// Login is intentionally NOT required — the anonymous-friendly CLI is the
// viral wedge. All defences here are economic / per-resource, not identity.
//
// Design contract:
//   · Preview rows use status='preview' + season_id=null · all public feeds
//     already filter these out.
//   · Full Claude depth — expert_panel + scout_brief 5+3 + axis_scores —
//     is preserved for previews.

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

const CACHE_TTL_MS         = 7 * 24 * 60 * 60 * 1000   // 7 days per-URL cache (when commit_sha unknown / probe fails)
const CACHE_LONG_TTL_MS    = 30 * 24 * 60 * 60 * 1000  // 30 days when commit_sha matches (code unchanged → only ecosystem drift)

// Fetch the current HEAD commit sha for a public GitHub repo.
// Used to invalidate cache early when the repo has been pushed since
// the last snapshot. Returns null on any failure (rate-limit / private /
// network) so the caller can fall back to time-based TTL.
async function fetchGithubHead(slug: string): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const headers: Record<string, string> = { 'accept': 'application/vnd.github+json', 'user-agent': 'commit.show-cache/1.0' }
    const ghToken = Deno.env.get('GITHUB_TOKEN')
    if (ghToken) headers['authorization'] = `Bearer ${ghToken}`
    const r = await fetch(`https://api.github.com/repos/${slug}/commits?per_page=1`, { headers, signal: ctrl.signal })
    clearTimeout(timer)
    if (!r.ok) return null
    const j = await r.json() as Array<{ sha?: string }>
    return j[0]?.sha ?? null
  } catch {
    return null
  }
}
const RATE_ANON_PER_IP     = 5                          // anon IP cap
const RATE_AUTHED_PER_IP   = 50                         // authed IP cap · early-launch generous (revisit when real traffic ramps)
const RATE_PER_URL_GLOBAL  = 5                          // per github_url cap (any IP)
const RATE_GLOBAL_DAILY    = 2000                       // platform-wide cache-miss cap · bumped 800 → 2000 (2026-05-03) for viral launch headroom

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

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// Fetch a repo's GitHub-side `homepage` field — that's where most maintainers
// declare the deployed URL (shadcn-ui/ui → ui.shadcn.com · etc). Without
// this, walk-on previews lose Lighthouse + completeness + Live URL bonuses
// (≈ 30/50 of the Audit pillar) and score wildly low for polished projects.
//
// GitHub anonymous limit is 60/hr/IP; if GITHUB_TOKEN is set we use it for
// 5,000/hr. Failures are silent — no live_url just means we proceed without
// Lighthouse, same as before this fix.
async function inferLiveUrlFromGithub(slug: string): Promise<string | null> {
  const token = Deno.env.get('GITHUB_TOKEN')
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}`, {
      headers: {
        'User-Agent': 'commit.show-audit-preview/1',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!res.ok) return null
    const j = await res.json()
    const raw = typeof j.homepage === 'string' ? j.homepage.trim() : ''
    if (!raw) return null
    // Accept https://… and http://…; reject mailto:/javascript:/empty.
    if (!/^https?:\/\//i.test(raw)) return null
    return raw
  } catch (e) {
    console.error('infer_live_url failed', slug, (e as Error)?.message ?? e)
    return null
  }
}

// Pre-flight repo accessibility probe. Returns one of:
//   · { ok: true }                  → repo is public · proceed with audit
//   · { ok: false, reason: ... }    → bail early with a friendly error
//
// 404 from anonymous GitHub API can mean private OR truly missing OR
// soft-deleted · GitHub deliberately can't distinguish them without
// auth. We surface both as 'private_or_missing' so the CLI / web can
// show one clear message instead of a misleading score=4 'ghost repo'
// snapshot. Network errors and 5xx are treated as transient · we let
// the audit proceed (analyze-project has its own retries).
async function checkRepoAccessible(slug: string): Promise<
  | { ok: true }
  | { ok: false; reason: 'private_or_missing'; status: 404 }
  | { ok: false; reason: 'rate_limited'; status: 403 }
> {
  const token = Deno.env.get('GITHUB_TOKEN')
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const r = await fetch(`https://api.github.com/repos/${slug}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'commit.show-audit-preview/1',
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (r.status === 404) return { ok: false, reason: 'private_or_missing', status: 404 }
    // 403 with rate-limit headers · still let the audit proceed (analyze-
    // project will hit the same wall and downgrade gracefully) but flag
    // for the caller. Don't bail on transient 403 alone.
    if (r.status === 403) {
      const remaining = r.headers.get('x-ratelimit-remaining')
      if (remaining === '0') return { ok: false, reason: 'rate_limited', status: 403 }
    }
    // Treat anything else (200, 301, 5xx, network) as 'proceed' — analyze-
    // project owns the deeper validation. Pre-flight only catches the
    // obvious dead-on-arrival case.
    return { ok: true }
  } catch {
    // Network error / timeout · let the audit run anyway · its own
    // GitHub fetch will hit the same path and handle gracefully.
    return { ok: true }
  }
}

function ipKey(req: Request): string {
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  return `ip:${djb2(ip)}`
}

function urlKey(slug: string): string {
  return `url:${djb2(slug.toLowerCase())}`
}

function isAuthed(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  return !!auth && auth !== `Bearer ${anon}` && auth !== 'Bearer '
}

// Admin bypass · headers-based. When the request includes an
// `x-admin-token` header that matches the server-side ADMIN_TOKEN secret,
// rate limits (IP / URL / global) are skipped entirely. Used by the
// /admin page to debug pipelines + force audits without hitting caps.
function isAdmin(req: Request): boolean {
  const token  = req.headers.get('x-admin-token') ?? ''
  const secret = Deno.env.get('ADMIN_TOKEN') ?? ''
  return !!secret && token === secret
}

// Single bump+read against preview_rate_limits via the existing RPC.
// Returns { count, limit, ok } so callers can decide what to do.
async function bumpAndCheck(
  admin: any,
  bucketKey: string,
  limit: number,
  today: string,
): Promise<{ ok: boolean; count: number; limit: number }> {
  const { data, error } = await admin.rpc('increment_preview_rate_limit', {
    p_ip_hash: bucketKey,   // RPC's column is named ip_hash but stores arbitrary key
    p_day:     today,
  })
  if (error) {
    // Fail open — never block legitimate users on our own infra hiccup.
    console.error('rate_limit rpc failed', bucketKey, error.message)
    return { ok: true, count: 0, limit }
  }
  const count = typeof data === 'number' ? data : 1
  return { ok: count <= limit, count, limit }
}

// Quota breakdown surfaced to clients on every response. CLI uses this to
// show "remaining today" hints + countdown to reset.
interface RateQuota {
  reset_at:        string                          // ISO 8601 · next UTC midnight
  ip:     { count: number; limit: number; remaining: number; tier: 'anon' | 'authed' }
  url:    { count: number; limit: number; remaining: number }
  global: { count: number; limit: number; remaining: number }
}

interface RateLimitDecision {
  ok:    true
  quota: RateQuota
}

interface RateLimitDeny {
  ok:      false
  reason:  'ip_cap' | 'url_cap' | 'global_cap'
  message: string
  limit:   number
  count:   number
  quota:   RateQuota
}

function nextResetIso(): string {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return next.toISOString()
}

// Read current count without bumping — used when we want to surface remaining
// quota without burning budget (e.g., cache hits).
async function peekCount(admin: any, key: string, today: string): Promise<number> {
  const { data } = await admin
    .from('preview_rate_limits')
    .select('count')
    .eq('ip_hash', key)
    .eq('day', today)
    .maybeSingle()
  return data?.count ?? 0
}

// 3-tier rate limit. The IP cap is enforced on every request (cheap defence
// against scraping cached data). URL + global caps are enforced only when
// the request will actually cost a Claude call (cache miss).
async function enforceRateLimit(
  admin: any,
  req: Request,
  slug: string,
  willCostClaude: boolean,
): Promise<RateLimitDecision | RateLimitDeny> {
  const today = new Date().toISOString().slice(0, 10)
  const reset_at = nextResetIso()
  const authed = isAuthed(req)
  const ipLimit = authed ? RATE_AUTHED_PER_IP : RATE_ANON_PER_IP

  // 1. IP cap — always
  const ip = await bumpAndCheck(admin, ipKey(req), ipLimit, today)
  if (!ip.ok) {
    const urlPeek    = willCostClaude ? await peekCount(admin, urlKey(slug), today) : 0
    const globalPeek = willCostClaude ? await peekCount(admin, 'global', today)      : 0
    return {
      ok: false, reason: 'ip_cap', limit: ip.limit, count: ip.count,
      message: `Daily limit hit (${ip.limit} audits/day per IP).`,
      quota: {
        reset_at,
        ip:     { count: ip.count, limit: ip.limit, remaining: 0, tier: authed ? 'authed' : 'anon' },
        url:    { count: urlPeek,    limit: RATE_PER_URL_GLOBAL, remaining: Math.max(0, RATE_PER_URL_GLOBAL - urlPeek) },
        global: { count: globalPeek, limit: RATE_GLOBAL_DAILY,   remaining: Math.max(0, RATE_GLOBAL_DAILY   - globalPeek) },
      },
    }
  }

  if (!willCostClaude) {
    // Cache hit — only IP was bumped. Peek other counters so the client can
    // still show full quota state.
    const urlPeek    = await peekCount(admin, urlKey(slug), today)
    const globalPeek = await peekCount(admin, 'global', today)
    return {
      ok: true,
      quota: {
        reset_at,
        ip:     { count: ip.count, limit: ip.limit, remaining: Math.max(0, ip.limit - ip.count), tier: authed ? 'authed' : 'anon' },
        url:    { count: urlPeek,    limit: RATE_PER_URL_GLOBAL, remaining: Math.max(0, RATE_PER_URL_GLOBAL - urlPeek) },
        global: { count: globalPeek, limit: RATE_GLOBAL_DAILY,   remaining: Math.max(0, RATE_GLOBAL_DAILY   - globalPeek) },
      },
    }
  }

  // 2. Per-URL global cap — only when about to spend
  const url = await bumpAndCheck(admin, urlKey(slug), RATE_PER_URL_GLOBAL, today)
  if (!url.ok) {
    const globalPeek = await peekCount(admin, 'global', today)
    return {
      ok: false, reason: 'url_cap', limit: url.limit, count: url.count,
      message: `This repo has been audited ${url.count} times today (cap ${url.limit}). Cached results stay valid for 7 days.`,
      quota: {
        reset_at,
        ip:     { count: ip.count, limit: ip.limit, remaining: Math.max(0, ip.limit - ip.count), tier: authed ? 'authed' : 'anon' },
        url:    { count: url.count, limit: url.limit, remaining: 0 },
        global: { count: globalPeek, limit: RATE_GLOBAL_DAILY, remaining: Math.max(0, RATE_GLOBAL_DAILY - globalPeek) },
      },
    }
  }

  // 3. Global daily cap — last line of defence on Claude spend
  const global = await bumpAndCheck(admin, 'global', RATE_GLOBAL_DAILY, today)
  if (!global.ok) {
    return {
      ok: false, reason: 'global_cap', limit: global.limit, count: global.count,
      // "Sold out" framing instead of "service down" — capacity hit is a
      // demand signal, not a bug. Mirror copy in _shared/rateLimit.ts.
      message: `commit.show is at capacity today — ${global.count.toLocaleString()} audits already ran and every fresh slot is taken. Cached reports still load instantly. Fresh runs resume after the daily reset (UTC midnight) · come back tomorrow.`,
      quota: {
        reset_at,
        ip:     { count: ip.count, limit: ip.limit, remaining: Math.max(0, ip.limit - ip.count), tier: authed ? 'authed' : 'anon' },
        url:    { count: url.count, limit: url.limit, remaining: Math.max(0, url.limit - url.count) },
        global: { count: global.count, limit: global.limit, remaining: 0 },
      },
    }
  }

  return {
    ok: true,
    quota: {
      reset_at,
      ip:     { count: ip.count,     limit: ip.limit,     remaining: Math.max(0, ip.limit     - ip.count),     tier: authed ? 'authed' : 'anon' },
      url:    { count: url.count,    limit: url.limit,    remaining: Math.max(0, url.limit    - url.count) },
      global: { count: global.count, limit: global.limit, remaining: Math.max(0, global.limit - global.count) },
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let body: {
    github_url?: string
    live_url?:   string
    force?:      boolean
    source?:     string | null
    workspace?:  string | null
  }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (!body.github_url) return json({ error: 'github_url required' }, 400)
  const force  = body.force === true
  const source = (body.source ?? '').toString().trim().slice(0, 64) || null
  // Workspace override · tells analyze-project to skip its monorepo
  // auto-pick and use this exact path as app_root. Validated below
  // against the actual repo tree so a typo gets a clean error.
  const workspace = (body.workspace ?? '')
    .toString()
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .slice(0, 256) || null

  // Resolve authenticated caller (CLI device-flow JWT or browser session
  // JWT). When present + not a project bot, we'll stamp creator_id on
  // newly created preview projects so logged-in CLI users immediately
  // own their audited repos. Best-effort · failure falls back to
  // anonymous walk-on.
  let authedUserId: string | null = null
  if (isAuthed(req)) {
    try {
      const callerJwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
      const { data: userData } = await admin.auth.getUser(callerJwt)
      if (userData?.user?.id) authedUserId = userData.user.id
    } catch { /* anonymous fallback */ }
  }

  // Capture User-Agent for telemetry · format the CLI sends:
  //   commitshow-cli/<ver> node/<v> <platform>-<arch>
  // Falls back to the raw header for non-CLI callers (curl · web etc).
  const rawUA = req.headers.get('user-agent') ?? ''
  const uaParts = rawUA.match(/commitshow-cli\/(\S+)\s+node\/(\S+)\s+(\S+)/i)
  const cliVersion  = uaParts?.[1] ?? null
  const nodeVersion = uaParts?.[2] ?? null
  const platformStr = uaParts?.[3] ?? null
  const xSource     = (req.headers.get('x-commitshow-source') ?? '').trim().slice(0, 64) || null
  const sourceFinal = source || xSource || null

  const canon = canonicalGithub(body.github_url)
  if (!canon) return json({ error: 'Not a GitHub URL', input: body.github_url }, 400)

  // Pre-flight accessibility probe · catches 404 (private OR missing
  // OR soft-deleted) before we burn rate-limit budget or pollute the
  // DB with a score=4 'ghost repo' snapshot. The CLI renderer + web
  // /audit page handle the error envelope with a clear "we can't see
  // this repo" message + remediation hints (private repos · typo ·
  // deleted). 2026-05-08 · prevents the silent-fail UX where users
  // see a 4/100 and assume their project actually scored that.
  const probe = await checkRepoAccessible(canon.slug)
  if (!probe.ok && probe.reason === 'private_or_missing') {
    return json({
      error:        'github_inaccessible',
      reason:       'private_or_missing',
      slug:         canon.slug,
      github_url:   canon.canonical,
      message:      "We can't see this repo. It might be private, the URL might have a typo, or the repo was deleted. We only audit public GitHub repositories.",
      hints: [
        'Public repos only · private audit is on the V1.5 roadmap',
        'Check the URL for typos (case-sensitive owner/repo)',
        'If this is your repo, make it public temporarily and re-run',
      ],
    }, 404)
  }

  // Look up existing project + last snapshot to decide cache hit before we
  // spend any rate-limit budget on URL/global caps.
  const { data: existing } = await admin
    .from('projects')
    .select('id, project_name, github_url, live_url, score_total, score_auto, score_forecast, score_community, status, creator_id, creator_name, creator_grade, last_analysis_at, season_id')
    .ilike('github_url', `${canon.canonical}%`)
    .limit(1)
    .maybeSingle()

  // Resolve final live_url: explicit > existing row > GitHub homepage fetch.
  // Without this, walk-ons of polished libraries (e.g. shadcn-ui/ui) lose
  // ~30 pts they could've earned on Lighthouse + completeness + Live URL.
  let liveUrlEffective: string | null = body.live_url ?? existing?.live_url ?? null
  if (!liveUrlEffective) {
    liveUrlEffective = await inferLiveUrlFromGithub(canon.slug)
  }

  let projectId: string | null = existing?.id ?? null
  let isCacheHit = false
  let cacheReason: string = 'no existing project'

  if (existing && !force) {
    const { data: lastSnap } = await admin
      .from('analysis_snapshots')
      .select('created_at, commit_sha')
      .eq('project_id', existing.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastSnap?.created_at) {
      const age = Date.now() - new Date(lastSnap.created_at).getTime()
      // Commit-sha aware cache (added 2026-04-28):
      //   1. If we can probe the current HEAD sha AND it differs from the
      //      last snapshot's sha → INVALIDATE regardless of TTL (fresh
      //      push, user wants the new state reflected).
      //   2. If commit_sha matches → extend TTL to 30 days (code is
      //      identical; only ecosystem drift like npm dl / stars / LH
      //      score timing matters, and that's lower-stakes).
      //   3. If sha probe fails → fall back to default 7-day TTL.
      const lastSha    = (lastSnap as { commit_sha?: string | null }).commit_sha ?? null
      const headSha    = await fetchGithubHead(canon.slug)
      const shaKnown   = !!(lastSha && headSha)
      const shaMatch   = shaKnown && lastSha === headSha
      const shaDiffer  = shaKnown && lastSha !== headSha
      if (shaDiffer) {
        isCacheHit  = false
        cacheReason = `commit_sha changed (${(lastSha ?? '').slice(0, 7)} → ${(headSha ?? '').slice(0, 7)}) — invalidating cache`
      } else if (shaMatch && age < CACHE_LONG_TTL_MS) {
        isCacheHit  = true
        cacheReason = `commit_sha unchanged (${lastSha!.slice(0, 7)}) within 30-day extended TTL`
      } else if (age < CACHE_TTL_MS) {
        isCacheHit  = true
        cacheReason = shaKnown ? 'within 7-day TTL · sha not compared' : 'within 7-day TTL · sha probe failed'
      } else {
        isCacheHit  = false
        cacheReason = `last snapshot ${Math.round(age / (24 * 60 * 60 * 1000))}d old · TTL exceeded`
      }
    }
  }

  // Admin bypass · skips ALL rate limits + still surfaces a quota snapshot
  // (with admin: true marker) so the response shape stays consistent.
  const isAdminReq = isAdmin(req)
  const today = new Date().toISOString().slice(0, 10)
  const rl: RateLimitDecision | RateLimitDeny = isAdminReq
    ? {
        ok: true,
        quota: {
          reset_at: nextResetIso(),
          ip:     { count: 0, limit: 9999, remaining: 9999, tier: 'authed' as const, admin: true } as RateQuota['ip'] & { admin: true },
          url:    { count: 0, limit: 9999, remaining: 9999 },
          global: { count: 0, limit: 9999, remaining: 9999 },
        } as RateQuota,
      }
    : await enforceRateLimit(admin, req, canon.slug, /*willCostClaude*/ !isCacheHit)
  if (!rl.ok) return json({
    error:   'rate_limited',
    reason:  rl.reason,
    message: rl.message,
    limit:   rl.limit,
    count:   rl.count,
    quota:   rl.quota,
  }, 429)

  // Telemetry · log every CLI call for the /admin > CLI 사용 dashboard.
  // Best-effort · failure here doesn't block the response.
  const logCall = async (extra: { engine_fired: boolean; snapshot_id?: string | null }) => {
    try {
      await admin.from('cli_audit_calls').insert({
        source:        sourceFinal,
        cli_version:   cliVersion,
        node_version:  nodeVersion,
        platform:      platformStr,
        ip_hash:       ipKey(req),
        url_hash:      urlKey(canon.slug),
        github_url:    canon.canonical,
        cache_hit:     isCacheHit,
        engine_fired:  extra.engine_fired,
        snapshot_id:   extra.snapshot_id ?? null,
        raw_user_agent: rawUA.slice(0, 256),
      })
    } catch (e) { console.warn('[audit-preview] cli_audit_calls insert failed', (e as Error)?.message) }
  }

  // Cache hit — return immediately. cache_reason surfaces WHY the
  // cached snapshot was reused (commit_sha match · TTL · etc.) so
  // downstream tooling can show "no recent push" UX without re-checking.
  if (isCacheHit && projectId) {
    const env = await buildEnvelope(admin, projectId, true)
    void logCall({ engine_fired: false, snapshot_id: null })
    return json({ ...env, quota: rl.quota, cache_reason: cacheReason })
  }

  // Cache miss — create shadow row if needed
  if (!projectId) {
    const { data: created, error: createErr } = await admin
      .from('projects')
      .insert({
        github_url:   canon.canonical,
        live_url:     liveUrlEffective,
        project_name: canon.slug.split('/')[1],
        // Authenticated CLI / web caller claims ownership immediately ·
        // anon walk-ons stay creator_id=null and the project surfaces
        // as a preview-only row that can be claimed later.
        creator_id:   authedUserId,
        status:       'preview',
        season_id:    null,
        description:  `Preview audit · ${canon.slug}`,
      })
      .select('id')
      .single()
    if (createErr || !created) return json({ error: 'Failed to create preview project', detail: createErr?.message }, 500)
    projectId = created.id
  } else if (existing && !existing.creator_id && authedUserId) {
    // Existing anonymous preview row · authenticated caller claims it.
    // Useful when the same repo was audited by the same user twice —
    // first run was logged out, login happens, second run claims.
    await admin.from('projects').update({ creator_id: authedUserId }).eq('id', projectId)
  } else if (liveUrlEffective && !existing?.live_url) {
    // Existing row · backfill live_url so analyze-project picks it up. No
    // delta-tracking needed — the next snapshot will reflect the change.
    await admin.from('projects').update({ live_url: liveUrlEffective }).eq('id', projectId)
  }

  // Fire analyze-project in the background — chained fetch would hit edge wall
  const analyzeUrl = `${SUPABASE_URL}/functions/v1/analyze-project`
  const analyzePromise = fetch(analyzeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({
      project_id:    projectId,
      trigger_type:  existing ? 'resubmit' : 'initial',
      workspace,    // null = let analyze-project auto-pick · string = explicit override
    }),
  }).catch(e => console.error('bg analyze failed', e?.message ?? e))

  // @ts-ignore — EdgeRuntime is injected by Supabase
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(analyzePromise)

  // engine_fired=true · we kicked off analyze-project (snapshot lands async).
  // snapshot_id will be filled in by the analyze-project run; for the call
  // log we just record that the engine was triggered.
  void logCall({ engine_fired: true, snapshot_id: null })

  return new Response(JSON.stringify({
    project_id:    projectId,
    status:        'running',
    is_preview:    !existing,
    cache_hit:     false,
    cache_reason:  cacheReason,
    poll_after_ms: 5000,
    quota:         rl.quota,
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
