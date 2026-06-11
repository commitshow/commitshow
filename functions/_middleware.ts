// Root Pages Function middleware · AEO crawler + visitor analytics.
//
// Runs on EVERY request. Sniffs the User-Agent and fires a non-blocking
// INSERT into one of two tables via service_role:
//   · AI crawler  → ai_crawler_hits  (GPTBot · ClaudeBot · etc · §AEO)
//   · Human visit → visitor_hits     (everything else, with filters)
//
// User-facing latency is unchanged · DB writes happen after the response
// goes out via ctx.waitUntil.
//
// Filters (visitor side):
//   · skip static assets (.css/.js/.png/.svg/.webp/.mp4/.ico/.xml/etc)
//   · skip bot-ish UAs that don't match our AI list (generic crawler/
//     spider/headless · monitoring bots like uptime/pingdom)
//   · skip /functions/* admin endpoints (those are server-to-server)
//
// Design notes:
//   · IP hashed (djb2) · UA / Path / Referer truncated to safe lengths.
//   · visitor_hash = djb2(ip + day_floor + ua_class) · cookie-free
//     unique-visitor approximation per day per device.
//   · referer classified into kind: search / social / direct / internal / other.
//   · country pulled from CF-IPCountry (Cloudflare auto-injects).

interface Env {
  SUPABASE_URL?:               string
  SUPABASE_SERVICE_ROLE_KEY?:  string
  SUPABASE_ANON_KEY?:          string
}

const KNOWN_CRAWLERS: Array<{ pattern: RegExp; kind: string }> = [
  // Anthropic
  { pattern: /ClaudeBot/i,        kind: 'claudebot' },
  { pattern: /Claude-Web/i,       kind: 'claude-web' },
  { pattern: /anthropic-ai/i,     kind: 'anthropic-ai' },
  { pattern: /Claude-User/i,      kind: 'claude-user' },
  // OpenAI
  { pattern: /GPTBot/i,           kind: 'gptbot' },
  { pattern: /ChatGPT-User/i,     kind: 'chatgpt-user' },
  { pattern: /OAI-SearchBot/i,    kind: 'oai-searchbot' },
  // Perplexity
  { pattern: /PerplexityBot/i,    kind: 'perplexitybot' },
  { pattern: /Perplexity-User/i,  kind: 'perplexity-user' },
  // Google AI
  { pattern: /Google-Extended/i,  kind: 'google-extended' },
  // Apple AI
  { pattern: /Applebot-Extended/i, kind: 'applebot-extended' },
  { pattern: /Applebot/i,         kind: 'applebot' },
  // Meta · Bytedance · Common Crawl
  { pattern: /meta-externalagent/i, kind: 'meta-externalagent' },
  { pattern: /Bytespider/i,       kind: 'bytespider' },
  { pattern: /CCBot/i,            kind: 'ccbot' },
  // Microsoft · Cohere · others
  { pattern: /cohere-ai/i,        kind: 'cohere-ai' },
  { pattern: /Diffbot/i,          kind: 'diffbot' },
  { pattern: /YouBot/i,           kind: 'youbot' },
  { pattern: /MistralAI-User/i,   kind: 'mistral-user' },
]

function classifyUA(ua: string): string | null {
  for (const c of KNOWN_CRAWLERS) {
    if (c.pattern.test(ua)) return c.kind
  }
  return null
}

// Generic non-AI bot patterns · we skip these from visitor analytics
// without logging them anywhere (uptime monitors / generic crawlers).
const GENERIC_BOT_RE = /\b(bot|crawler|spider|scraper|headless|phantom|puppeteer|playwright|monitor|uptime|pingdom|webhook)\b/i

// Static-asset path filter · skip from visitor logs (CSS/JS/images
// would 10x our writes for no analytic value).
const STATIC_ASSET_RE = /\.(css|js|map|mjs|json|xml|ico|svg|png|jpe?g|webp|gif|mp4|webm|woff2?|ttf|otf|eot|wasm|txt)$/i

