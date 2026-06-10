// benchmark-listing — 7-frame production-readiness benchmark for directory listings.
//
// Seven frames, 0-100 each, "what separates a demo from production" measured from
// the outside (URL/headers/Lighthouse) so it works for closed-source SaaS — the
// majority of launched products — without needing a repo:
//
//   1 performance     · Lighthouse perf
//   2 accessibility   · Lighthouse a11y
//   3 security        · transport + security headers + leaked-secret scan
//   4 privacy         · privacy/terms pages + cookie-consent
//   5 reliability     · multi-route reachability + valid SSL + real 404
//   6 standards       · Lighthouse best-practices + responsive + favicon/manifest
//   7 discoverability · title/meta/og/canonical/structured-data/sitemap
//
// + maintenance (conditional) — only measured when there's a code host (github/npm
//   pushed_at / release cadence) or an owner-linked repo. NEVER faked from a footer
//   year or last-modified header (CDN-overwritten noise). null = not assessed.
//
// Each frame is null when the form factor can't measure it honestly (a github URL
// has no rendered page → perf/a11y/privacy null). The detail modal surfaces exactly
// which frames were assessed, so n/a never inflates a score.
//
// Deterministic · no LLM · reproducible. signals.frames.<frame> carries the evidence
// the detail modal renders. Legacy quality/trust/activity/transparency are derived
// for back-compat during the frontend migration.
//
// Admin-gated (x-admin-token OR a signed-in is_admin member's JWT).
//   { id }                  → score one listing
//   { all:true, limit }     → (re)score the newest N listings
//   { pending:true, limit }  → score only un-benchmarked (benchmark IS NULL), newest-first
//                             (ingest auto-trigger + weekly cron sweep)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SR_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ADMIN_TOKEN = Deno.env.get('ADMIN_TOKEN') ?? ''
const PAGESPEED_KEY = Deno.env.get('PAGESPEED_API_KEY') ?? ''
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const SR = { apikey: SR_KEY, authorization: `Bearer ${SR_KEY}` }

async function isAuthedAdmin(req: Request): Promise<boolean> {
  if (ADMIN_TOKEN && req.headers.get('x-admin-token') === ADMIN_TOKEN) return true
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return false
  // Internal/cron server-to-server calls present a service-role JWT (role claim).
  // Never shipped to the browser (web app only holds the anon key) and a service-role
  // token already has full PostgREST access, so this is no escalation.
  try { if (JSON.parse(atob((jwt.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role') return true } catch { /* not a JWT */ }
  if (jwt === ANON_KEY || !SUPABASE_URL || !SR_KEY) return false
  try {
    const supa = createClient(SUPABASE_URL, SR_KEY)
    const { data, error } = await supa.auth.getUser(jwt)
    if (error || !data.user) return false
    const { data: m } = await supa.from('members').select('is_admin').eq('id', data.user.id).maybeSingle()
    return !!(m && (m as { is_admin?: boolean }).is_admin)
  } catch { return false }
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const days = (iso?: string | null) => iso ? (Date.now() - Date.parse(iso)) / 864e5 : null
// recency → 0-100 on the same curve we use for every "how fresh" signal.
const recency = (d: number | null) => d == null ? null : d < 30 ? 100 : d < 90 ? 80 : d < 180 ? 55 : d < 365 ? 30 : 12
// mean of the assessed (non-null) frames only — n/a never drags a score down.
const meanOf = (vals: (number | null)[]) => {
  const xs = vals.filter((v): v is number => v != null)
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null
}

// Leaked-secret patterns — a TRUE hit is a critical production failure, so it caps
// the security frame rather than nudging it. v1 scans the served HTML + inline
// scripts (cheap, no extra fetch); deep same-origin bundle scan is v1.5.
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['aws_key', /AKIA[0-9A-Z]{16}/],
  ['google_key', /AIza[0-9A-Za-z\-_]{35}/],
  ['stripe_live', /sk_live_[0-9a-zA-Z]{24,}/],
  ['private_key', /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/],
  ['slack_token', /xox[baprs]-[0-9A-Za-z-]{10,}/],
  ['github_pat', /ghp_[0-9A-Za-z]{36}/],
]
function scanSecrets(html: string): string[] {
  const hits: string[] = []
  for (const [name, re] of SECRET_PATTERNS) if (re.test(html)) hits.push(name)
  return hits
}

async function fetchFull(url: string) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 12000); const start = Date.now()
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: c.signal })
    const html = await r.text()
    return { ok: r.ok, status: r.status, ms: Date.now() - start, headers: r.headers, html, finalUrl: r.url || url }
  } catch { return { ok: false, status: 0, ms: 0, headers: new Headers(), html: '', finalUrl: url } }
  finally { clearTimeout(t) }
}
async function probeStatus(url: string): Promise<number> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 7000)
  try { const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: c.signal }); return r.status } catch { return 0 } finally { clearTimeout(t) }
}
async function getJSON(url: string) { try { const r = await fetch(url, { headers: { 'user-agent': 'legit-benchmark/0.1' } }); return r.ok ? await r.json() : null } catch { return null } }

