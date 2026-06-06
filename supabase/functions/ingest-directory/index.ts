// ingest-directory — directory (legit / v2) ingestion + curation worker.
//
// Server-side because it needs ANTHROPIC_API_KEY + the service role (the public
// app only has the anon key). Admin-gated via x-admin-token === ADMIN_TOKEN
// (same shared secret the rest of /admin uses). Actions:
//   { action:'ingest', target:'mcp' | 'hn' | 'skills' | '<subreddits>' }
//   { action:'update', id, patch:{ category?, tagline?, description?, platform? } }
//   { action:'delete', id }
//
// discover → fetch landing → Haiku extract (grounded) → Sonnet compose →
// upsert into `listings` (on_conflict slug). Mirrors the local prototype engine.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SR_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ADMIN_TOKEN = Deno.env.get('ADMIN_TOKEN') ?? ''
const PH_TOKEN = Deno.env.get('PRODUCTHUNT_TOKEN') ?? ''
const SR = { apikey: SR_KEY, authorization: `Bearer ${SR_KEY}` }

// Two ways in: the shared x-admin-token (used by the main /admin console + CLI),
// or a signed-in member whose JWT resolves to members.is_admin = true (so the
// directory admin page needs no token paste).
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

const UA_RSS = 'legit-directory-research/0.1 (by /u/legit_research)'
const UA_WEB = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const EXTRACT_MODEL = 'claude-haiku-4-5'
const COMPOSE_MODEL = 'claude-sonnet-4-6'
const ENRICH_HARD_CAP = 16   // latency ceiling on Claude enrichments per run
const PICK_HARD_CAP = 30     // ceiling on candidates processed per run
// Reddit `t` window → seconds (HN recency cutoff). null = all-time.
const WINDOW_SECONDS: Record<string, number | null> = { day: 86400, week: 604800, month: 2592000, year: 31536000, all: null }

const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    what_it_is: { type: 'string' }, who_for: { type: 'array', items: { type: 'string' } },
    features: { type: 'array', items: { type: 'string' } }, pricing: { type: 'string' },
    how_to_use: { type: 'string' }, category: { type: 'string' },
  },
  required: ['what_it_is', 'who_for', 'features', 'pricing', 'how_to_use', 'category'],
}
const COMPOSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { tagline: { type: 'string' }, description: { type: 'string' } },
  required: ['tagline', 'description'],
}

const dec = (x: string) => (x || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
const slugify = (d: string) => d.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 44)