// Scanner-bot probe paths · commodity secret/admin scanners (nuclei,
// feroxbuster, gobuster, .env scrapers) hammer these from cloud VPS
// IPs. Their UA is often a real browser string (rotated to evade
// GENERIC_BOT_RE), so the only reliable signal is the requested path.
// Logging them inflates country/visitor stats with bot noise — most
// notable was a NL-VPS sweep skewing dashboards before this filter
// landed (~95% of NL pageviews were /.env · /.git/config · /.aws/*).
const SCANNER_DOTFILE_RE = /\/\.(env|git|aws|ssh|htaccess|htpasswd|svn|hg|ds_store|vscode|idea|pypirc|npmrc|dockercfg|docker|kube|terraform|terraformrc|gem|m2|netrc)(\/|\.|$)/i
const SCANNER_ADMIN_RE   = /^\/(wp-admin|wp-login|wp-content|wp-includes|xmlrpc|phpmyadmin|administrator|admin\.php|server-status|server-info|webdav|owa|ecp|autodiscover|cgi-bin|telescope|debug|actuator|console)(\/|\.|$)/i
// API probe paths · cloud-VPS scanners trying to read app secrets via
// guessed endpoints. Conservative · only matches known leak surfaces
// (env / config / settings / secrets / credentials), not generic API
// routes like /api/account or /api/health that may be legitimate later.
const SCANNER_APIPROBE_RE = /^\/api(?:\/v\d+)?\/(env|config|settings|secrets|credentials|keys|tokens)(\/|\.|$)/i

// Referer kind classifier · maps host to one of 5 buckets.
const SEARCH_HOSTS = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'naver.', 'baidu.', 'yandex.', 'kagi.']
const SOCIAL_HOSTS = ['x.com', 'twitter.com', 't.co', 'reddit.com', 'news.ycombinator.com', 'linkedin.com',
                      'facebook.com', 'fb.me', 'instagram.com', 'mastodon.', 'threads.net', 'bsky.', 'youtube.com',
                      'discord.', 'github.com', 'gitlab.com', 'producthunt.com', 'medium.com']

function classifyReferer(refererHost: string | null, ownHost: string): { host: string | null; kind: string } {
  if (!refererHost) return { host: null, kind: 'direct' }
  const h = refererHost.toLowerCase()
  if (h === ownHost || h.endsWith('.' + ownHost)) return { host: h, kind: 'internal' }
  for (const s of SEARCH_HOSTS) if (h.includes(s)) return { host: h, kind: 'search' }
  for (const s of SOCIAL_HOSTS) if (h.includes(s)) return { host: h, kind: 'social' }
  return { host: h, kind: 'other' }
}

// UA → device class. Mobile detection by common tokens; tablet by 'iPad' / Android tablet hints.
function classifyDevice(ua: string): 'mobile' | 'tablet' | 'desktop' | 'unknown' {
  if (!ua) return 'unknown'
  if (/iPad|Tablet|Tab\b/i.test(ua)) return 'tablet'
  if (/Android(?!.*Mobile)/i.test(ua)) return 'tablet'
  if (/Mobile|iPhone|iPod|Android|Silk|Kindle/i.test(ua)) return 'mobile'
  return 'desktop'
}

