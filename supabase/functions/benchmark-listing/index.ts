// benchmark-listing — form-agnostic 4-axis benchmark for directory listings.
// Quality · Trust · Activity · Transparency (0-100 each) + overall. Deterministic,
// reproducible signals — no LLM — so the score is objective and defensible.
// Each form factor (web URL · App Store · GitHub · npm) fills the SAME 4 axes
// from its own signals, so every listing is comparable on one chart.
//
// Admin-gated (x-admin-token OR a signed-in is_admin member's JWT).
//   { action:'benchmark', id }            → score one listing
//   { action:'benchmark', all:true, limit} → score the newest N listings

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
  if (!jwt || jwt === ANON_KEY || !SUPABASE_URL || !SR_KEY) return false
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

async function fetchFull(url: string) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 12000); const start = Date.now()
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: c.signal })
    const html = await r.text()
    return { ok: r.ok, status: r.status, ms: Date.now() - start, headers: r.headers, html }
  } catch { return { ok: false, status: 0, ms: 0, headers: new Headers(), html: '' } }
  finally { clearTimeout(t) }
}
async function probeOk(url: string) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 7000)
  try { const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: c.signal }); return r.ok } catch { return false } finally { clearTimeout(t) }
}
async function getJSON(url: string) { try { const r = await fetch(url, { headers: { 'user-agent': 'legit-benchmark/0.1' } }); return r.ok ? await r.json() : null } catch { return null } }

// Real Lighthouse via PageSpeed Insights → the Quality axis. Needs PAGESPEED_API_KEY.
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