// ── canonical entity resolver (cross-run / cross-source dedup) ──
// Multi-tenant hosts: the registrable unit is the full subdomain (foo.github.io,
// not github.io). Keep this list in sync with the backfill script.
const MULTI_TENANT = ['github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'web.app', 'firebaseapp.com', 'herokuapp.com', 'fly.dev', 'onrender.com', 'repl.co', 'replit.app', 'glitch.me', 'surge.sh', 'workers.dev', 'deno.dev', 'railway.app', 'streamlit.app', 'gumroad.com', 'notion.site', 'webflow.io', 'framer.website', 'super.site', 'carrd.co', 'bubbleapps.io']
const SECOND_LEVEL = ['co.uk', 'com.au', 'co.kr', 'co.jp', 'co.nz', 'com.br', 'co.in', 'org.uk']
function registrable(host: string): string {
  host = host.replace(/^www\./, '').toLowerCase()
  for (const mt of MULTI_TENANT) {
    if (host === mt) return host
    if (host.endsWith('.' + mt)) { const sub = host.slice(0, -(mt.length + 1)).split('.').pop(); return `${sub}.${mt}` }
  }
  const parts = host.split('.')
  if (parts.length > 2 && SECOND_LEVEL.includes(parts.slice(-2).join('.'))) return parts.slice(-3).join('.')
  return parts.slice(-2).join('.')
}
function canonicalKey(rawUrl: string): string {
  try {
    const u = new URL(/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`)
    const host = u.host.toLowerCase()
    if (/apps\.apple\.com/.test(host)) { const m = u.pathname.match(/\/id(\d+)/); return m ? `appstore:${m[1]}` : `web:${registrable(host)}` }
    if (/play\.google\.com/.test(host)) { const id = u.searchParams.get('id'); return id ? `play:${id}` : `web:${registrable(host)}` }
    if (/(^|\.)github\.com$/.test(host)) { const m = u.pathname.match(/^\/([^/]+)\/([^/]+)/); return m ? `github:${m[1].toLowerCase()}/${m[2].toLowerCase().replace(/\.git$/, '')}` : 'web:github.com' }
    if (/(^|\.)npmjs\.com$/.test(host)) { const m = u.pathname.match(/package\/(.+)$/); return m ? `npm:${decodeURIComponent(m[1].replace(/\/$/, ''))}` : 'web:npmjs.com' }
    if (/chromewebstore\.google\.com|chrome\.google\.com/.test(host)) { const m = u.pathname.match(/\/detail\/[^/]+\/([a-z]{20,})/i); return m ? `chrome:${m[1].toLowerCase()}` : `web:${registrable(host)}` }
    return `web:${registrable(host)}`
  } catch { return `web:${(rawUrl || '').toLowerCase().slice(0, 80)}` }
}

async function fetchText(url: string, ua: string, ms = 12000): Promise<string> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms)
  try { const r = await fetch(url, { headers: { 'user-agent': ua }, redirect: 'follow', signal: c.signal }); return await r.text() }
  catch { return '' } finally { clearTimeout(t) }
}
async function fetchJSON(url: string, ua: string, ms = 12000): Promise<any> {
  try { return JSON.parse(await fetchText(url, ua, ms)) } catch { return null }
}

const EXT = (u: string) => /^https?:\/\//.test(u) && !/reddit\.com|redd\.it|redditstatic|redditmedia|preview\.redd|reddit\.media/.test(u)
const NOISE = (d: string) => /imgur\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|facebook\.com|linkedin\.com|tiktok\.com|patreon\.com|discord\.(gg|com)|t\.me|paypal|ko-fi|buymeacoffee|medium\.com|dev\.to|substack\.com|hashnode|wikipedia\.org|news\.ycombinator|loom\.com|notion\.site|docs\.google|forms\.gle|itch\.io|steampowered\.com|gamejolt\.com|newgrounds\.com|crazygames\.com|lu\.ma|app\.link|page\.link|onelink\.me|smart\.link/i.test(d)

function guessPlatform(url: string): string {
  if (/apps\.apple\.com/.test(url)) return 'iOS app'
  if (/play\.google\.com/.test(url)) return 'Android app'
  if (/store\.steampowered\.com/.test(url)) return 'Game · Steam'
  if (/github\.com/.test(url)) return 'Open source'
  if (/chromewebstore|chrome\.google/.test(url)) return 'Browser extension'
  return 'Web'
}

// A square icon (not a wide preview): App Store AppIcon, Chrome/Play icons,
// VS Code marketplace, repo avatar. Mirrors the frontend isIconImage.
function isIconUrl(u: string): boolean {
  if (!u) return false
  return /lh3\.googleusercontent\.com/.test(u) || /=s\d{2,4}(-|$)/.test(u)
    || (/mzstatic\.com/.test(u) && /AppIcon/i.test(u)) || /gallerycdn\.vsassets\.io/.test(u)
    || /avatars\.githubusercontent\.com/.test(u)
}

// App Store pages expose only the app icon as og:image; their HTML carries the
// actual portrait phone screenshots (mzstatic). A screenshot is a far better
// preview than the tiny icon.
function pickStoreScreenshot(html: string): string | null {
  const shots = [...html.matchAll(/https:\/\/[a-z0-9-]+\.mzstatic\.com\/image\/thumb\/[^"'\s)]+?\/(\d+)x(\d+)(?:bb|wa)\.(?:png|jpe?g|webp)/gi)]
    .map(m => ({ u: m[0], w: +m[1], h: +m[2] }))
    .filter(s => !/AppIcon|Placeholder/i.test(s.u) && s.h > s.w * 1.3) // portrait screenshots, not the icon
  if (!shots.length) return null
  return shots[0].u.replace(/\/\d+x\d+(?:bb|wa)\./, '/600x1300bb.') // crisp, uniform size
}

// Returns { image (wide preview), icon (square) } — separated so the list shows
// the real icon while cards/detail show the preview.
async function extractLanding(url: string) {
  const html = await fetchText(url, UA_WEB, 9000)
  const pick = (re: RegExp) => { const m = html.match(re); return m ? m[1].trim().replace(/\s+/g, ' ') : '' }
  const title = pick(/<title[^>]*>([^<]+)<\/title>/i)
  const desc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
    || pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)
  const abs = (u: string) => { if (u && !/^https?:\/\//.test(u)) { try { return new URL(u, url).href } catch { return '' } } return u }
  const og = abs(pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)
    || pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i)
    || pick(/<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)/i))
  let image = '', icon = ''
  if (/apps\.apple\.com/i.test(url)) {
    icon = og                                  // og:image is the AppIcon
    image = pickStoreScreenshot(html) || ''    // screenshot is the preview
  } else if (isIconUrl(og)) {
    icon = og                                  // og is itself a square icon (Chrome store etc.)
  } else {
    image = og                                 // wide OG preview
  }
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
  return { title, desc, image, icon, body, starved: body.length < 400, price: /\$\d|\/mo\b|per month|free (tier|plan|forever)|pricing|subscription/i.test(body) }
}

async function claudeJSON(model: string, system: string, user: string, schema: unknown): Promise<any> {
  if (!ANTHROPIC_KEY) return null
  const reqBody = JSON.stringify({ model, max_tokens: 1024, output_config: { format: { type: 'json_schema', schema } }, system, messages: [{ role: 'user', content: user }] })
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 25000)
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: c.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: reqBody,
      })
      clearTimeout(t)
      if (r.status === 429 || r.status === 529) { await new Promise(s => setTimeout(s, 1200 * (attempt + 1))); continue }
      const j = await r.json()
      if (!r.ok) { console.error('claudeJSON', model, r.status); return null }
      const txt = (j.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      return JSON.parse(txt)
    } catch (e) { if (attempt === 2) { console.error('claudeJSON fail', model, String(e)); return null } await new Promise(s => setTimeout(s, 800)) }
  }
  return null
}

async function claudeExtract(p: { name: string; url: string; source: string; bodyText: string }) {
  if (!p.bodyText || p.bodyText.length < 200) return null
  const system = "You extract structured directory-listing fields from a web page's own text. GROUNDED-ONLY: use only facts stated in the provided text. If a field is not stated, return an empty string or empty array — NEVER invent. Pricing especially: if no explicit price/plan is on the page, set pricing to \"\". who_for: up to 5 short audience labels. features: 3-6 short concrete phrases. category: one short label (e.g. \"Web analytics\", \"AI voice\", \"MCP server\", \"Scheduling\"). Be concise."
  const user = `Service: ${p.name}\nURL: ${p.url}\nSource: ${p.source}\n\nPAGE TEXT (extract only from this):\n"""\n${p.bodyText.slice(0, 4000)}\n"""`
  return claudeJSON(EXTRACT_MODEL, system, user, EXTRACT_SCHEMA)
}
async function claudeCompose(p: { name: string; url: string; bodyText: string }) {
  if (!p.bodyText || p.bodyText.length < 200) return null
  const system = "You write one clean, uniform directory-listing blurb from a web page's own text. GROUNDED-ONLY: use only facts stated in the page text — never invent. Neutral, clear, user-friendly editorial tone like a high-quality directory entry, NOT marketing hype. tagline: one plain sentence, <=90 chars, what the service is. description: 2-3 short sentences — what it does, who it's for, the key differentiator. No emoji, no exclamation marks; avoid words like revolutionary / seamless / cutting-edge / game-changing."
  const user = `Service: ${p.name}\nURL: ${p.url}\n\nPAGE TEXT:\n"""\n${p.bodyText.slice(0, 4000)}\n"""`
  return claudeJSON(COMPOSE_MODEL, system, user, COMPOSE_SCHEMA)
}

type Cand = { postTitle?: string; url: string; domain: string; source: string; prefilled?: boolean; name?: string; oneliner?: string; platform?: string; image?: string; slugBase?: string; meta?: string }

async function discoverReddit(subs: string[], win = 'week'): Promise<Cand[]> {
  const t = ['day', 'week', 'month', 'year', 'all'].includes(win) ? win : 'week'
  const rssAll = await Promise.all(subs.map(sub =>
    fetchText(`https://www.reddit.com/r/${sub}/top/.rss?t=${t}&limit=25`, UA_RSS, 12000).then(txt => ({ sub, t: txt }))))
  const out: Cand[] = []
  for (const { sub, t } of rssAll) {
    for (const e of [...t.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => m[1])) {
      const postTitle = dec((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '')
      const content = dec((e.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '')
      const urls = [...new Set([...content.matchAll(/href="([^"]+)"/g)].map(m => m[1]).filter(EXT))]
      if (!urls.length) continue
      const url = urls[0]; const domain = url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0].toLowerCase()
      out.push({ postTitle, url, domain, source: 'r/' + sub })
    }
  }
  return out
}
async function discoverHN(cutoff: number | null): Promise<Cand[]> {
  const flt = cutoff ? `&numericFilters=created_at_i>${cutoff}` : ''
  const j = await fetchJSON(`https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=50${flt}`, UA_RSS, 12000)
  const out: Cand[] = []
  for (const h of ((j && j.hits) || [])) {
    if (!h.url) continue
    const domain = h.url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0].toLowerCase()
    out.push({ postTitle: (h.title || '').replace(/^show hn:?\s*/i, ''), url: h.url, domain, source: 'Show HN' })
  }
  return out
}
async function discoverGitHub(q: string, n = 15): Promise<Cand[]> {
  const j = await fetchJSON(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${Math.min(n, 30)}`, 'legit-directory/0.1')
  const out: Cand[] = []
  for (const r of ((j && j.items) || [])) {
    const hasHome = r.homepage && /^https?:/i.test(r.homepage)
    const url = hasHome ? r.homepage : r.html_url
    const domain = url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0].toLowerCase()
    out.push({
      url, domain, source: 'GitHub', prefilled: true, name: r.name, oneliner: r.description || '',
      platform: hasHome ? 'Web · OSS' : 'Open source', image: (r.owner && r.owner.avatar_url) || '',
      postTitle: r.full_name, slugBase: 'gh-' + r.full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      meta: `★ ${r.stargazers_count} · ${r.language || 'repo'}`,
    })
  }
  return out
}
async function discoverNpm(q: string, n = 15): Promise<Cand[]> {
  const j = await fetchJSON(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=${Math.min(n, 30)}`, 'legit-directory/0.1')
  const out: Cand[] = []
  for (const o of ((j && j.objects) || [])) {
    const p = o.package || {}; const links = p.links || {}
    const url = (links.homepage && /^https?:/i.test(links.homepage) ? links.homepage : null) || links.npm || `https://www.npmjs.com/package/${p.name}`
    const domain = url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0].toLowerCase()
    out.push({
      url, domain, source: 'npm', prefilled: true, name: p.name, oneliner: p.description || '',
      platform: 'npm · CLI/library', image: '', postTitle: p.name,
      slugBase: 'npm-' + (p.name || '').replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      meta: (p.keywords || []).slice(0, 3).join(' · '),
    })
  }
  return out
}

// Resolve a URL through redirects to its final destination.
async function fetchFinalUrl(url: string, ms = 9000): Promise<string | null> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms)
  try { const r = await fetch(url, { headers: { 'user-agent': UA_WEB }, redirect: 'follow', signal: c.signal }); return r.url } catch { return null } finally { clearTimeout(t) }
}

// BetaList: feed → /startups/<slug>/visit 302-redirects to the real product site.
async function discoverBetaList(n: number): Promise<Cand[]> {
  const xml = await fetchText('https://feeds.feedburner.com/BetaList', UA_RSS, 12000)
  const items = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(m => m[1]).slice(0, Math.min(n, 25))
  const out: Cand[] = []
  await Promise.all(items.map(async it => {
    const title = dec((it.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '').replace(/<[^>]+>/g, '').trim()
    const m = it.match(/https?:\/\/betalist\.com\/startups\/[a-z0-9-]+/i)
    if (!m) return
    const final = await fetchFinalUrl(`${m[0]}/visit`)
    if (!final) return
    let host = ''; try { host = new URL(final).host.toLowerCase().replace(/^www\./, '') } catch { return }
    if (/betalist\.com/.test(host)) return
    out.push({ postTitle: title, url: final.split('?')[0], domain: host, source: 'BetaList' })
  }))
  return out
}

// Product Hunt: GraphQL gives the exact product `website` (a PH /r/ redirect we
// follow). Needs PRODUCTHUNT_TOKEN — returns [] gracefully without one.
async function discoverProductHunt(n: number): Promise<Cand[]> {
  if (!PH_TOKEN) return []
  const q = `{ posts(first: ${Math.min(n, 20)}, order: NEWEST) { edges { node { name tagline website url } } } }`
  let j: any = null
  try {
    const r = await fetch('https://api.producthunt.com/v2/api/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${PH_TOKEN}`, 'user-agent': 'legit-directory/0.1' },
      body: JSON.stringify({ query: q }),
    })
    if (!r.ok) return []
    j = await r.json()
  } catch { return [] }
  const out: Cand[] = []
  for (const e of (j?.data?.posts?.edges || [])) {
    const node = e.node || {}
    let site: string | null = node.website || node.url
    if (!site) continue
    if (/producthunt\.com/.test(site)) { const f = await fetchFinalUrl(site); site = f && !/producthunt\.com/.test(f) ? f : null }
    if (!site) continue
    let host = ''; try { host = new URL(site).host.toLowerCase().replace(/^www\./, '') } catch { continue }
    if (NOISE(host)) continue
    out.push({ postTitle: node.tagline || node.name, url: site.split('?')[0], domain: host, source: 'Product Hunt', name: node.name })
  }
  return out
}

async function upsertListings(rows: any[]) {
  if (!SUPABASE_URL || !SR_KEY || !rows.length) return { error: 'no rows / config' }
  const payload = rows.map(L => ({
    slug: L.slug, name: L.name, domain: L.domain, url: L.url, platform: L.platform || null,
    category: (L.rich && L.rich.category) || null,
    tagline: (L.prose && L.prose.tagline) || L.oneliner || null,
    description: (L.prose && L.prose.description) || (L.rich && L.rich.what_it_is) || null,
    who_for: (L.rich && L.rich.who_for) || [], features: (L.rich && L.rich.features) || [],
    pricing: (L.rich && L.rich.pricing) || '', how_to_use: (L.rich && L.rich.how_to_use) || '',
    image_url: L.image || null, icon_url: L.icon || null, source: L.source || null, source_post_title: L.postTitle || null, meta: L.meta || null,
    has_pricing: !!L.price, js_starved: !!L.starved, enriched: !!(L.rich || L.prose),
    canonical_key: L.ckey || null,
    last_fetched_at: new Date().toISOString(),
  }))
  const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?on_conflict=slug`, {
    method: 'POST',
    headers: { apikey: SR_KEY, authorization: `Bearer ${SR_KEY}`, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload),
  })
  if (!r.ok) return { error: `upsert ${r.status}: ${(await r.text()).slice(0, 180)}` }
  return { ok: true }
}

async function runIngest(target: string, opts: { window?: string; limit?: number } = {}) {
  const win = ['day', 'week', 'month', 'year', 'all'].includes(opts.window || '') ? opts.window! : 'week'
  const limit = Math.max(1, Math.min(PICK_HARD_CAP, Number(opts.limit) || 16))
  const enrichN = Math.min(limit, ENRICH_HARD_CAP)
  const windowSec = WINDOW_SECONDS[win]
  const hnCutoff = windowSec == null ? null : Math.floor(Date.now() / 1000) - windowSec
  // per-source discovery breadth scales loosely with the requested limit
  const perSource = Math.min(Math.max(limit, 15), 30)

  // Multi-source token parsing:
  //   hn                  → Show HN          mcp / skills → curated GitHub+npm
  //   gh:<kw> / npm:<kw>  → keyword search   bare word    → Reddit subreddit
  const parts = String(target || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
  const isHN = (p: string) => /^(hn|showhn|hackernews)$/i.test(p) || /news\.ycombinator/i.test(p)
  const isMCP = (p: string) => /^mcp$/i.test(p)
  const isSkills = (p: string) => /^skills?$/i.test(p)
  const isPH = (p: string) => /^(ph|producthunt)$/i.test(p)
  const isBeta = (p: string) => /^betalist$/i.test(p)
  const ghQ: string[] = [], npmQ: string[] = []
  const subs = new Set<string>()
  let wantHN = false, wantMCP = false, wantSkills = false, wantPH = false, wantBeta = false
  for (const p of parts) {
    const gh = p.match(/^(?:gh|github):(.+)$/i); const np = p.match(/^npm:(.+)$/i)
    if (isHN(p)) { wantHN = true; continue }
    if (isMCP(p)) { wantMCP = true; continue }
    if (isSkills(p)) { wantSkills = true; continue }
    if (isPH(p)) { wantPH = true; continue }
    if (isBeta(p)) { wantBeta = true; continue }
    if (gh) { if (gh[1]) ghQ.push(gh[1]); continue }
    if (np) { if (np[1]) npmQ.push(np[1]); continue }
    const m = p.match(/reddit\.com\/r\/([A-Za-z0-9_]+)/i) || p.match(/^\/?r\/([A-Za-z0-9_]+)$/i) || p.match(/^([A-Za-z0-9_]+)$/)
    if (m) subs.add(m[1])
  }
  if (!subs.size && !wantHN && !wantMCP && !wantSkills && !wantPH && !wantBeta && !ghQ.length && !npmQ.length)
    return { error: 'Enter sources — subreddits, "hn", "mcp", "skills", "ph", "betalist", "gh:<keyword>", or "npm:<keyword>".' }

  const raw: Cand[] = []
  if (subs.size) raw.push(...await discoverReddit([...subs], win))
  if (wantHN) raw.push(...await discoverHN(hnCutoff))
  if (wantMCP) raw.push(...await discoverGitHub('mcp server in:name,description,topics', perSource), ...await discoverNpm('mcp', perSource))
  if (wantSkills) raw.push(...await discoverGitHub('claude skill in:name,description,topics', perSource))
  if (wantPH) raw.push(...await discoverProductHunt(perSource))
  if (wantBeta) raw.push(...await discoverBetaList(perSource))
  for (const q of ghQ) raw.push(...await discoverGitHub(`${q} in:name,description,topics`, perSource))
  for (const q of npmQ) raw.push(...await discoverNpm(q, perSource))
  // dedup within this run by canonical key (not just domain)
  const seen = new Set<string>(); const cands: (Cand & { ckey: string })[] = []; let noise = 0
  for (const c of raw) {
    if (NOISE(c.domain)) { noise++; continue }
    const ckey = canonicalKey(c.url)
    if (seen.has(ckey)) continue
    seen.add(ckey); cands.push({ ...c, ckey })
  }
  // cross-run / cross-source dedup: skip products already in the directory
  const known = new Set<string>()
  if (cands.length && SUPABASE_URL && SR_KEY) {
    try {
      const inList = cands.map(c => encodeURIComponent(`"${c.ckey}"`)).join(',')
      const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=canonical_key&canonical_key=in.(${inList})`, { headers: SR })
      if (r.ok) for (const row of (await r.json()) as { canonical_key: string }[]) if (row.canonical_key) known.add(row.canonical_key)
    } catch { /* best effort — worst case we re-upsert (slug merge) */ }
  }
  const fresh = cands.filter(c => !known.has(c.ckey))
  const dupes = cands.length - fresh.length
  const picked = fresh.slice(0, limit)
  const resultsRaw = await Promise.all(picked.map(async (c, i) => {
    let name: string, oneliner: string, platform: string, image = '', icon = '', price = false, starved = false, fullBody = ''
    if (c.prefilled) {
      name = c.name || c.domain; oneliner = c.oneliner || c.postTitle || ''; platform = c.platform || 'Web'
      icon = c.image || ''   // GitHub/npm prefilled image is the owner avatar = an icon
      if (c.url && !/github\.com|npmjs\.com/i.test(c.domain)) {
        const ex = await extractLanding(c.url)
        if (ex.image) image = ex.image
        if (ex.icon && !icon) icon = ex.icon
        if (ex.desc && !oneliner) oneliner = ex.desc
        price = ex.price; starved = ex.starved; fullBody = ex.body
      }
    } else {
      const ex = await extractLanding(c.url)
      name = (ex.title || c.domain).split(/[\|—–\-·:]/)[0].trim().slice(0, 50) || c.domain
      oneliner = ex.desc || c.postTitle || ''; platform = guessPlatform(c.url)
      image = ex.image; icon = ex.icon
      price = ex.price; starved = ex.starved; fullBody = ex.body
    }
    // ── Part 2: spam/junk gate (website candidates; API-sourced github/npm are trusted) ──
    if (!c.prefilled) {
      const probe = `${name} ${fullBody.slice(0, 500)}`
      const junk = !fullBody || fullBody.length < 120
        || /(this domain (is |may be )?for sale|buy this domain|domain (is )?parked|parked (free|domain|by)|account suspended|site (is )?under construction|page not found|404 (not found|error)|error 404|website (is )?expired|godaddy|sedo\.com|hugedomains|default web page)/i.test(probe)
      if (junk) return null
    }
    // ── enrich gate: only substantial pages within the per-run cap hit the LLM ──
    let rich = null, prose = null
    if (i < enrichN && fullBody && fullBody.length >= 200) {
      [rich, prose] = await Promise.all([
        claudeExtract({ name, url: c.url, source: c.source, bodyText: fullBody }),
        claudeCompose({ name, url: c.url, bodyText: fullBody }),
      ])
    }
    return { slug: slugify(c.slugBase || c.domain), name, oneliner, url: c.url, domain: c.domain, platform, image, icon, price, starved, source: c.source, postTitle: c.postTitle, meta: c.meta || '', rich, prose, ckey: c.ckey }
  }))
  const results = resultsRaw.filter(Boolean) as NonNullable<typeof resultsRaw[number]>[]
  const up = await upsertListings(results)
  const sources = [
    ...[...subs].map(s => 'r/' + s),
    ...(wantHN ? ['Show HN'] : []), ...(wantMCP ? ['GitHub·MCP', 'npm·MCP'] : []), ...(wantSkills ? ['GitHub·Skills'] : []),
    ...(wantPH ? ['Product Hunt'] : []), ...(wantBeta ? ['BetaList'] : []),
    ...ghQ.map(q => `gh:${q}`), ...npmQ.map(q => `npm:${q}`),
  ]
  return {
    sources, window: win, limit, enriched_cap: enrichN,
    discovered: cands.length, noise, already_in_directory: dupes, gated_out: picked.length - results.length, kept: results.length, upsert: up,
    items: results.map(r => ({ slug: r.slug, name: r.name, domain: r.domain, category: r.rich?.category || null, enriched: !!(r.rich || r.prose) })),
  }
}

