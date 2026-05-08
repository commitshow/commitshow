// deep-probe — §15-E.3 Tier B · Playwright-via-Cloudflare Browser Rendering.
//
// Why this exists:
//   Our standard probes (inspectCompleteness · inspectSecurityHeaders ·
//   liveHealth) all use plain `fetch` with browser-like UA. Modern bot
//   protection (Cloudflare bot fight · Akamai · DataDome · PerimeterX)
//   returns 403 to anything that isn't a real Chromium · so audits of
//   claude.ai · vercel.com · etc. fell back to "library slots" with 0/52
//   even when Lighthouse + multi-route probes proved the site was alive.
//
//   This Edge Function calls the CF Browser Rendering REST API which spins
//   up a real headless Chromium on Cloudflare's edge — gets through almost
//   all bot challenges, returns post-hydration DOM, captures meta tags
//   that SPAs inject at runtime (which static `fetch` misses entirely).
//
// Capabilities (vs static fetch):
//   · post-hydration HTML  · React/Next/Vue/Svelte rendered output
//   · hydration markers    · __NEXT_DATA__ · __NUXT__ · __SVELTEKIT_DATA__
//   · runtime meta tags    · OG/twitter cards injected by next-seo · etc.
//   · client-only h1/h2    · SPA route content visible to crawlers
//
// What it does NOT do (V1 limit):
//   · console error capture (CF /content endpoint doesn't expose this)
//   · network failure inventory (would need /scrape with jsEvaluation)
//   · screenshot (separate /screenshot endpoint · added when needed)
//
// Cost: $0.09 / 1k requests on CF (free tier 10/min · generous). Skipped
// gracefully when CF_ACCOUNT_ID + CF_BROWSER_RENDERING_TOKEN aren't set —
// callers get an empty `deep_probe` envelope and downstream code falls
// through to the existing Tier A signals.

// @ts-nocheck — Deno runtime

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

interface DeepProbeResult {
  fetched:                  boolean
  via:                     'cf-browser-rendering' | 'skipped' | 'failed'
  html_length:              number
  post_hydration_text_length: number
  // Hydration framework detection · SPA evidence even when the static
  // shell looks empty. Surfaced to Claude as evidence (not a scoring slot
  // by itself).
  hydration_framework: 'next' | 'nuxt' | 'sveltekit' | 'remix' | 'react' | 'vue' | 'angular' | 'unknown' | null
  hydration_markers_found:  string[]
  // Meta tags recovered post-hydration · these are what real users + AI
  // crawlers actually see. Static-fetch counterparts may miss everything
  // when SPAs inject meta via next-seo / vue-meta / etc.
  meta_tags: {
    has_og_title:     boolean
    has_og_image:     boolean
    has_og_description: boolean
    has_twitter_card: boolean
    has_canonical:    boolean
    has_meta_desc:    boolean
    has_h1:           boolean
    h1_text:          string | null     // first 200 chars of first <h1>
  }
  // Real browser proved the page is reachable (200 + rendered) — used as
  // a strong proof of life when the basic Tier A fetch got bot-blocked.
  proven_reachable:         boolean
  error:                    string | null
}

const BLANK: DeepProbeResult = {
  fetched: false, via: 'skipped',
  html_length: 0, post_hydration_text_length: 0,
  hydration_framework: null, hydration_markers_found: [],
  meta_tags: {
    has_og_title: false, has_og_image: false, has_og_description: false,
    has_twitter_card: false, has_canonical: false, has_meta_desc: false,
    has_h1: false, h1_text: null,
  },
  proven_reachable: false,
  error: null,
}