// Real Lighthouse via PageSpeed Insights — feeds performance / accessibility / standards.
async function pageSpeed(url: string): Promise<{ perf: number; a11y: number; bp: number } | null> {
  if (!PAGESPEED_KEY) return null
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=accessibility&category=best-practices&key=${PAGESPEED_KEY}`
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 40000)
  try {
    const r = await fetch(api, { signal: c.signal }); const j = await r.json()
    const cat = j?.lighthouseResult?.categories; if (!cat) return null
    const perf = cat.performance?.score
    if (perf == null) return null
    return { perf, a11y: cat.accessibility?.score ?? 0, bp: cat['best-practices']?.score ?? 0 }
  } catch { return null } finally { clearTimeout(t) }
}

// Pull a few distinct same-origin paths from the homepage to spot-check reachability.
function sameOriginPaths(html: string, origin: string): string[] {
  const out = new Set<string>()
  const re = /href=["']([^"'#?]+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.size < 8) {
    let href = m[1]
    if (href.startsWith('//') || /^https?:/i.test(href)) {
      try { const u = new URL(href); if (u.origin !== origin) continue; href = u.pathname } catch { continue }
    }
    if (!href.startsWith('/')) continue
    if (/\.(png|jpe?g|svg|webp|gif|ico|css|js|woff2?|ttf|pdf|xml|json|txt)$/i.test(href)) continue
    if (href === '/' || href.length < 2) continue
    out.add(href)
  }
  return [...out].slice(0, 3)
}

type Frames = {
  performance: number | null; accessibility: number | null; security: number | null
  privacy: number | null; reliability: number | null; standards: number | null
  discoverability: number | null; maintenance: number | null
}
const EMPTY_FRAMES: Frames = { performance: null, accessibility: null, security: null, privacy: null, reliability: null, standards: null, discoverability: null, maintenance: null }

async function scoreWeb(url: string): Promise<{ frames: Frames; signals: Record<string, unknown> }> {
  let origin = url; try { origin = new URL(url).origin } catch { /* keep */ }
  const f = await fetchFull(origin + '/')
  const h = (n: string) => f.headers.get(n) || ''
  const html = f.html
  const https = (f.finalUrl || origin).startsWith('https')

  // Parallel probes — pages, sitemap, soft-404 check, multi-route spot-check.
  const routePaths = sameOriginPaths(html, origin)
  const [privS, termsS, sitemapS, notFoundS, ...routeS] = await Promise.all([
    probeStatus(origin + '/privacy'), probeStatus(origin + '/terms'),
    probeStatus(origin + '/sitemap.xml'), probeStatus(origin + '/__legit_probe_404__'),
    ...routePaths.map(p => probeStatus(origin + p)),
  ])
  const priv = privS >= 200 && privS < 400
  const terms = termsS >= 200 && termsS < 400
  const lh = await pageSpeed(origin + '/')

  // HTML-derived presence signals.
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html)
  const ogImage = /property=["']og:image["']/i.test(html)
  const ogTitle = /property=["']og:title["']/i.test(html)
  const title = /<title[^>]*>[^<]+<\/title>/i.test(html)
  const desc = /name=["']description["']/i.test(html)
  const favicon = /rel=["'][^"']*icon["']/i.test(html)
  const manifest = /rel=["']manifest["']/i.test(html)
  const canonical = /rel=["']canonical["']/i.test(html)
  const structured = /application\/ld\+json/i.test(html)
  const consent = /(cookie[-\s]?consent|onetrust|cookiebot|osano|usercentrics|__tcfapi|cookieyes|termly|gdpr|cookie settings|accept all cookies)/i.test(html)
  const mixedContent = https && /(?:src|href)=["']http:\/\//i.test(html)
  const csp = h('content-security-policy')

  // ── 1 Performance ──
  const performance = lh ? clamp(lh.perf * 100)
    : (viewport || f.ok) ? clamp((f.ok ? (f.ms < 1500 ? 60 : f.ms < 3000 ? 40 : 20) : 0) + (viewport ? 20 : 0)) : null

  // ── 2 Accessibility ── only honest with Lighthouse.
  const accessibility = lh ? clamp(lh.a11y * 100) : null

  // ── 3 Security ── headers drive variance; a leaked secret caps it.
  let security = 0
  if (https) security += 25
  if (h('strict-transport-security')) security += 20
  if (csp) security += 20
  if (h('x-frame-options') || /frame-ancestors/i.test(csp)) security += 15
  if (h('x-content-type-options')) security += 10
  if (h('referrer-policy')) security += 10
  const secrets = scanSecrets(html)
  if (mixedContent) security -= 15
  if (secrets.length) security = Math.min(security, 20)
  security = f.status === 0 ? (null as unknown as number) : clamp(security)

  // ── 4 Privacy & Compliance ──
  const privacy = clamp((priv ? 45 : 0) + (terms ? 30 : 0) + (consent ? 25 : 0))

  // ── 5 Reliability ── reachable home + working internal routes + real 404 + SSL.
  const routesOk = routeS.filter(s => s >= 200 && s < 400).length
  const routeRate = routeS.length ? routesOk / routeS.length : null
  const has404 = notFoundS >= 400 && notFoundS < 500
  let reliability: number | null = null
  if (f.status) {
    reliability = 0
    if (f.status >= 200 && f.status < 400 && https) reliability += 45
    else if (f.status >= 200 && f.status < 400) reliability += 25
    reliability += routeRate == null ? 22 : Math.round(routeRate * 30) // no internal links → neutral-ish
    if (has404) reliability += 25
    reliability = clamp(reliability)
  }

  // ── 6 Standards & Polish ──
  const standards = lh
    ? clamp(lh.bp * 70 + (viewport ? 15 : 0) + (favicon ? 7 : 0) + (manifest ? 8 : 0))
    : (f.status ? clamp((viewport ? 45 : 0) + (favicon ? 30 : 0) + (manifest ? 25 : 0)) : null)

  // ── 7 Discoverability ──
  const sitemap = sitemapS >= 200 && sitemapS < 400
  const discoverability = f.status ? clamp(
    (title ? 15 : 0) + (desc ? 20 : 0) + ((ogTitle && ogImage) ? 25 : ogImage || ogTitle ? 12 : 0) +
    (canonical ? 15 : 0) + (structured ? 15 : 0) + (sitemap ? 10 : 0)) : null

  const frames: Frames = {
    performance, accessibility, security, privacy, reliability, standards, discoverability,
    maintenance: null, // web: only via owner-linked repo (not faked from footer/last-modified)
  }
  return {
    frames,
    signals: {
      status: f.status, ms: f.ms, https,
      frames: {
        performance: { lighthouse: !!lh, perf: lh ? Math.round(lh.perf * 100) : null, responseMs: f.ms },
        accessibility: { lighthouse: !!lh, a11y: lh ? Math.round(lh.a11y * 100) : null },
        security: { https, hsts: !!h('strict-transport-security'), csp: !!csp, xFrame: !!(h('x-frame-options') || /frame-ancestors/i.test(csp)), xContent: !!h('x-content-type-options'), referrer: !!h('referrer-policy'), mixedContent, secretsFound: secrets },
        privacy: { privacyPage: priv, termsPage: terms, consentBanner: consent },
        reliability: { homeStatus: f.status, https, routesChecked: routeS.length, routesOk, proper404: has404 },
        standards: { lighthouse: !!lh, bestPractices: lh ? Math.round(lh.bp * 100) : null, responsive: viewport, favicon, manifest },
        discoverability: { title, metaDescription: desc, ogTitle, ogImage, canonical, structuredData: structured, sitemap },
        maintenance: { assessed: false, reason: 'no linked repository' },
      },
    },
  }
}

async function scoreGitHub(url: string): Promise<{ frames: Frames; signals: Record<string, unknown> } | null> {
  const m = url.match(/github\.com\/([^/]+)\/([^/?#]+)/i); if (!m) return null
  const r = await getJSON(`https://api.github.com/repos/${m[1]}/${m[2].replace(/\.git$/, '')}`)
  if (!r || r.message) return null
  const stars = r.stargazers_count || 0
  const license = !!r.license
  const topics = (r.topics || []).length
  const archived = !!r.archived

  const security = clamp((license ? 50 : 0) + (archived ? 0 : 30) + (https(r.homepage) ? 20 : 10))
  const maintenance = recency(days(r.pushed_at))
  const standards = clamp((license ? 35 : 0) + (topics >= 3 ? 25 : topics > 0 ? 12 : 0) + (r.description ? 20 : 0) + (archived ? 0 : 20))
  const discoverability = clamp((r.description ? 35 : 0) + (topics > 0 ? 30 : 0) + (r.homepage ? 35 : 0))
  const frames: Frames = {
    ...EMPTY_FRAMES, security, maintenance, standards, discoverability,
  }
  return {
    frames,
    signals: {
      stars, license: r.license?.spdx_id, topics, archived, pushed_at: r.pushed_at,
      frames: {
        security: { license: r.license?.spdx_id || null, archived, homepage: !!r.homepage },
        maintenance: { assessed: true, pushed_at: r.pushed_at, daysSincePush: Math.round(days(r.pushed_at) ?? -1) },
        standards: { license, topics, hasDescription: !!r.description, archived },
        discoverability: { description: !!r.description, topics, homepage: !!r.homepage },
        performance: { assessed: false, reason: 'no rendered page' },
        accessibility: { assessed: false, reason: 'no rendered page' },
        privacy: { assessed: false, reason: 'code host' },
        reliability: { assessed: false, reason: 'code host' },
      },
    },
  }
}
function https(u?: string | null) { return !!u && /^https/i.test(u) }

