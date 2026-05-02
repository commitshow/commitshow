// _shared/rateLimit.ts — 3-tier IP/URL/global rate limiter for Edge
// Functions that hit expensive backends (Claude API · GitHub API · PSI).
//
// Pattern (originally lived in audit-preview, lifted here so analyze-project
// — and any future expensive endpoint — can wire in without re-implementing
// the same logic):
//
//   · IP cap        anon RATE_ANON_PER_IP/day · authed RATE_AUTHED_PER_IP/day
//                   Counted on EVERY request — keeps a single source from
//                   scraping the Claude-spend tier indefinitely.
//
//   · URL cap       per-target-resource cap (default RATE_PER_URL_GLOBAL)
//                   Defends against the same target getting audited dozens
//                   of times via IP rotation. Counted only when the request
//                   will actually cost a Claude call (cache miss).
//
//   · Global cap    platform-wide hard ceiling on Claude spend
//                   (RATE_GLOBAL_DAILY/day). Counted only on cache miss.
//
// The 3 tiers all share one table (preview_rate_limits) keyed by
// (ip_hash text, day date). The same RPC `increment_preview_rate_limit`
// drives every bucket — `ip_hash` is overloaded as a generic key column
// and the helpers prefix keys (`ip:` / `url:` / `global`) so the buckets
// don't collide.
//
// Login is intentionally NOT required — anonymous-friendly is the viral
// wedge. All defences are economic / per-resource, not identity.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck — Deno runtime

export const RATE_ANON_PER_IP    = 5
export const RATE_AUTHED_PER_IP  = 50
export const RATE_PER_URL_GLOBAL = 5
export const RATE_GLOBAL_DAILY   = 800

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function ipKey(req: Request): string {
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  return `ip:${djb2(ip)}`
}

export function urlKey(slug: string): string {
  return `url:${djb2(slug.toLowerCase())}`
}

export function isAuthed(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const anon = (globalThis as any).Deno?.env?.get('SUPABASE_ANON_KEY') ?? ''
  return !!auth && auth !== `Bearer ${anon}` && auth !== 'Bearer '
}

export function isAdmin(req: Request): boolean {
  const token  = req.headers.get('x-admin-token') ?? ''
  const secret = (globalThis as any).Deno?.env?.get('ADMIN_TOKEN') ?? ''
  return !!secret && token === secret
}

export function nextResetIso(): string {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return next.toISOString()
}

export interface RateQuota {
  reset_at: string
  ip:     { count: number; limit: number; remaining: number; tier: 'anon' | 'authed' }
  url:    { count: number; limit: number; remaining: number }
  global: { count: number; limit: number; remaining: number }
}

export interface RateLimitDecision {
  ok:    true
  quota: RateQuota
}

export interface RateLimitDeny {
  ok:      false
  reason:  'ip_cap' | 'url_cap' | 'global_cap'
  message: string
  limit:   number
  count:   number
  quota:   RateQuota
}

export type RateLimitResult = RateLimitDecision | RateLimitDeny

async function bumpAndCheck(
  admin: any,
  bucketKey: string,
  limit: number,
): Promise<{ ok: boolean; count: number; limit: number }> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await admin.rpc('increment_preview_rate_limit', {
    p_ip_hash: bucketKey,
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

async function peekCount(admin: any, key: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await admin
    .from('preview_rate_limits')
    .select('count')
    .eq('ip_hash', key)
    .eq('day', today)
    .maybeSingle()
  return data?.count ?? 0
}

/**
 * 3-tier rate limit. The IP cap is enforced on every request (cheap defence
 * against scraping cached data). URL + global caps are enforced only when
 * the request will actually cost a Claude call (cache miss).
 *
 * @param admin             service-role Supabase client
 * @param req               incoming request (for IP + auth detection)
 * @param resourceKey       identifies the target — usually a slug like
 *                          `owner/repo`. Used for the URL bucket.
 * @param willCostClaude    true if the request is going to spend on Claude
 *                          (cache miss / forced re-audit). Cache hits skip
 *                          URL + global counters entirely.
 */
export async function enforceRateLimit(
  admin: any,
  req: Request,
  resourceKey: string,
  willCostClaude: boolean,
): Promise<RateLimitResult> {
  const reset_at = nextResetIso()
  const authed   = isAuthed(req)
  const ipLimit  = authed ? RATE_AUTHED_PER_IP : RATE_ANON_PER_IP

  // 1. IP cap — always
  const ip = await bumpAndCheck(admin, ipKey(req), ipLimit)
  if (!ip.ok) {
    const urlPeek    = willCostClaude ? await peekCount(admin, urlKey(resourceKey)) : 0
    const globalPeek = willCostClaude ? await peekCount(admin, 'global')             : 0
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
    const urlPeek    = await peekCount(admin, urlKey(resourceKey))
    const globalPeek = await peekCount(admin, 'global')
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

  // 2. Per-resource cap
  const url = await bumpAndCheck(admin, urlKey(resourceKey), RATE_PER_URL_GLOBAL)
  if (!url.ok) {
    const globalPeek = await peekCount(admin, 'global')
    return {
      ok: false, reason: 'url_cap', limit: url.limit, count: url.count,
      message: `This target has been audited ${url.count} times today (cap ${url.limit}). Cached results stay valid for 7 days.`,
      quota: {
        reset_at,
        ip:     { count: ip.count, limit: ip.limit, remaining: Math.max(0, ip.limit - ip.count), tier: authed ? 'authed' : 'anon' },
        url:    { count: url.count, limit: url.limit, remaining: 0 },
        global: { count: globalPeek, limit: RATE_GLOBAL_DAILY, remaining: Math.max(0, RATE_GLOBAL_DAILY - globalPeek) },
      },
    }
  }

  // 3. Global cap
  const global = await bumpAndCheck(admin, 'global', RATE_GLOBAL_DAILY)
  if (!global.ok) {
    return {
      ok: false, reason: 'global_cap', limit: global.limit, count: global.count,
      message: `commit.show has hit its daily audit cap. Cached results still work · fresh audits resume after reset.`,
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

export function adminBypassQuota(): RateLimitDecision {
  return {
    ok: true,
    quota: {
      reset_at: nextResetIso(),
      ip:     { count: 0, limit: 9999, remaining: 9999, tier: 'authed' },
      url:    { count: 0, limit: 9999, remaining: 9999 },
      global: { count: 0, limit: 9999, remaining: 9999 },
    },
  }
}
