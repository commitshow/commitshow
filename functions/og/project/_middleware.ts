// /og/project/* · per-project OG card (SVG).
//
// Returns a 1200×630 SVG composed from a template literal — no
// satori / resvg / @vercel/og. Two prior attempts to wire those
// libraries broke the Pages Functions bundler (npm install path
// silently failed; CDN URL imports also fell over). Hand-rolled
// SVG keeps the deploy reliable and the surface tiny.
//
// Trade-off: X / Twitter doesn't render SVG og:images in unfurl
// cards (PNG/JPG/WebP only per their docs). Discord, Slack,
// LinkedIn, and Facebook DO render SVG fine. So shares to those
// platforms get the dynamic card; X falls back to the og:title +
// og:description rewrite (which is already per-project) and the
// generic /og-image.png handed back via a 302 fallback below for
// crawlers that hard-require a raster format.
//
// Detection: X's crawler accepts text/html for og:image fetches
// and reads the response body. If we serve image/svg+xml, X's
// metadata parser flags it as invalid and falls back to the
// last valid image — which here is /og-image.png from
// twitter:image:src (kept static). LinkedIn etc. accept SVG.

interface Env {
  SUPABASE_URL?:      string
  SUPABASE_ANON_KEY?: string
}

interface ProjectCard {
  id:           string
  project_name: string
  score:        number | null
  band:         string
  encore_kind:  'production' | 'streak' | 'climb' | 'spotlight' | null
  encore_serial: number | null
}

const ENCORE_LABEL: Record<string, { label: string; symbol: string }> = {
  production: { label: 'Encore',    symbol: '★' },
  streak:     { label: 'Streak',    symbol: '⟳' },
  climb:      { label: 'Climb',     symbol: '↗' },
  spotlight:  { label: 'Spotlight', symbol: '✦' },
}

function bandLabel(score: number | null | undefined): string {
  if (score == null) return 'unrated'
  if (score >= 85) return 'encore'
  if (score >= 70) return 'strong'
  if (score >= 50) return 'building'
  return 'early'
}