async function patchListing(id: string, patch: Record<string, unknown>) {
  const allow = ['category', 'tagline', 'description', 'platform', 'pricing']
  const clean: Record<string, unknown> = {}
  for (const k of allow) if (k in patch) clean[k] = patch[k]
  if (!Object.keys(clean).length) return { error: 'no allowed fields' }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey: SR_KEY, authorization: `Bearer ${SR_KEY}`, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify(clean),
  })
  return r.ok ? { ok: true } : { error: `patch ${r.status}` }
}
async function deleteListing(id: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${id}`, {
    method: 'DELETE', headers: { apikey: SR_KEY, authorization: `Bearer ${SR_KEY}`, prefer: 'return=minimal' },
  })
  return r.ok ? { ok: true } : { error: `delete ${r.status}` }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!(await isAuthedAdmin(req))) return json({ error: 'unauthorized' }, 401)
  let payload: any = {}
  try { payload = await req.json() } catch { return json({ error: 'bad json' }, 400) }
  const action = payload.action || 'ingest'
  try {
    if (action === 'ingest') return json(await runIngest(payload.target || '', { window: payload.window, limit: payload.limit }))
    if (action === 'update') return json(await patchListing(String(payload.id), payload.patch || {}))
    if (action === 'delete') return json(await deleteListing(String(payload.id)))
    return json({ error: 'unknown action' }, 400)
  } catch (e) { return json({ error: String(e) }, 500) }
})