function detectHydrationFramework(html: string): { framework: DeepProbeResult['hydration_framework']; markers: string[] } {
  const markers: string[] = []
  let framework: DeepProbeResult['hydration_framework'] = null

  if (/__NEXT_DATA__/.test(html))                     { framework ??= 'next';      markers.push('__NEXT_DATA__') }
  if (/window\.__NUXT__/.test(html))                  { framework ??= 'nuxt';      markers.push('__NUXT__') }
  if (/__SVELTEKIT_DATA__/.test(html))                { framework ??= 'sveltekit'; markers.push('__SVELTEKIT_DATA__') }
  if (/__remixContext/.test(html))                    { framework ??= 'remix';     markers.push('__remixContext') }
  if (/data-reactroot|data-react-helmet|__reactRoot/.test(html)) { framework ??= 'react'; markers.push('react-root') }
  if (/data-v-app|<div\s+id=["']app["']>/.test(html) && /Vue\.config|__vue_app__/.test(html)) {
    framework ??= 'vue'; markers.push('vue-app')
  }
  if (/ng-version=/.test(html))                       { framework ??= 'angular';   markers.push('ng-version') }

  return { framework, markers }
}

function extractMetaTags(html: string): DeepProbeResult['meta_tags'] {
  const head = html.slice(0, 200_000)
  const has = (re: RegExp) => re.test(head)

  // First <h1> text · stripped of HTML tags · clamp 200 chars.
  let h1Text: string | null = null
  const h1Match = head.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1Match) {
    const stripped = h1Match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (stripped) h1Text = stripped.slice(0, 200)
  }

  return {
    has_og_title:       has(/<meta\s+(?:[^>]*\s+)?property=["']og:title["']/i),
    has_og_image:       has(/<meta\s+(?:[^>]*\s+)?property=["']og:image["']/i),
    has_og_description: has(/<meta\s+(?:[^>]*\s+)?property=["']og:description["']/i),
    has_twitter_card:   has(/<meta\s+(?:[^>]*\s+)?name=["']twitter:card["']/i),
    has_canonical:      has(/<link\s+(?:[^>]*\s+)?rel=["']canonical["']/i),
    has_meta_desc:      has(/<meta\s+(?:[^>]*\s+)?name=["']description["']/i),
    has_h1:             !!h1Text,
    h1_text:            h1Text,
  }
}

function plainTextLength(html: string): number {
  // Cheap text-only length · strips tags + scripts/styles. Not exact, good
  // enough for the "is there meaningful rendered content" signal.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
  return stripped.trim().length
}

async function callCfBrowserRendering(url: string, accountId: string, token: string): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  // CF Browser Rendering REST · /content returns post-hydration HTML.
  // Default wait is "load" event · sufficient for most SPAs to hydrate.
  // We keep timeout < 25s so the analyze-project parallel block doesn't
  // stall the whole audit if CF is slow.
  try {
    // 14s outer timeout · waitUntil 'load' (faster than networkidle0) +
    // 12s inner gotoOptions timeout. Tight to keep analyze-project under
    // its 150s wall budget when running parallel to Lighthouse + Claude.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 14_000)
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/content`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        url,
        viewport: { width: 1280, height: 800 },
        gotoOptions: { waitUntil: 'load', timeout: 12_000 },
      }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      return { ok: false, error: `cf_${res.status}: ${errBody.slice(0, 200)}` }
    }
    const data = await res.json() as { success?: boolean; result?: string; errors?: Array<{ message?: string }> }
    if (!data.success || typeof data.result !== 'string') {
      const msg = data.errors?.[0]?.message ?? 'cf_invalid_response'
      return { ok: false, error: msg }
    }
    return { ok: true, html: data.result }
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  let body: { url?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (!body.url) return json({ error: 'url required' }, 400)

  // Validate URL shape · refuse internal targets to avoid SSRF.
  let parsed: URL
  try { parsed = new URL(body.url) } catch { return json({ error: 'invalid_url' }, 400) }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return json({ error: 'invalid_protocol' }, 400)
  const host = parsed.host.toLowerCase()
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return json({ error: 'private_host_refused' }, 400)

  const accountId = Deno.env.get('CF_ACCOUNT_ID')
  const cfToken   = Deno.env.get('CF_BROWSER_RENDERING_TOKEN')
  if (!accountId || !cfToken) {
    // Graceful skip · downstream callers (analyze-project) treat empty
    // deep_probe as "Tier B not available" and rely on Tier A signals.
    return json({ ...BLANK, error: 'cf_credentials_missing' })
  }

  const cf = await callCfBrowserRendering(body.url, accountId, cfToken)
  if (!cf.ok) {
    return json({ ...BLANK, via: 'failed', error: cf.error })
  }

  const html = cf.html
  const { framework, markers } = detectHydrationFramework(html)
  const result: DeepProbeResult = {
    fetched:                    true,
    via:                       'cf-browser-rendering',
    html_length:                html.length,
    post_hydration_text_length: plainTextLength(html),
    hydration_framework:        framework,
    hydration_markers_found:    markers,
    meta_tags:                  extractMetaTags(html),
    proven_reachable:           true,
    error:                      null,
  }
  return json(result)
})