async function scoreNpm(url: string): Promise<{ frames: Frames; signals: Record<string, unknown> } | null> {
  const m = url.match(/npmjs\.com\/package\/([^?#]+)/i); if (!m) return null
  const pkg = decodeURIComponent(m[1].replace(/\/$/, ''))
  const meta = await getJSON(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}`)
  if (!meta || meta.error) return null
  const dl = await getJSON(`https://api.npmjs.org/downloads/point/last-week/${pkg.replace('/', '%2F')}`)
  const weekly = dl?.downloads || 0
  const license = !!meta.license
  const hasRepo = !!meta.repository
  const versions = Object.keys(meta.versions || {}).length
  const latest = meta['dist-tags']?.latest
  const hasTypes = !!(meta.versions?.[latest]?.types || meta.versions?.[latest]?.typings)

  const security = clamp((license ? 45 : 0) + (hasRepo ? 35 : 0) + 20)
  const maintenance = recency(days(meta.time?.modified))
  const standards = clamp((versions >= 10 ? 35 : versions >= 3 ? 20 : 8) + (license ? 30 : 0) + (hasTypes ? 20 : 0) + (hasRepo ? 15 : 0))
  const discoverability = clamp((meta.description ? 30 : 0) + (meta.readme ? 30 : 0) + (hasRepo ? 20 : 0) + (meta.homepage ? 20 : 0))
  const frames: Frames = { ...EMPTY_FRAMES, security, maintenance, standards, discoverability }
  return {
    frames,
    signals: {
      weekly, license: meta.license, versions, modified: meta.time?.modified,
      frames: {
        security: { license: meta.license || null, hasRepository: hasRepo },
        maintenance: { assessed: true, modified: meta.time?.modified, daysSinceModified: Math.round(days(meta.time?.modified) ?? -1) },
        standards: { versions, license, types: hasTypes, hasRepository: hasRepo },
        discoverability: { description: !!meta.description, readme: !!meta.readme, repository: hasRepo, homepage: !!meta.homepage },
        performance: { assessed: false, reason: 'no rendered page' },
        accessibility: { assessed: false, reason: 'no rendered page' },
        privacy: { assessed: false, reason: 'package registry' },
        reliability: { assessed: false, reason: 'package registry' },
      },
    },
  }
}

async function scoreAppStore(url: string): Promise<{ frames: Frames; signals: Record<string, unknown> } | null> {
  const f = await fetchFull(url); const html = f.html
  if (!f.status) return null
  const relDate = (html.match(/"currentVersionReleaseDate":"([^"]+)"/) || [])[1] || (html.match(/"releaseDate":"([^"]+)"/) || [])[1] || ''
  const shots = (html.match(/mzstatic\.com\/image\/thumb\/[^"'\s)]+?\/\d+x\d+bb\.(?:png|jpe?g|webp)/gi) || []).filter(u => !/AppIcon|Placeholder/i.test(u)).length
  const privacyLabel = /App Privacy|privacy practices|data (?:linked|not linked|used to track)/i.test(html)
  const ageRating = /Age Rating|contentRatingsBySystem|trackContentRating/i.test(html)
  const desc = /"description":\{"standard"/i.test(html) || /<meta[^>]+name=["']description["']/i.test(html)

  const maintenance = recency(days(relDate))
  const privacy = clamp((privacyLabel ? 60 : 0) + (ageRating ? 40 : 0))
  const discoverability = clamp((shots >= 4 ? 50 : shots > 0 ? 25 : 0) + (desc ? 30 : 0) + 20)
  const frames: Frames = { ...EMPTY_FRAMES, maintenance, privacy, discoverability }
  return {
    frames,
    signals: {
      relDate, screenshots: shots, privacyLabel,
      frames: {
        maintenance: { assessed: true, releaseDate: relDate, daysSinceRelease: Math.round(days(relDate) ?? -1) },
        privacy: { appPrivacyLabel: privacyLabel, ageRating },
        discoverability: { screenshots: shots, description: desc },
        performance: { assessed: false, reason: 'store-hosted page' },
        accessibility: { assessed: false, reason: 'store-hosted page' },
        security: { assessed: false, reason: 'store-hosted page' },
        reliability: { assessed: false, reason: 'store-hosted page' },
        standards: { assessed: false, reason: 'store-hosted page' },
      },
    },
  }
}

function detectForm(url: string, domain: string): string {
  if (/apps\.apple\.com/i.test(url)) return 'app_store'
  if (/github\.com/i.test(domain || url)) return 'github'
  if (/npmjs\.com/i.test(domain || url)) return 'npm'
  return 'web'
}

async function scoreListing(l: { id: string; url: string; domain: string }) {
  const form = detectForm(l.url || '', l.domain || '')
  let s: { frames: Frames; signals: Record<string, unknown> } | null = null
  try {
    if (form === 'app_store') s = await scoreAppStore(l.url)
    else if (form === 'github') s = await scoreGitHub(l.url)
    else if (form === 'npm') s = await scoreNpm(l.url)
    else s = await scoreWeb(l.url)
  } catch { s = null }
  if (!s) s = { frames: { ...EMPTY_FRAMES }, signals: { error: 'unscored' } }
  const fr = s.frames

  // overall = mean of assessed frames only (n/a never drags it down). Form-relative
  // by design — the public sees per-frame bars, not this number (admin-only).
  const overall = meanOf([fr.performance, fr.accessibility, fr.security, fr.privacy, fr.reliability, fr.standards, fr.discoverability, fr.maintenance]) ?? 0
  const assessed = [fr.performance, fr.accessibility, fr.security, fr.privacy, fr.reliability, fr.standards, fr.discoverability, fr.maintenance].filter(v => v != null).length

  // Legacy 4-axis derivation — keeps the current frontend working until it reads
  // the 7 frames directly. Removed in a follow-up once readers are migrated.
  const quality = meanOf([fr.performance, fr.accessibility, fr.standards]) ?? 0
  const trust = meanOf([fr.security, fr.privacy]) ?? 0
  const activity = meanOf([fr.maintenance, fr.reliability]) ?? 0
  const transparency = fr.discoverability ?? 0

  return {
    schema: 2, form, scored_at: new Date().toISOString(),
    performance: fr.performance, accessibility: fr.accessibility, security: fr.security,
    privacy: fr.privacy, reliability: fr.reliability, standards: fr.standards,
    discoverability: fr.discoverability, maintenance: fr.maintenance,
    overall, assessed,
    quality, trust, activity, transparency,
    signals: s.signals,
  }
}

async function patchBenchmark(id: string, benchmark: unknown) {
  await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${id}`, {
    method: 'PATCH', headers: { ...SR, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({ benchmark }),
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!(await isAuthedAdmin(req))) return json({ error: 'unauthorized' }, 401)
  let p: any = {}; try { p = await req.json() } catch { return json({ error: 'bad json' }, 400) }
  try {
    if (p.all || p.pending) {
      const limit = Math.min(Number(p.limit) || 100, 200)
      const offset = Math.max(Number(p.offset) || 0, 0)
      const filter = p.pending ? '&benchmark=is.null' : ''
      const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=id,url,domain${filter}&order=created_at.desc&limit=${limit}&offset=${offset}`, { headers: SR })
      const rows = (await r.json()) as { id: string; url: string; domain: string }[]
      const out: { id: string; overall: number; form: string }[] = []
      // Smaller batches than the old 4-axis engine — each web listing now fires ~9
      // probes + Lighthouse, so 6-wide keeps us under the 150s function timeout.
      for (let i = 0; i < rows.length; i += 6) {
        const batch = rows.slice(i, i + 6)
        const scored = await Promise.all(batch.map(async l => { const b = await scoreListing(l); await patchBenchmark(l.id, b); return { id: l.id, overall: b.overall, form: b.form } }))
        out.push(...scored)
      }
      return json({ scored: out.length, items: out })
    }
    if (p.id) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=id,url,domain&id=eq.${p.id}`, { headers: SR })
      const l = ((await r.json()) as { id: string; url: string; domain: string }[])[0]
      if (!l) return json({ error: 'not_found' }, 404)
      const b = await scoreListing(l); await patchBenchmark(l.id, b); return json(b)
    }
    return json({ error: 'pass { id } or { all:true } or { pending:true }' }, 400)
  } catch (e) { return json({ error: String(e) }, 500) }
})
