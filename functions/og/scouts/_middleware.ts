// /og/scouts/* · per-scout OG card (SVG · spotter variant).
//
// One layout for now — the spotter card · used when an early_spotter
// share goes out. Drives off members + votes aggregates so a card
// for an active scout shows their tier color, total casts, and
// per-tier spotter hit counts.
//
// Layout (1200×630):
//   · Top-left:  commit.show wordmark + 'AUDIT · AUDITION · ENCORE'
//   · Top-right: ★ EARLY SPOTTER badge
//   · Center:    scout display_name (88pt) + Scout tier (Bronze /
//                 Silver / Gold / Platinum · tier-colored)
//   · Mid:       three stat columns · First · Early · Spotter hits
//   · Bottom:    total votes cast · tagline

interface Env {
  SUPABASE_URL?:      string
  SUPABASE_ANON_KEY?: string
}

type ScoutTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum'
const TIER_COLOR: Record<ScoutTier, string> = {
  Bronze:   '#CD7F32',
  Silver:   '#C0C0C0',
  Gold:     '#F0C040',
  Platinum: '#E5E4E2',
}

interface ScoutCard {
  id:           string
  display_name: string
  tier:         ScoutTier
  total_votes:  number
  first_n:      number
  early_n:      number
  spotter_n:    number
}

async function loadScout(env: Env, id: string): Promise<ScoutCard | null> {
  const url     = env.SUPABASE_URL      ?? 'https://tekemubwihsjdzittoqf.supabase.co'
  const anonKey = env.SUPABASE_ANON_KEY ?? ''
  if (!anonKey) return null

  // member core
  const memRes = await fetch(`${url}/rest/v1/members?id=eq.${id}&select=id,display_name,tier`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  })
  if (!memRes.ok) return null
  const memRows = await memRes.json() as Array<{ id: string; display_name: string | null; tier: string | null }>
  if (memRows.length === 0) return null
  const m = memRows[0]

  // votes for spotter aggregates · pull spotter_tier only, count in JS.
  const voteRes = await fetch(`${url}/rest/v1/votes?member_id=eq.${id}&select=spotter_tier`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  })
  const voteRows = voteRes.ok ? await voteRes.json() as Array<{ spotter_tier: string | null }> : []
  const total_votes = voteRows.length
  const first_n     = voteRows.filter(v => v.spotter_tier === 'first').length
  const early_n     = voteRows.filter(v => v.spotter_tier === 'early').length
  const spotter_n   = voteRows.filter(v => v.spotter_tier === 'spotter').length

  return {
    id:           m.id,
    display_name: m.display_name ?? 'Scout',
    tier:         (m.tier as ScoutTier) ?? 'Bronze',
    total_votes,
    first_n,
    early_n,
    spotter_n,
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

function fitName(name: string, maxChars: number): string {
  if (name.length <= maxChars) return name
  return name.slice(0, maxChars - 1) + '…'
}

const BG = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#060C1A"/><stop offset="100%" stop-color="#0F2040"/></linearGradient></defs><rect width="1200" height="630" fill="url(#bg)"/>`
const BRAND_TOP = `<text x="72" y="100" font-family="Playfair Display, Georgia, serif" font-size="32" fill="#F0C040" letter-spacing="-0.5">commit.show</text><text x="72" y="124" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="14" fill="rgba(248,245,238,0.5)" letter-spacing="3">AUDIT · AUDITION · ENCORE</text>`
const FOOTER_RULE = `<line x1="72" y1="556" x2="1128" y2="556" stroke="rgba(240,192,64,0.25)" stroke-width="1"/>`
const FOOTER_TAGLINE = `<text x="1128" y="590" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="20" fill="rgba(248,245,238,0.45)" text-anchor="end">every commit, on stage</text>`

function cardSpotter(s: ScoutCard): string {
  const tierColor = TIER_COLOR[s.tier]
  const name      = escapeXml(fitName(s.display_name, 18))

  // Three-column stat block · centered horizontally. Each column is
  // 280px wide with 40px gutters. Numbers use the tier color when
  // they're > 0; otherwise dim.
  const statColumn = (x: number, n: number, label: string) => `
    <g transform="translate(${x}, 0)">
      <text x="0" y="450" font-family="Playfair Display, Georgia, serif" font-size="84" fill="${n > 0 ? '#F0C040' : 'rgba(248,245,238,0.25)'}" text-anchor="middle">${escapeXml(String(n))}</text>
      <text x="0" y="490" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="14" fill="rgba(248,245,238,0.55)" text-anchor="middle" letter-spacing="3">${escapeXml(label.toUpperCase())}</text>
    </g>`

  return `${BG}${BRAND_TOP}

    <!-- Top-right · early spotter chip -->
    <g transform="translate(870, 64)">
      <rect width="266" height="48" fill="rgba(240,192,64,0.12)" stroke="rgba(240,192,64,0.55)" stroke-width="2" rx="4"/>
      <text x="20" y="32" font-family="Playfair Display, Georgia, serif" font-size="24" fill="#F0C040">★</text>
      <text x="50" y="31" font-family="Playfair Display, Georgia, serif" font-size="20" letter-spacing="3" fill="#F0C040">EARLY SPOTTER</text>
    </g>

    <!-- Scout name + tier -->
    <text x="600" y="280" font-family="Playfair Display, Georgia, serif" font-size="88" fill="#F8F5EE" text-anchor="middle" letter-spacing="-1.5">${name}</text>
    <text x="600" y="335" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="22" fill="${tierColor}" text-anchor="middle" letter-spacing="6">${escapeXml(s.tier.toUpperCase())} SCOUT</text>

    <!-- Stat columns: First / Early / Spotter -->
    ${statColumn(360, s.first_n,   'First Spotter')}
    ${statColumn(600, s.early_n,   'Early')}
    ${statColumn(840, s.spotter_n, 'Spotter')}

    ${FOOTER_RULE}
    <text x="72" y="590" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="20" fill="rgba(248,245,238,0.6)" letter-spacing="4">${escapeXml(`${s.total_votes} FORECAST${s.total_votes === 1 ? '' : 'S'} CAST`)}</text>
    ${FOOTER_TAGLINE}`
}

function svgWrap(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  ${inner}
</svg>`
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url)
  const m   = url.pathname.match(/^\/og\/scouts\/([^\/]+?)(?:\.png|\.svg)?\/?$/)
  if (!m) return ctx.next()
  const id = m[1]
  if (!/^[0-9a-f-]{8,40}$/i.test(id)) {
    return new Response('bad id', { status: 400 })
  }

  const scout = await loadScout(ctx.env, id)
  if (!scout) {
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://commit.show/og-image.png', 'x-cs-og-source': 'fallback-no-scout' },
    })
  }

  // PNG fallback · same reason as project: no edge PNG renderer
  // working yet, so X / Twitter (which insists on raster) gets the
  // static og-image while LinkedIn / Discord / Slack get the SVG.
  if (url.pathname.endsWith('.png')) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: 'https://commit.show/og-image.png',
        'x-cs-og-source':   'fallback-no-png-renderer',
        'x-cs-og-scout-id': scout.id,
      },
    })
  }

  return new Response(svgWrap(cardSpotter(scout)), {
    headers: {
      'Content-Type':     'image/svg+xml; charset=utf-8',
      'Cache-Control':    'public, max-age=300, s-maxage=300',
      'x-cs-og-source':   'svg',
      'x-cs-og-kind':     'spotter',
      'x-cs-og-scout-id': scout.id,
    },
  })
}
