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

export const onRequest: PagesFunction<Env> = async (ctx) => {
  // Always pass through first · anything that fails in classification or
  // logging must never affect the user response.
  const response = await ctx.next()

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