function classifyBrowser(ua: string): string {
  // Order matters · Edge before Chrome (UA contains both) · Chrome before Safari (Chrome includes Safari token).
  if (/Edg\//i.test(ua))                        return 'edge'
  if (/OPR\/|Opera/i.test(ua))                  return 'opera'
  if (/Firefox\//i.test(ua))                    return 'firefox'
  if (/Chrome\//i.test(ua))                     return 'chrome'
  if (/Safari\//i.test(ua))                     return 'safari'
  if (/MSIE|Trident/i.test(ua))                 return 'ie'
  return 'other'
}

// djb2 hash · ASCII-safe · 32-bit. Same algorithm we use elsewhere
// (preview_rate_limits ip_hash) so cross-table joins line up if we
// ever need them.
function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

function safeRefererHost(req: Request): string | null {
  const r = req.headers.get('referer') ?? req.headers.get('referrer')
  if (!r) return null
  try { return new URL(r).host.toLowerCase().slice(0, 120) }
  catch { return null }
}

async function logCrawlerHit(env: Env, req: Request, response: Response, kind: string): Promise<void> {
  const supabaseUrl = env.SUPABASE_URL
  const serviceKey  = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return

  const ua   = req.headers.get('user-agent') ?? ''
  const url  = new URL(req.url)
  const ip   = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? ''

  const row = {
    ua_kind:     kind,
    ua_full:     ua.slice(0, 240),
    path:        (url.pathname + (url.search ? '?' + url.searchParams.toString() : '')).toLowerCase().slice(0, 200),
    status_code: response.status,
    ip_hash:     ip ? djb2(ip) : null,
    referer_host: safeRefererHost(req),
  }

  try {
    await fetch(`${supabaseUrl}/rest/v1/ai_crawler_hits`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(row),
    })
  } catch { /* swallowed · waitUntil */ }
}

async function logVisitorHit(env: Env, req: Request, response: Response): Promise<void> {
  const supabaseUrl = env.SUPABASE_URL
  const serviceKey  = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return

  const ua  = req.headers.get('user-agent') ?? ''
  const url = new URL(req.url)
  const ip  = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? ''

  const path = url.pathname.toLowerCase()
  // Skip filters · static assets and admin function endpoints.
  if (STATIC_ASSET_RE.test(path)) return
  if (path.startsWith('/functions/')) return
  if (path === '/robots.txt' || path === '/sitemap.xml') return  // tracked separately as crawler hits when bots fetch them
  // Skip scanner-bot probe paths · see SCANNER_*_RE comment above.
  if (SCANNER_DOTFILE_RE.test(path))  return
  if (SCANNER_ADMIN_RE.test(path))    return
  if (SCANNER_APIPROBE_RE.test(path)) return
  // Skip generic bot UAs we don't classify as AI crawlers.
  if (!ua || GENERIC_BOT_RE.test(ua)) return
  // Skip empty UAs (likely bot too).
  if (ua.length < 16) return

  const ipHash      = ip ? djb2(ip) : null
  const dayFloorMs  = Math.floor(Date.now() / 86400000)
  const device      = classifyDevice(ua)
  const browser     = classifyBrowser(ua)
  // Cookie-free unique-visitor proxy · stable per (ip + day + device class).
  const visitorHash = djb2(`${ipHash ?? 'anon'}:${dayFloorMs}:${device}:${browser}`)

  const refHost = safeRefererHost(req)
  const ownHost = url.host.toLowerCase()
  const ref     = classifyReferer(refHost, ownHost)
  const country = req.headers.get('cf-ipcountry') ?? null

  const row = {
    visitor_hash:  visitorHash,
    ip_hash:       ipHash ?? '',
    path:          (url.pathname + (url.search ? '?' + url.searchParams.toString() : '')).slice(0, 200),
    referer_host:  ref.host,
    referer_kind:  ref.kind,
    country:       country && country.length === 2 ? country : null,
    device,
    browser,
    status_code:   response.status,
  }

  try {
    await fetch(`${supabaseUrl}/rest/v1/visitor_hits`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(row),
    })
  } catch { /* swallowed · waitUntil */ }
}

// ─── Legit.Show directory SEO/AEO · server-rendered meta + JSON-LD ──────────
// The directory now lives at the root. These routes (/, /s/<slug>, /insights,
// /alternatives/<slug>) get per-page <title>/meta + schema.org injected at the
// edge so crawlers and answer engines see structured data without running JS.
// Non-directory paths return null → the SPA shell is served unchanged (so the
// legacy commit.show product under /old keeps its own default meta).
const SITE = 'https://legit.show'
const supa = (env: Env) => env.SUPABASE_URL ?? 'https://tekemubwihsjdzittoqf.supabase.co'

type Listing = {
  id: string; slug: string; name: string; domain: string; url: string
  platform: string | null; category: string | null
  tagline: string | null; description: string | null
  who_for: string[] | null; features: string[] | null
  pricing: string | null; image_url: string | null; icon_url: string | null
  has_pricing: boolean; info_as_of: string | null
}
async function getListing(env: Env, slug: string): Promise<Listing | null> {
  const key = env.SUPABASE_ANON_KEY ?? ''
  if (!key) return null
  const cols = 'id,slug,name,domain,url,platform,category,tagline,description,who_for,features,pricing,image_url,icon_url,has_pricing,info_as_of'
  const r = await fetch(`${supa(env)}/rest/v1/listings?slug=eq.${encodeURIComponent(slug)}&select=${cols}&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!r.ok) return null
  return ((await r.json()) as Listing[])[0] ?? null
}
type ReportRow = {
  slug: string; title: string; subtitle: string; coined_term: string | null
  hero_stat: { value: number; label: string; n: number } | null
  sample: { total: number; scope: string; as_of: string } | null
  stats: { label: string; fail_pct: number | null; n: number }[] | null
  published_at: string
}
async function getReport(env: Env, slug: string): Promise<ReportRow | null> {
  const key = env.SUPABASE_ANON_KEY ?? ''
  if (!key) return null
  const cols = 'slug,title,subtitle,coined_term,hero_stat,sample,stats,published_at'
  const r = await fetch(`${supa(env)}/rest/v1/reports?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=${cols}&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!r.ok) return null
  return ((await r.json()) as ReportRow[])[0] ?? null
}
async function getStats(env: Env, id: string): Promise<{ avg: number; count: number }> {
  const key = env.SUPABASE_ANON_KEY ?? ''
  const h = { apikey: key, Authorization: `Bearer ${key}` }
  try {
    const a = await fetch(`${supa(env)}/rest/v1/listing_rating_stats?listing_id=eq.${id}&select=avg_rating,rating_count`, { headers: h })
    const ar = a.ok ? (await a.json())[0] : null
    return { avg: ar?.avg_rating ?? 0, count: ar?.rating_count ?? 0 }
  } catch { return { avg: 0, count: 0 } }
}
async function getAlternatives(env: Env, category: string | null, slug: string): Promise<{ slug: string; name: string; url: string }[]> {
  const key = env.SUPABASE_ANON_KEY ?? ''
  if (!key || !category) return []
  const r = await fetch(`${supa(env)}/rest/v1/listings?category=eq.${encodeURIComponent(category)}&slug=neq.${encodeURIComponent(slug)}&benchmark=not.is.null&select=slug,name,url&limit=12`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!r.ok) return []
  return await r.json() as { slug: string; name: string; url: string }[]
}
const clean = (s: string | null | undefined, max = 300) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const ldSafe = (obj: unknown) => JSON.stringify(obj).replace(/</g, '\\u003c')
class Meta { constructor(private v: string) {} element(e: Element) { e.setAttribute('content', this.v) } }
class Attr { constructor(private a: string, private v: string) {} element(e: Element) { e.setAttribute(this.a, this.v) } }
class TitleEl { constructor(private t: string) {} element(e: Element) { e.setInnerContent(this.t) } }
class HeadInject { constructor(private html: string) {} element(e: Element) { e.append(this.html, { html: true }) } }
function rewriteHtml(res: Response, opts: { title: string; description: string; canonical: string; ogImage?: string; jsonld: unknown[] }): Response {
  const { title, description, canonical, ogImage, jsonld } = opts
  let rw = new HTMLRewriter()
    .on('title', new TitleEl(title))
    .on('meta[name="description"]', new Meta(description))
    .on('link[rel="canonical"]', new Attr('href', canonical))
    .on('meta[property="og:url"]', new Meta(canonical))
    .on('meta[property="og:site_name"]', new Meta('Legit.Show'))
    .on('meta[property="og:title"]', new Meta(title))
    .on('meta[name="twitter:title"]', new Meta(title))
    .on('meta[property="og:description"]', new Meta(description))
    .on('meta[name="twitter:description"]', new Meta(description))
  if (ogImage) {
    rw = rw.on('meta[property="og:image"]', new Meta(ogImage)).on('meta[property="og:image:alt"]', new Meta(title))
      .on('meta[name="twitter:image"]', new Meta(ogImage)).on('meta[name="twitter:image:alt"]', new Meta(title))
  }
  const ld = jsonld.map(o => `<script type="application/ld+json">${ldSafe(o)}</script>`).join('')
  rw = rw.on('head', new HeadInject(ld))
  return rw.transform(res)
}
async function directoryMetaResponse(env: Env, request: Request): Promise<Response | null> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\.html$/, '')
  const isIndex = path === '/' || path === ''
  const isInsights = path === '/insights' || path === '/insights/'
  const m = path.match(/^\/s\/([A-Za-z0-9._-]+)\/?$/)
  const ma = path.match(/^\/alternatives\/([A-Za-z0-9._-]+)\/?$/)
  const isReports = path === '/reports' || path === '/reports/'
  const isMethodology = path === '/methodology' || path === '/methodology/'
  const mr = path.match(/^\/reports\/([A-Za-z0-9._-]+)\/?$/)
  if (!isIndex && !isInsights && !m && !ma && !isReports && !isMethodology && !mr) return null
  const assetRes = await fetch(new URL('/index.html', request.url).toString())
  if (!assetRes.ok) return null

  if (isIndex) {
    const canonical = SITE
    const title = 'Legit.Show — every launched service, tested'
    const description = 'A directory of launched web apps, SaaS, AI tools, MCP servers and developer tools — what each does, who it is for, real ratings, and an objective benchmark.'
    const website = {
      '@context': 'https://schema.org', '@type': 'WebSite', name: 'Legit.Show', url: canonical, description,
      potentialAction: { '@type': 'SearchAction', target: `${SITE}/?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
    }
    const out = rewriteHtml(assetRes, { title, description, canonical, ogImage: `${SITE}/og-image.png`, jsonld: [website] })
    const r = new Response(out.body, out); r.headers.set('x-legit-seo', 'index'); return r
  }
  if (isInsights) {
    const canonical = `${SITE}/insights`
    const title = 'Directory insights — Legit.Show'
    const description = 'Benchmark averages, trust & security posture, and discovery-source breakdown across every tested launched service on Legit.Show.'
    const out = rewriteHtml(assetRes, { title, description, canonical, ogImage: `${SITE}/og-image.png`, jsonld: [{ '@context': 'https://schema.org', '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, isPartOf: { '@type': 'WebSite', name: 'Legit.Show', url: SITE } }] })
    const r = new Response(out.body, out); r.headers.set('x-legit-seo', 'insights'); return r
  }
  if (ma) {
    const aslug = ma[1]
    let subject: Listing | null = null
    try { subject = await getListing(env, aslug) } catch { subject = null }
    if (!subject) { const pt = new Response(assetRes.body, assetRes); pt.headers.set('x-legit-seo', 'miss'); return pt }
    const acat = subject.category || subject.platform || 'service'
    const alts = await getAlternatives(env, subject.category, aslug)
    const canonical = `${SITE}/alternatives/${subject.slug}`
    const names = alts.map(a => a.name)
    const title = `${subject.name} alternatives — ${names.length} tested options compared | Legit.Show`
    const description = clean(names.length
      ? `${names.length} tested ${acat} alternatives to ${subject.name}, compared on the same objective benchmark: ${names.slice(0, 6).join(', ')}.`
      : `Tested ${acat} alternatives to ${subject.name} on Legit.Show.`, 200)
    const graph = { '@context': 'https://schema.org', '@graph': [
      { '@type': 'CollectionPage', '@id': canonical, url: canonical, name: title, description, isPartOf: { '@type': 'WebSite', name: 'Legit.Show', url: SITE } },
      { '@type': 'ItemList', name: `${subject.name} alternatives`, numberOfItems: alts.length,
        itemListElement: alts.map((a, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'SoftwareApplication', name: a.name, url: a.url, applicationCategory: acat } })) },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Legit.Show', item: SITE },
        { '@type': 'ListItem', position: 2, name: acat, item: `${SITE}/?cat=${encodeURIComponent(acat)}` },
        { '@type': 'ListItem', position: 3, name: subject.name, item: `${SITE}/s/${subject.slug}` },
        { '@type': 'ListItem', position: 4, name: 'alternatives', item: canonical },
      ] },
    ] }
    const out = rewriteHtml(assetRes, { title, description, canonical, ogImage: `${SITE}/og-image.png`, jsonld: [graph] })
    const r = new Response(out.body, out); r.headers.set('x-legit-seo', 'alternatives'); r.headers.set('x-legit-slug', subject.slug); return r
  }
  if (isReports) {
    const canonical = `${SITE}/reports`
    const title = 'Reports — Legit.Show'
    const description = "Periodic, reproducible data reports on the production-readiness of launched software — measured by Legit.Show's 7-Frame benchmark, with stated samples and open methodology."
    const out = rewriteHtml(assetRes, { title, description, canonical, ogImage: `${SITE}/og-image.png`, jsonld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': canonical, url: canonical, name: title, description, isPartOf: { '@type': 'WebSite', name: 'Legit.Show', url: SITE } }] })
    const r = new Response(out.body, out); r.headers.set('x-legit-seo', 'reports'); return r
  }
  if (isMethodology) {
    const canonical = `${SITE}/methodology`
    const title = 'Methodology — the 7-Frame benchmark | Legit.Show'
    const description = 'How Legit.Show measures production-readiness: seven frames from the public surface, deeper repository code checks, and the integrity rules behind every published number.'
    const out = rewriteHtml(assetRes, { title, description, canonical, ogImage: `${SITE}/og-image.png`, jsonld: [{ '@context': 'https://schema.org', '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, isPartOf: { '@type': 'WebSite', name: 'Legit.Show', url: SITE } }] })
    const r = new Response(out.body, out); r.headers.set('x-legit-seo', 'methodology'); return r
  }
  if (mr) {
    let rep: ReportRow | null = null
    try { rep = await getReport(env, mr[1]) } catch { rep = null }
    if (!rep) { const pt = new Response(assetRes.body, assetRes); pt.headers.set('x-legit-seo', 'miss'); return pt }
    const canonical = `${SITE}/reports/${rep.slug}`
    const hv = rep.hero_stat ? `${rep.hero_stat.value}% — ${rep.hero_stat.label}. ` : ''
    const title = `${rep.title} | Legit.Show`
    const description = clean(hv + rep.subtitle, 200)
    const dataset = {
      '@context': 'https://schema.org', '@type': 'Dataset', name: rep.title, description: clean(rep.subtitle, 300),
      url: canonical, datePublished: rep.published_at, isAccessibleForFree: true,
      creator: { '@type': 'Organization', name: 'Legit.Show', url: SITE },
      measurementTechnique: 'Legit.Show 7-Frame benchmark (deterministic repository + URL analysis)',
      keywords: ['production readiness', 'AI tools', 'benchmark', rep.coined_term || ''].filter(Boolean),
      variableMeasured: (rep.stats || []).map(s => ({ '@type': 'PropertyValue', name: s.label, value: `${s.fail_pct}%`, description: `n=${s.n}` })),
    }
    const article = {
      '@context': 'https://schema.org', '@type': 'Article', headline: rep.title, description, datePublished: rep.published_at,
      author: { '@type': 'Organization', name: 'Legit.Show' }, publisher: { '@type': 'Organization', name: 'Legit.Show', url: SITE }, mainEntityOfPage: canonical,
    }
    const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Legit.Show', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Reports', item: `${SITE}/reports` },
      { '@type': 'ListItem', position: 3, name: rep.title, item: canonical },
    ] }
    const out = rewriteHtml(assetRes, { title, description, canonical, ogImage: `${SITE}/og-image.png`, jsonld: [dataset, article, breadcrumb] })
    const r = new Response(out.body, out); r.headers.set('x-legit-seo', 'report'); r.headers.set('x-legit-slug', rep.slug); return r
  }
  // listing detail
  const slug = m![1]
  let listing: Listing | null = null
  try { listing = await getListing(env, slug) } catch { listing = null }
  if (!listing) { const pt = new Response(assetRes.body, assetRes); pt.headers.set('x-legit-seo', 'miss'); return pt }
  const stats = await getStats(env, listing.id)
  const cat = listing.category || listing.platform || 'service'
  const canonical = `${SITE}/s/${listing.slug}`
  const blurb = clean(listing.tagline || listing.description, 160)
  const ratingTxt = stats.count > 0 ? `Rated ${stats.avg}★ by ${stats.count}. ` : ''
  const title = `${listing.name} — ${clean(listing.tagline || cat, 60)} | Legit.Show`
  const description = clean(`${blurb}. ${ratingTxt}Features, pricing, reviews and an objective benchmark on Legit.Show.`, 200)
  const ogImage = listing.image_url || listing.icon_url || `${SITE}/og-image.png`
  const app: Record<string, unknown> = {
    '@type': 'SoftwareApplication', '@id': `${canonical}#app`,
    name: listing.name, url: listing.url, applicationCategory: cat,
    operatingSystem: /apps\.apple\.com/.test(listing.url) ? 'iOS' : 'Web',
    description: clean(listing.description || listing.tagline, 280),
  }
  if (ogImage) app.image = ogImage
  if (Array.isArray(listing.features) && listing.features.length) app.featureList = listing.features.slice(0, 12)
  if (stats.count > 0) app.aggregateRating = { '@type': 'AggregateRating', ratingValue: stats.avg, reviewCount: stats.count, bestRating: 5, worstRating: 1 }
  if (!listing.has_pricing && !clean(listing.pricing)) app.offers = { '@type': 'Offer', price: 0, priceCurrency: 'USD' }
  const graph = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, primaryImageOfPage: ogImage, isPartOf: { '@type': 'WebSite', name: 'Legit.Show', url: SITE } },
    app,
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Legit.Show', item: SITE },
      { '@type': 'ListItem', position: 2, name: cat, item: `${SITE}/?cat=${encodeURIComponent(cat)}` },
      { '@type': 'ListItem', position: 3, name: listing.name, item: canonical },
    ] },
  ] }
  const out = rewriteHtml(assetRes, { title, description, canonical, ogImage, jsonld: [graph] })
  const r = new Response(out.body, out); r.headers.set('x-legit-seo', 'listing'); r.headers.set('x-legit-slug', listing.slug); return r
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  // Domain migration → legit.show. Fold the legacy commit.show (+ www) and the
  // www.legit.show host onto the apex legit.show with a 301 (same path/query) so
  // search + answer-engine equity consolidates on one canonical domain. Other
  // hosts (api.commit.show, *.pages.dev preview) are untouched.
  const _u = new URL(ctx.request.url)
  if (_u.hostname === 'commit.show' || _u.hostname === 'www.commit.show' || _u.hostname === 'www.legit.show') {
    return Response.redirect(`https://legit.show${_u.pathname}${_u.search}`, 301)
  }

  // Directory (Legit.Show) routes get server-rendered meta + JSON-LD; every
  // other path falls through to the SPA shell unchanged.
  let response: Response | null = null
  try { response = await directoryMetaResponse(ctx.env, ctx.request) } catch { response = null }
  if (!response) response = await ctx.next()

  // 2026-05-15 · /assets/* miss-as-HTML guard.
  //
  // wrangler.jsonc sets not_found_handling: 'single-page-application'
  // which makes EVERY 404 return index.html with HTTP 200 so React
  // Router deep links work on direct load. The side effect: when an
  // old hashed chunk gets garbage-collected after a deploy, a stale-
  // tab user's lazy import() fetches `/assets/<old-hash>.js` and
  // receives `text/html` + 200. The browser rejects the script as a
  // module (strict MIME check), surfaces "Failed to fetch dynamically
  // imported module · MIME text/html", and worse — caches the 200 HTML
  // for the chunk URL (since /assets/* has immutable cache headers),
  // so the user's tab is permanently broken until they wipe cache.
  //
  // Fix: detect this exact case (path starts with /assets/, response
  // body is HTML) and rewrite it to a clean 404 with no-store. The
  // lazyWithReload helper then catches the chunk-load failure and
  // does its single-shot full reload to pull the new bundle. No more
  // sticky bad responses.
  try {
    const url = new URL(ctx.request.url)
    if (url.pathname.startsWith('/assets/')) {
      const ct = response.headers.get('content-type') ?? ''
      if (ct.toLowerCase().includes('text/html')) {
        return new Response('Asset not found', {
          status:  404,
          headers: {
            'content-type':  'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          },
        })
      }
    }
  } catch {
    // Never break the response on a guard failure · fall through.
  }

  try {
    const ua   = ctx.request.headers.get('user-agent') ?? ''
    const kind = classifyUA(ua)
    if (kind) {
      // AI crawler · log to ai_crawler_hits.
      ctx.waitUntil(logCrawlerHit(ctx.env, ctx.request, response, kind))
    } else {
      // Human visitor · log to visitor_hits (filters applied inside).
      ctx.waitUntil(logVisitorHit(ctx.env, ctx.request, response))
    }
  } catch {
    // Defensive · never throw out of middleware.
  }

  return response
}