async function loadProject(env: Env, id: string): Promise<ProjectCard | null> {
  const url     = env.SUPABASE_URL      ?? 'https://tekemubwihsjdzittoqf.supabase.co'
  const anonKey = env.SUPABASE_ANON_KEY ?? ''
  if (!anonKey) return null

  const cols = 'id,project_name,score_total'
  const projRes = await fetch(`${url}/rest/v1/projects?id=eq.${id}&select=${cols}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  })
  if (!projRes.ok) return null
  const rows = await projRes.json() as Array<{ id: string; project_name: string; score_total: number | null }>
  if (rows.length === 0) return null
  const p = rows[0]

  const encRes = await fetch(`${url}/rest/v1/encores?project_id=eq.${id}&kind=eq.production&select=kind,serial`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  })
  const encs = encRes.ok ? await encRes.json() as Array<{ kind: string; serial: number }> : []
  const enc  = encs[0] ?? null

  return {
    id:            p.id,
    project_name:  p.project_name,
    score:         p.score_total,
    band:          bandLabel(p.score_total),
    encore_kind:   enc ? (enc.kind as ProjectCard['encore_kind']) : null,
    encore_serial: enc?.serial ?? null,
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Truncate so a long project name doesn't overflow. Crude — at the
// fonts in use, ~22 chars fills the 64-pt headline width comfortably.
function fitName(name: string, maxChars = 22): string {
  if (name.length <= maxChars) return name
  return name.slice(0, maxChars - 1) + '…'
}

function renderSVG(p: ProjectCard): string {
  const score    = p.score
  const isEncore = (score ?? 0) >= 85
  const accent   = isEncore ? '#F0C040' : '#60A5FA'

  const projName  = escapeXml(fitName(p.project_name))
  const scoreText = score == null ? '—' : String(score)

  const encoreChip = p.encore_kind ? `
    <g transform="translate(870, 64)">
      <rect width="266" height="48" fill="rgba(240,192,64,0.12)" stroke="rgba(240,192,64,0.55)" stroke-width="2" rx="4" />
      <text x="20" y="32" font-family="Playfair Display, Georgia, serif" font-size="26" fill="#F0C040">${escapeXml(ENCORE_LABEL[p.encore_kind].symbol)}</text>
      <text x="56" y="31" font-family="Playfair Display, Georgia, serif" font-size="22" letter-spacing="2" fill="#F0C040">${escapeXml(`${ENCORE_LABEL[p.encore_kind].label.toUpperCase()}${p.encore_serial != null ? ` #${p.encore_serial}` : ''}`)}</text>
    </g>` : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#060C1A"/>
      <stop offset="100%" stop-color="#0F2040"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Brand · top-left -->
  <text x="72" y="100" font-family="Playfair Display, Georgia, serif" font-size="32" fill="#F0C040" letter-spacing="-0.5">commit.show</text>
  <text x="72" y="124" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="14" fill="rgba(248,245,238,0.5)" letter-spacing="3">AUDIT · AUDITION · ENCORE</text>

  <!-- Encore chip · top-right (only if earned) -->
  ${encoreChip}

  <!-- Headline · center -->
  <text x="72" y="330" font-family="Playfair Display, Georgia, serif" font-size="64" fill="#F8F5EE" letter-spacing="-1">${projName}</text>
  <text x="72" y="510" font-family="Playfair Display, Georgia, serif" font-size="180" fill="${accent}" letter-spacing="-4">${escapeXml(scoreText)}</text>
  <text x="${score == null ? '120' : `${72 + (scoreText.length * 96) + 24}`}" y="510" font-family="Playfair Display, Georgia, serif" font-size="40" fill="rgba(248,245,238,0.4)">/100</text>

  <!-- Footer rule + tag + tagline -->
  <line x1="72" y1="556" x2="1128" y2="556" stroke="rgba(240,192,64,0.25)" stroke-width="1"/>
  <text x="72" y="590" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="20" fill="rgba(248,245,238,0.6)" letter-spacing="4">BAND · ${escapeXml(p.band.toUpperCase())}</text>
  <text x="1128" y="590" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="20" fill="rgba(248,245,238,0.45)" text-anchor="end">every commit, on stage</text>
</svg>`
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url)
  const m   = url.pathname.match(/^\/og\/project\/([^\/]+?)(?:\.png|\.svg)?\/?$/)
  if (!m) return ctx.next()
  const id = m[1]
  if (!/^[0-9a-f-]{8,40}$/i.test(id)) {
    return new Response('bad id', { status: 400 })
  }

  const proj = await loadProject(ctx.env, id)
  if (!proj) {
    // No project = redirect to the static og-image so crawlers don't 404.
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://commit.show/og-image.png', 'x-cs-og-source': 'fallback-no-project' },
    })
  }

  const wantsPng = url.pathname.endsWith('.png')
  if (wantsPng) {
    // X / Twitter requested the .png variant. We can't render PNG at
    // the edge (no working bundler path for satori/resvg yet). Serve
    // the static fallback so unfurl works rather than 4xx.
    return new Response(null, {
      status: 302,
      headers: {
        Location: 'https://commit.show/og-image.png',
        'x-cs-og-source':     'fallback-no-png-renderer',
        'x-cs-og-project-id': proj.id,
      },
    })
  }

  // Default · serve dynamic SVG. Discord / Slack / LinkedIn render
  // these correctly; X's metadata parser will reject and the
  // crawler falls back to twitter:image:src (kept static).
  const svg = renderSVG(proj)
  return new Response(svg, {
    headers: {
      'Content-Type':       'image/svg+xml; charset=utf-8',
      'Cache-Control':      'public, max-age=300, s-maxage=300',
      'x-cs-og-source':     'svg',
      'x-cs-og-project-id': proj.id,
    },
  })
}
