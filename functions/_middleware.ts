// Root Pages Function middleware · AEO crawler detection.
//
// Runs on EVERY request. Sniffs the User-Agent for known AI crawler
// signatures (GPTBot · ClaudeBot · PerplexityBot · Applebot · etc) and
// fires a non-blocking INSERT into ai_crawler_hits via service_role.
// User-facing latency is unchanged · the DB write happens after the
// response goes out via ctx.waitUntil.
//
// Design notes:
//   · We classify by UA kind (one of a small enum) using cheap regex
//     matches · unknown UAs aren't logged.
//   · IP is hashed (djb2) · we only need 'distinct caller' grouping,
//     never the raw IP.
//   · Path is normalized (lower-cased · query stripped · capped 200ch).
//   · Robots.txt / sitemap.xml hits ARE logged · those are part of the
//     crawler journey we want to measure.
//   · _middleware.ts at root delegates to specific route middlewares
//     (functions/projects/_middleware.ts · functions/og/project/_middleware.ts ·
//     functions/robots.txt.ts) by calling next() · order matters · this
//     should never short-circuit.

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

async function logHit(env: Env, req: Request, response: Response, kind: string): Promise<void> {
  const supabaseUrl = env.SUPABASE_URL
  const serviceKey  = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return   // unconfigured · bail silently

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
    // Direct PostgREST insert · fastest path · we don't need a client.
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
  } catch {
    // Never let a logging failure surface to the user · already after waitUntil.
  }
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  // Always pass through first · anything that fails in classification or
  // logging must never affect the user response.
  const response = await ctx.next()

  try {
    const ua   = ctx.request.headers.get('user-agent') ?? ''
    const kind = classifyUA(ua)
    if (kind) {
      // Fire-and-forget · the response has already been computed and
      // streaming back; the DB write happens in the background.
      // ctx.waitUntil keeps the worker alive long enough for the
      // PostgREST POST to land but doesn't block the user.
      ctx.waitUntil(logHit(ctx.env, ctx.request, response, kind))
    }
  } catch {
    // Defensive · never throw out of middleware.
  }

  return response
}
