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
  if (!jwt) return false
  // Internal/cron server-to-server calls present a service-role JWT (role claim).
  // It is never shipped to the browser — the web app only ever holds the anon key —
  // and a service-role token already has full PostgREST access, so this is no escalation.
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

// Any signed-in member (not necessarily admin) — for the self-serve submit path.
async function getMemberId(req: Request): Promise<string | null> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt || jwt === ANON_KEY || !SUPABASE_URL || !SR_KEY) return null
  try {
    const supa = createClient(SUPABASE_URL, SR_KEY)
    const { data, error } = await supa.auth.getUser(jwt)
    if (error || !data.user) return null
    return data.user.id
  } catch { return null }
}

// True if `memberId` submitted listing `id` OR verified ownership of it.
async function isListingOwner(id: string, memberId: string): Promise<boolean> {
  if (!id || !memberId) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${id}&select=submitted_by,verified_by&limit=1`,
      { headers: { apikey: SR_KEY, authorization: `Bearer ${SR_KEY}` } })
    if (!r.ok) return false
    const rows = await r.json() as { submitted_by: string | null; verified_by: string | null }[]
    return !!rows[0] && (rows[0].submitted_by === memberId || rows[0].verified_by === memberId)
  } catch { return false }
}

// Ownership verification via domain meta tag (or DNS TXT).
async function runVerifyToken(id: string) {
  const SRH = { apikey: SR_KEY, authorization: `Bearer ${SR_KEY}` }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${id}&select=verify_token,domain,verified_by&limit=1`, { headers: SRH })
  const row = (r.ok ? await r.json() : [])[0] as { verify_token: string | null; domain: string; verified_by: string | null } | undefined
  if (!row) return { error: 'not_found' }
  if (row.verified_by) return { verified: true }
  let token = row.verify_token
  if (!token) {
    token = 'legit-' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)
    await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${id}`,
      { method: 'PATCH', headers: { ...SRH, 'content-type': 'application/json', prefer: 'return=minimal' }, body: JSON.stringify({ verify_token: token }) })
  }
  return { token, domain: row.domain }
}
async function runVerify(id: string, memberId: string) {
  const SRH = { apikey: SR_KEY, authorization: `Bearer ${SR_KEY}` }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${id}&select=verify_token,domain,url,verified_by&limit=1`, { headers: SRH })
  const row = (r.ok ? await r.json() : [])[0] as { verify_token: string | null; domain: string; url: string | null; verified_by: string | null } | undefined
  if (!row) return { error: 'not_found' }
  if (row.verified_by) return { verified: true }
  if (!row.verify_token) return { verified: false, message: 'Get a verification tag first.' }
  const tok = row.verify_token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 1) meta tag on the site
  const html = await fetchText(row.url || `https://${row.domain}`, UA_WEB, 9000)
  const metaOk = new RegExp(`<meta[^>]+name=["']legit-verify["'][^>]+content=["']${tok}["']`, 'i').test(html)
    || new RegExp(`<meta[^>]+content=["']${tok}["'][^>]+name=["']legit-verify["']`, 'i').test(html)
  // 2) DNS TXT _legit.<domain> via DNS-over-HTTPS
  let dnsOk = false
  if (!metaOk) {
    try {
      const dr = await fetch(`https://cloudflare-dns.com/dns-query?name=_legit.${row.domain}&type=TXT`, { headers: { accept: 'application/dns-json' } })
      const dj = await dr.json() as { Answer?: { data: string }[] }
      dnsOk = !!dj.Answer?.some(a => a.data.includes(row.verify_token!))
    } catch { /* DNS lookup failed — fall through */ }
  }
  if (!metaOk && !dnsOk) return { verified: false, message: "Couldn't find the verification tag yet. Add it, give it a minute to deploy, and try again." }
  await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${id}`,
    { method: 'PATCH', headers: { ...SRH, 'content-type': 'application/json', prefer: 'return=minimal' }, body: JSON.stringify({ verified_by: memberId, verified_at: new Date().toISOString() }) })
  return { verified: true }
}

// Deterministic per-(member, domain) token — recomputed on verify, no storage.
// Lets the submit flow gate publishing on ownership BEFORE any listing exists.
async function makeVerifyToken(memberId: string, ckey: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SR_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${memberId}:${ckey}`))
  return 'legit-' + btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, '').slice(0, 28)
}
async function domainHasToken(url: string | null, domain: string, token: string): Promise<boolean> {
  const tok = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const html = await fetchText(url || `https://${domain}`, UA_WEB, 9000)
  if (new RegExp(`<meta[^>]+name=["']legit-verify["'][^>]+content=["']${tok}["']`, 'i').test(html)
    || new RegExp(`<meta[^>]+content=["']${tok}["'][^>]+name=["']legit-verify["']`, 'i').test(html)) return true
  try {
    const dr = await fetch(`https://cloudflare-dns.com/dns-query?name=_legit.${domain}&type=TXT`, { headers: { accept: 'application/dns-json' } })
    const dj = await dr.json() as { Answer?: { data: string }[] }
    if (dj.Answer?.some(a => a.data.includes(token))) return true
  } catch { /* DNS lookup failed */ }
  return false
}
function normalizeSubmitUrl(rawUrl: string): { url: string; host: string } | { error: string; message: string } {
  let url = (rawUrl || '').trim()
  if (!url) return { error: 'no_url', message: 'Enter your service URL.' }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  let host = ''
  try { host = new URL(url).host.toLowerCase().replace(/^www\./, '') } catch { return { error: 'bad_url', message: 'That does not look like a valid URL.' } }
  if (NOISE(host)) return { error: 'not_eligible', message: "That URL isn't eligible — submit the product's own site." }
  return { url, host }
}
async function existingSlug(ckey: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?canonical_key=eq.${encodeURIComponent(ckey)}&select=slug&limit=1`,
    { headers: { apikey: SR_KEY, authorization: `Bearer ${SR_KEY}` } })
  return r.ok ? (await r.json() as { slug: string }[])[0]?.slug || null : null
}
// Submit flow is owner-gated: prepare a token, then publish only after verify.
async function runVerifyPrepare(rawUrl: string, memberId: string) {
  const n = normalizeSubmitUrl(rawUrl); if ('error' in n) return n
  const ckey = canonicalKey(n.url)
  const slug = await existingSlug(ckey); if (slug) return { existing: true, slug }
  return { token: await makeVerifyToken(memberId, ckey), domain: n.host }
}
async function runVerifyPublish(rawUrl: string, memberId: string, fields: SubmitFields) {
  const n = normalizeSubmitUrl(rawUrl); if ('error' in n) return n
  const ckey = canonicalKey(n.url)
  const slug = await existingSlug(ckey); if (slug) return { existing: true, slug }
  const token = await makeVerifyToken(memberId, ckey)
  if (!(await domainHasToken(n.url, n.host, token))) return { verified: false, message: "Couldn't find the verification tag yet. Add it, give it a minute to deploy, and try again." }
  return await runSubmit(n.url, memberId, { fields, verifiedBy: memberId })
}

const UA_RSS = 'legit-directory-research/0.1 (by /u/legit_research)'
const UA_WEB = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const EXTRACT_MODEL = 'claude-haiku-4-5'
const COMPOSE_MODEL = 'claude-sonnet-4-6'
const ENRICH_HARD_CAP = 16   // latency ceiling on Claude enrichments per run
const PICK_HARD_CAP = 30     // ceiling on candidates processed per run
// Reddit `t` window → seconds (HN recency cutoff). null = all-time.
const WINDOW_SECONDS: Record<string, number | null> = { day: 86400, week: 604800, month: 2592000, year: 31536000, all: null }

// Canonical category taxonomy — keep this list in sync with the directory's
// reclassifier. `category` is constrained to this enum so the chip filter never
// fragments again; `subcategory` carries the granular free-text label.
const CANON_CATEGORIES = [
  'AI & Agents', 'Developer Tools', 'MCP & Integrations', 'Frameworks & Starter Kits',
  'Infrastructure & DevOps', 'Data & Analytics', 'Productivity', 'Business & Finance',
  'Design & Creative', 'Content & Docs', 'Education & Reference', 'Lifestyle & Other',
]

const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    what_it_is: { type: 'string' }, who_for: { type: 'array', items: { type: 'string' } },
    features: { type: 'array', items: { type: 'string' } }, pricing: { type: 'string' },
    how_to_use: { type: 'string' },
    category: { type: 'string', enum: CANON_CATEGORIES },
    subcategory: { type: 'string' },
  },
  required: ['what_it_is', 'who_for', 'features', 'pricing', 'how_to_use', 'category', 'subcategory'],
}
const COMPOSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { tagline: { type: 'string' }, description: { type: 'string' } },
  required: ['tagline', 'description'],
}

const dec = (x: string) => (x || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
const slugify = (d: string) => d.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 44)

// Page <title> is often generic ("New Tab", "Home") or SEO-stuffed. Prefer a
// clean candidate (source post title / API name) over those.
const GENERIC_TITLE = /^(new tab|home|homepage|dashboard|welcome|loading|untitled|index|app|application|log ?in|sign ?in|sign ?up|get started|page not found|404|website|overview|console|start|menu)$/i
const firstSeg = (s: string) => (s || '').split(/\s[–—-]\s|[|·:]/)[0].trim()
function pickName(cands: (string | undefined)[], domain: string): string {
  for (const c of cands) { const v = firstSeg(c || ''); if (v && !GENERIC_TITLE.test(v) && v.length <= 48) return v }
  for (const c of cands) { const v = firstSeg(c || ''); if (v) return v.slice(0, 48) }
  return domain
}

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
  const system = `You extract structured directory-listing fields from a web page's own text. GROUNDED-ONLY: use only facts stated in the provided text. If a field is not stated, return an empty string or empty array — NEVER invent. Pricing especially: if no explicit price/plan is on the page, set pricing to "". who_for: up to 5 short audience labels. features: 3-6 short concrete phrases. Be concise.
category: choose the SINGLE best-fit canonical bucket from this fixed list (the directory excludes games), by the product's primary purpose: ${CANON_CATEGORIES.join(' · ')}.
subcategory: one short specific free-text label for the finer kind (e.g. "Web analytics", "MCP server", "React UI library", "OCR API").`
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
  // De-dup by slug within this batch: PostgREST upsert with on_conflict=slug fails
  // hard (21000 "ON CONFLICT DO UPDATE cannot affect row a second time") if the same
  // slug appears twice in one command. Canonical-key dedup runs earlier, but two
  // distinct keys can still slugify to the same value (e.g. same domain, different
  // path). Keep the first occurrence.
  const seenSlug = new Set<string>()
  rows = rows.filter(L => { const s = L.slug; if (!s || seenSlug.has(s)) return false; seenSlug.add(s); return true })
  if (!rows.length) return { error: 'no rows after slug-dedup' }
  const payload = rows.map(L => ({
    slug: L.slug, name: L.name, domain: L.domain, url: L.url, platform: L.platform || null,
    category: (L.rich && L.rich.category) || null,
    subcategory: (L.rich && L.rich.subcategory) || null,
    tagline: (L.prose && L.prose.tagline) || L.oneliner || null,
    description: (L.prose && L.prose.description) || (L.rich && L.rich.what_it_is) || null,
    who_for: (L.rich && L.rich.who_for) || [], features: (L.rich && L.rich.features) || [],
    pricing: (L.rich && L.rich.pricing) || '', how_to_use: (L.rich && L.rich.how_to_use) || '',
    image_url: L.image || null, icon_url: L.icon || null, source: L.source || null, source_post_title: L.postTitle || null, meta: L.meta || null,
    has_pricing: !!L.price, js_starved: !!L.starved, enriched: !!(L.rich || L.prose),
    canonical_key: L.ckey || null,
    ...(L.submitted_by ? { submitted_by: L.submitted_by } : {}),
    ...(L.verified_by ? { verified_by: L.verified_by, verified_at: L.verified_at } : {}),
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
      name = pickName([c.name, ex.title, c.postTitle], c.domain)
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
  // Fire-and-forget: benchmark the freshly-ingested rows (benchmark IS NULL) so a
  // new listing never sits un-scored. Service-role self-call; cron sweep covers any
  // that race or exceed this cap. Non-blocking — the ingest response returns at once.
  if (results.length && !(up as { error?: string })?.error) {
    try {
      ;(globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(
        fetch(`${SUPABASE_URL}/functions/v1/benchmark-listing`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${SR_KEY}` },
          body: JSON.stringify({ pending: true, limit: 30 }),
        }).catch(() => {}),
      )
    } catch { /* waitUntil not available in this runtime — non-fatal */ }
  }
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
  const allow = ['category', 'subcategory', 'tagline', 'description', 'platform', 'pricing', 'has_pricing']
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