async function scoreWeb(url: string) {
  let origin = url; try { origin = new URL(url).origin } catch { /* keep */ }
  const f = await fetchFull(origin + '/')
  const h = (n: string) => f.headers.get(n) || ''
  const html = f.html
  const [priv, terms, about, pricing] = await Promise.all([
    probeOk(origin + '/privacy'), probeOk(origin + '/terms'), probeOk(origin + '/about'), probeOk(origin + '/pricing'),
  ])
  const https = origin.startsWith('https')
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html)
  const ogImage = /property=["']og:image["']/i.test(html)
  const ogTitle = /property=["']og:title["']/i.test(html)
  const desc = /name=["']description["']/i.test(html)
  const favicon = /rel=["'][^"']*icon["']/i.test(html)
  const csp = h('content-security-policy')
  const pricingOk = pricing || /pricing|\/mo\b|\$\d|per month/i.test(html)
  const contact = about || /mailto:|\/contact/i.test(html)
  const lmDays = days(h('last-modified'))

  // Quality = real Lighthouse (perf 50% · a11y 25% · best-practices 25%) when a
  // PageSpeed key is set; else a lenient presence-based fallback.
  const lh = await pageSpeed(origin + '/')
  let quality: number
  if (lh) {
    quality = clamp((lh.perf * 0.5 + lh.a11y * 0.25 + lh.bp * 0.25) * 100)
  } else {
    quality = 0
    if (viewport) quality += 25
    if (f.ok) quality += f.ms < 1500 ? 25 : f.ms < 3000 ? 15 : 5
    if (favicon) quality += 15
    if (ogImage) quality += 15
    if (desc) quality += 10
    if (f.status === 200) quality += 10
  }
  let trust = 0
  if (https) trust += 20
  if (h('strict-transport-security')) trust += 16
  if (csp) trust += 16
  if (h('x-frame-options') || /frame-ancestors/i.test(csp)) trust += 12
  if (h('x-content-type-options')) trust += 8
  if (h('referrer-policy')) trust += 8
  if (priv) trust += 10
  if (terms) trust += 10
  let activity = 0
  if (f.status === 200 && https) activity += 60
  if (f.ok && f.ms < 3000) activity += 20
  activity += lmDays == null ? 10 : lmDays < 365 ? 20 : 10
  let transparency = 0
  if (desc) transparency += 20
  if (ogTitle && ogImage) transparency += 20
  if (pricingOk) transparency += 20
  if (about) transparency += 20
  if (contact) transparency += 20

  return { quality: clamp(quality), trust: clamp(trust), activity: clamp(activity), transparency: clamp(transparency),
    signals: { status: f.status, ms: f.ms, https, csp: !!csp, privacy: priv, lighthouse: lh ? { perf: Math.round(lh.perf * 100), a11y: Math.round(lh.a11y * 100), bp: Math.round(lh.bp * 100) } : null } }
}

async function scoreAppStore(url: string) {
  const f = await fetchFull(url); const html = f.html
  const rating = parseFloat((html.match(/"averageUserRating":\s*([0-9.]+)/) || [])[1] || '0')
  const ratingCount = parseInt((html.match(/"userRatingCount":\s*([0-9]+)/) || [])[1] || '0', 10)
  const relDate = (html.match(/"currentVersionReleaseDate":"([^"]+)"/) || [])[1] || (html.match(/"releaseDate":"([^"]+)"/) || [])[1] || ''
  const relDays = days(relDate)
  const shots = (html.match(/mzstatic\.com\/image\/thumb\/[^"'\s)]+?\/\d+x\d+bb\.(?:png|jpe?g|webp)/gi) || []).filter(u => !/AppIcon|Placeholder/i.test(u)).length
  const privacy = /App Privacy|privacy practices|data (linked|not linked|used to track)/i.test(html)
  const ageRating = /Age Rating|contentRatingsBySystem|trackContentRating/i.test(html)
  const quality = clamp((ratingCount > 0 ? rating / 5 * 70 : 35) + (ratingCount >= 1000 ? 30 : ratingCount >= 100 ? 22 : ratingCount >= 10 ? 14 : ratingCount > 0 ? 6 : 0))
  const trust = clamp((privacy ? 50 : 10) + (ageRating ? 20 : 0) + 30)
  const activity = clamp(relDays == null ? 40 : relDays < 90 ? 100 : relDays < 180 ? 70 : relDays < 365 ? 40 : 20)
  const transparency = clamp(30 + (shots >= 4 ? 40 : shots > 0 ? 20 : 0) + (privacy ? 30 : 0))
  return { quality, trust, activity, transparency, signals: { rating, ratingCount, relDate, screenshots: shots, privacy } }
}

async function scoreGitHub(url: string) {
  const m = url.match(/github\.com\/([^/]+)\/([^/?#]+)/i); if (!m) return null
  const r = await getJSON(`https://api.github.com/repos/${m[1]}/${m[2].replace(/\.git$/, '')}`)
  if (!r || r.message) return null
  const stars = r.stargazers_count || 0
  const pushedDays = days(r.pushed_at)
  const license = !!r.license
  const topics = (r.topics || []).length
  const quality = clamp((stars >= 10000 ? 40 : stars >= 1000 ? 32 : stars >= 100 ? 24 : stars >= 10 ? 14 : 6) + (license ? 20 : 0) + (r.description ? 10 : 0) + (r.archived ? 0 : 10) + (topics >= 3 ? 20 : topics > 0 ? 10 : 0))
  const trust = clamp((license ? 50 : 0) + (r.archived ? 0 : 30) + (r.homepage ? 20 : 0))
  const activity = clamp(pushedDays == null ? 10 : pushedDays < 30 ? 100 : pushedDays < 90 ? 70 : pushedDays < 180 ? 40 : pushedDays < 365 ? 20 : 10)
  const transparency = clamp((r.description ? 30 : 0) + 30 + (topics > 0 ? 20 : 0) + (r.homepage ? 20 : 0))
  return { quality, trust, activity, transparency, signals: { stars, pushed_at: r.pushed_at, license: r.license?.spdx_id, topics, archived: r.archived } }
}

async function scoreNpm(url: string) {
  const m = url.match(/npmjs\.com\/package\/([^?#]+)/i); if (!m) return null
  const pkg = decodeURIComponent(m[1].replace(/\/$/, ''))
  const meta = await getJSON(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}`)
  if (!meta || meta.error) return null
  const dl = await getJSON(`https://api.npmjs.org/downloads/point/last-week/${pkg.replace('/', '%2F')}`)
  const weekly = dl?.downloads || 0
  const modDays = days(meta.time?.modified)
  const license = !!meta.license
  const hasRepo = !!meta.repository
  const versions = Object.keys(meta.versions || {}).length
  const quality = clamp((weekly >= 100000 ? 50 : weekly >= 10000 ? 38 : weekly >= 1000 ? 26 : weekly >= 100 ? 14 : 6) + (license ? 20 : 0) + (versions >= 10 ? 30 : versions >= 3 ? 18 : 8))
  const trust = clamp((license ? 45 : 0) + (hasRepo ? 30 : 0) + 25)
  const activity = clamp(modDays == null ? 10 : modDays < 30 ? 100 : modDays < 90 ? 70 : modDays < 180 ? 40 : modDays < 365 ? 20 : 10)
  const transparency = clamp((meta.description ? 30 : 0) + (hasRepo ? 25 : 0) + (meta.homepage ? 20 : 0) + (meta.readme ? 25 : 0))
  return { quality, trust, activity, transparency, signals: { weekly, modified: meta.time?.modified, license: meta.license, versions } }
}

function detectForm(url: string, domain: string): string {
  if (/apps\.apple\.com/i.test(url)) return 'app_store'
  if (/github\.com/i.test(domain || url)) return 'github'
  if (/npmjs\.com/i.test(domain || url)) return 'npm'
  return 'web'
}

async function scoreListing(l: { id: string; url: string; domain: string }) {
  const form = detectForm(l.url || '', l.domain || '')
  let s: Awaited<ReturnType<typeof scoreWeb>> | null = null
  try {
    if (form === 'app_store') s = await scoreAppStore(l.url)
    else if (form === 'github') s = await scoreGitHub(l.url)
    else if (form === 'npm') s = await scoreNpm(l.url)
    else s = await scoreWeb(l.url)
  } catch { s = null }
  if (!s) s = { quality: 0, trust: 0, activity: 0, transparency: 0, signals: { error: 'unscored' } }
  const overall = Math.round((s.quality + s.trust + s.activity + s.transparency) / 4)
  return { quality: s.quality, trust: s.trust, activity: s.activity, transparency: s.transparency, overall, form, scored_at: new Date().toISOString(), signals: s.signals }
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
    if (p.all) {
      const limit = Math.min(Number(p.limit) || 100, 200)
      const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=id,url,domain&order=created_at.desc&limit=${limit}`, { headers: SR })
      const rows = (await r.json()) as { id: string; url: string; domain: string }[]
      const out: { id: string; overall: number; form: string }[] = []
      for (let i = 0; i < rows.length; i += 8) {
        const batch = rows.slice(i, i + 8)
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
    return json({ error: 'pass { id } or { all:true }' }, 400)
  } catch (e) { return json({ error: String(e) }, 500) }
})