// Self-serve submit: a signed-in member POSTs a single URL. Resolve canonical →
// route to an existing listing if we already have it · per-member daily cap ·
// spam/junk gate · grounded Claude enrich · upsert · fire-and-forget benchmark.
type SubmitFields = { name?: string; tagline?: string; description?: string; category?: string; pricing?: string; platform?: string; has_pricing?: boolean }
async function runSubmit(rawUrl: string, memberId: string, opts: { preview?: boolean; fields?: SubmitFields; verifiedBy?: string } = {}) {
  let url = (rawUrl || '').trim()
  if (!url) return { error: 'no_url', message: 'Enter your service URL.' }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  let host = ''
  try { host = new URL(url).host.toLowerCase().replace(/^www\./, '') } catch { return { error: 'bad_url', message: 'That does not look like a valid URL.' } }
  if (NOISE(host)) return { error: 'not_eligible', message: "Social, marketplace and link-shortener URLs aren't eligible — submit the product's own site." }
  const ckey = canonicalKey(url)
  const SRH = { apikey: SR_KEY, authorization: `Bearer ${SR_KEY}` }

  // already in the directory? route there instead of duplicating
  const exr = await fetch(`${SUPABASE_URL}/rest/v1/listings?canonical_key=eq.${encodeURIComponent(ckey)}&select=slug&limit=1`, { headers: SRH })
  const exist = exr.ok ? await exr.json() as { slug: string }[] : []
  if (exist[0]?.slug) return { existing: true, slug: exist[0].slug }

  // fetch the landing page + spam/junk gate (both preview and final)
  const ex = await extractLanding(url)
  const autoName = pickName([ex.title], host)
  const probe = `${autoName} ${ex.body.slice(0, 500)}`
  const junk = !ex.body || ex.body.length < 120
    || /(this domain (is |may be )?for sale|buy this domain|domain (is )?parked|parked (free|domain|by)|account suspended|site (is )?under construction|page not found|404 (not found|error)|error 404|website (is )?expired|godaddy|sedo\.com|hugedomains|default web page)/i.test(probe)
  if (junk) return { error: 'thin', message: "We couldn't read enough from that page to list it — make sure the URL loads a public landing page." }

  const f = opts.fields || {}
  // grounded enrichment runs on preview, or when the owner didn't supply core copy
  let rich: { what_it_is?: string; category?: string; pricing?: string; [k: string]: unknown } | null = null
  let prose: { tagline?: string; description?: string } | null = null
  if ((opts.preview || !(f.tagline && f.description && f.category)) && ex.body.length >= 200) {
    [rich, prose] = await Promise.all([
      claudeExtract({ name: autoName, url, source: 'Submitted', bodyText: ex.body }),
      claudeCompose({ name: autoName, url, bodyText: ex.body }),
    ])
  }

  // preview = prefill the form, nothing saved
  if (opts.preview) {
    return { preview: true, fields: {
      name: autoName,
      tagline: prose?.tagline || ex.desc || '',
      description: prose?.description || rich?.what_it_is || '',
      category: rich?.category || '',
      pricing: rich?.pricing || '',
    } }
  }

  // final submit — per-member daily cap, then owner fields override the enrichment
  const since = new Date(Date.now() - 86400000).toISOString()
  const rl = await fetch(`${SUPABASE_URL}/rest/v1/listings?submitted_by=eq.${memberId}&created_at=gte.${since}&select=id`,
    { headers: { ...SRH, prefer: 'count=exact', range: '0-0', 'range-unit': 'items' } })
  const used = Number((rl.headers.get('content-range') || '/0').split('/')[1] || 0)
  if (used >= 5) return { error: 'rate_limit', message: "You've submitted 5 services today — try again tomorrow." }

  const richOut = { ...(rich || {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.pricing != null ? { pricing: f.pricing } : {}),
    ...(f.description ? { what_it_is: f.description } : {}) }
  const proseOut = { tagline: f.tagline || prose?.tagline || '', description: f.description || prose?.description || '' }
  const row = {
    slug: slugify(host), name: f.name || autoName, oneliner: f.tagline || ex.desc || '',
    url, domain: host, platform: f.platform || guessPlatform(url),
    image: ex.image, icon: ex.icon, price: f.has_pricing != null ? f.has_pricing : !!(f.pricing || ex.price), starved: ex.starved,
    source: 'Submitted', postTitle: '', meta: '', rich: richOut, prose: proseOut, ckey, submitted_by: memberId,
    verified_by: opts.verifiedBy || null, verified_at: opts.verifiedBy ? new Date().toISOString() : null,
  }
  const up = await upsertListings([row])
  if ((up as { error?: string })?.error) return { error: 'save_failed', message: 'Could not save the listing. Please try again.' }

  try {
    ;(globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(
      fetch(`${SUPABASE_URL}/functions/v1/benchmark-listing`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SR_KEY}` },
        body: JSON.stringify({ pending: true, limit: 5 }),
      }).catch(() => {}),
    )
  } catch { /* waitUntil unavailable — benchmark still runs on the weekly sweep */ }

  // return the id + domain so the submit flow can offer ownership verification next
  let id: string | undefined
  try {
    const idr = await fetch(`${SUPABASE_URL}/rest/v1/listings?canonical_key=eq.${encodeURIComponent(ckey)}&select=id&limit=1`, { headers: SRH })
    id = (idr.ok ? await idr.json() : [])[0]?.id
  } catch { /* id lookup best-effort */ }
  return { slug: row.slug, name: row.name, id, domain: host }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let payload: any = {}
  try { payload = await req.json() } catch { return json({ error: 'bad json' }, 400) }
  const action = payload.action || 'ingest'

  // Self-serve submit is open to any signed-in member (not admin-gated).
  if (action === 'submit') {
    const memberId = await getMemberId(req)
    if (!memberId) return json({ error: 'unauthorized', message: 'Sign in to submit a service.' }, 401)
    try { return json(await runSubmit(String(payload.url || ''), memberId, { preview: !!payload.preview, fields: payload.fields })) }
    catch (e) { return json({ error: 'server', message: String(e) }, 500) }
  }

  // Owner-gated submit: prepare a domain token, then publish only after verify.
  if (action === 'verify_prepare' || action === 'verify_publish') {
    const memberId = await getMemberId(req)
    if (!memberId) return json({ error: 'unauthorized', message: 'Sign in to add your service.' }, 401)
    try {
      return json(action === 'verify_prepare'
        ? await runVerifyPrepare(String(payload.url || ''), memberId)
        : await runVerifyPublish(String(payload.url || ''), memberId, payload.fields || {}))
    } catch (e) { return json({ error: 'server', message: String(e) }, 500) }
  }

  // Ownership verification of an existing listing (claim from the listing page).
  if (action === 'verify_token' || action === 'verify') {
    const memberId = await getMemberId(req)
    if (!memberId) return json({ error: 'unauthorized', message: 'Sign in to verify ownership.' }, 401)
    const id = String(payload.id || '')
    try {
      return json(action === 'verify_token' ? await runVerifyToken(id) : await runVerify(id, memberId))
    } catch (e) { return json({ error: 'server', message: String(e) }, 500) }
  }

  // Edit is open to the listing's owner (the member who submitted it) or an admin.
  if (action === 'update') {
    const id = String(payload.id || '')
    const admin = await isAuthedAdmin(req)
    if (!admin) {
      const memberId = await getMemberId(req)
      if (!memberId) return json({ error: 'unauthorized', message: 'Sign in to edit.' }, 401)
      if (!(await isListingOwner(id, memberId))) return json({ error: 'forbidden', message: 'You can only edit a service you added.' }, 403)
    }
    try { return json(await patchListing(id, payload.patch || {})) }
    catch (e) { return json({ error: 'server', message: String(e) }, 500) }
  }

  // Discovery + delete stay admin-only.
  if (!(await isAuthedAdmin(req))) return json({ error: 'unauthorized' }, 401)
  try {
    if (action === 'ingest') return json(await runIngest(payload.target || '', { window: payload.window, limit: payload.limit }))
    if (action === 'delete') return json(await deleteListing(String(payload.id)))
    return json({ error: 'unknown action' }, 400)
  } catch (e) { return json({ error: String(e) }, 500) }
})
