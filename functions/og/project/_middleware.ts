// /og/project/* · per-project OG card (SVG · kind-aware).
//
// Three card variants driven by ?kind= query (default: 'audit'):
//
//   audit     · score takes the spotlight (180pt). Encore chip
//                top-right if earned. Default — used for the audit
//                completion share template.
//   encore    · ★ ENCORE #N centered as the trophy headline,
//                project name as subtitle. Used when a project just
//                earned an Encore (any track) so the share carries
//                the heirloom number visually.
//   milestone · milestone label up top + score on the right + tag
//                at the bottom. Used for the milestone share
//                template (first-top-100, 30-day-streak, etc.).
//
// Why _middleware.ts: the dynamic [param] route silently races with
// the Pages SPA fallback. Middleware always wins.

interface Env {
  SUPABASE_URL?:      string
  SUPABASE_ANON_KEY?: string
}

type CardKind = 'audit' | 'encore' | 'milestone'

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

  // Encore lookup · prefer production track for the headline; fall
  // back to whichever kind exists. Streak / Climb / Spotlight all
  // count as "encore earned" for card purposes.
  const encRes = await fetch(
    `${url}/rest/v1/encores?project_id=eq.${id}&select=kind,serial,earned_at&order=earned_at.asc`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  const encs = encRes.ok ? await encRes.json() as Array<{ kind: string; serial: number }> : []
  const enc = encs.find(e => e.kind === 'production') ?? encs[0] ?? null

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

function fitName(name: string, maxChars: number): string {
  if (name.length <= maxChars) return name
  return name.slice(0, maxChars - 1) + '…'
}

const BG = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#060C1A"/><stop offset="100%" stop-color="#0F2040"/></linearGradient></defs><rect width="1200" height="630" fill="url(#bg)"/>`
const BRAND_TOP = `<text x="72" y="100" font-family="Playfair Display, Georgia, serif" font-size="32" fill="#F0C040" letter-spacing="-0.5">commit.show</text><text x="72" y="124" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="14" fill="rgba(248,245,238,0.5)" letter-spacing="3">AUDIT · AUDITION · ENCORE</text>`
const FOOTER_RULE = `<line x1="72" y1="556" x2="1128" y2="556" stroke="rgba(240,192,64,0.25)" stroke-width="1"/>`
const FOOTER_TAGLINE = `<text x="1128" y="590" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="20" fill="rgba(248,245,238,0.45)" text-anchor="end">every commit, on stage</text>`

// ── Audit card · score-first layout (default).
function cardAudit(p: ProjectCard): string {
  const score    = p.score
  const isEncore = (score ?? 0) >= 85
  const accent   = isEncore ? '#F0C040' : '#60A5FA'
  const projName  = escapeXml(fitName(p.project_name, 22))
  const scoreText = score == null ? '—' : String(score)
  const slashX    = score == null ? 120 : 72 + (scoreText.length * 96) + 24

  const encoreChip = p.encore_kind ? `
    <g transform="translate(870, 64)">
      <rect width="266" height="48" fill="rgba(240,192,64,0.12)" stroke="rgba(240,192,64,0.55)" stroke-width="2" rx="4"/>
      <text x="20" y="32" font-family="Playfair Display, Georgia, serif" font-size="26" fill="#F0C040">${escapeXml(ENCORE_LABEL[p.encore_kind].symbol)}</text>
      <text x="56" y="31" font-family="Playfair Display, Georgia, serif" font-size="22" letter-spacing="2" fill="#F0C040">${escapeXml(`${ENCORE_LABEL[p.encore_kind].label.toUpperCase()}${p.encore_serial != null ? ` #${p.encore_serial}` : ''}`)}</text>
    </g>` : ''

  return `${BG}${BRAND_TOP}${encoreChip}
    <text x="72" y="330" font-family="Playfair Display, Georgia, serif" font-size="64" fill="#F8F5EE" letter-spacing="-1">${projName}</text>
    <text x="72" y="510" font-family="Playfair Display, Georgia, serif" font-size="180" fill="${accent}" letter-spacing="-4">${escapeXml(scoreText)}</text>
    <text x="${slashX}" y="510" font-family="Playfair Display, Georgia, serif" font-size="40" fill="rgba(248,245,238,0.4)">/100</text>
    ${FOOTER_RULE}
    <text x="72" y="590" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="20" fill="rgba(248,245,238,0.6)" letter-spacing="4">BAND · ${escapeXml(p.band.toUpperCase())}</text>
    ${FOOTER_TAGLINE}`
}

// ── Encore card · trophy headline. Only meaningful when an encore
// exists; if not, fall back to audit layout so the URL never 4xx's.
function cardEncore(p: ProjectCard): string {
  if (!p.encore_kind) return cardAudit(p)
  const meta = ENCORE_LABEL[p.encore_kind]
  const projName = escapeXml(fitName(p.project_name, 22))
  const trophyLine = `${meta.symbol} ${meta.label.toUpperCase()}${p.encore_serial != null ? ` #${p.encore_serial}` : ''}`

  return `${BG}${BRAND_TOP}
    <!-- Center trophy -->
    <text x="600" y="360" text-anchor="middle" font-family="Playfair Display, Georgia, serif" font-size="120" fill="#F0C040" letter-spacing="-2">${escapeXml(trophyLine)}</text>
    <text x="600" y="430" text-anchor="middle" font-family="Playfair Display, Georgia, serif" font-size="56" fill="#F8F5EE" letter-spacing="-1">${projName}</text>
    ${p.score != null ? `<text x="600" y="490" text-anchor="middle" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="22" fill="rgba(248,245,238,0.55)" letter-spacing="3">SCORE ${escapeXml(String(p.score))} / 100</text>` : ''}
    ${FOOTER_RULE}
    <text x="72" y="590" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="20" fill="rgba(248,245,238,0.6)" letter-spacing="4">${escapeXml(`${meta.label.toUpperCase()} EARNED · permanent serial`)}</text>
    ${FOOTER_TAGLINE}`
}

// ── Milestone card · label-first. Score recedes to the corner.
function cardMilestone(p: ProjectCard, milestoneLabel: string): string {
  const projName  = escapeXml(fitName(p.project_name, 22))
  const labelText = escapeXml(milestoneLabel.toUpperCase())
  const score     = p.score
  const scoreText = score == null ? '—' : String(score)

  return `${BG}${BRAND_TOP}
    <!-- Milestone tag · top-right small -->
    <text x="1128" y="100" text-anchor="end" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="14" fill="rgba(240,192,64,0.85)" letter-spacing="3">MILESTONE</text>

    <!-- Label is the headline -->
    <text x="72" y="320" font-family="Playfair Display, Georgia, serif" font-size="84" fill="#F0C040" letter-spacing="-1">${labelText}</text>

    <!-- Project name + current score on a smaller secondary line -->
    <text x="72" y="400" font-family="Playfair Display, Georgia, serif" font-size="48" fill="#F8F5EE" letter-spacing="-0.5">${projName}</text>
    <text x="72" y="450" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="22" fill="rgba(248,245,238,0.55)" letter-spacing="3">CURRENT SCORE ${escapeXml(scoreText)} / 100</text>

    ${FOOTER_RULE}
    <text x="72" y="590" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="20" fill="rgba(248,245,238,0.6)" letter-spacing="4">BAND · ${escapeXml(p.band.toUpperCase())}</text>
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
  const m   = url.pathname.match(/^\/og\/project\/([^\/]+?)(?:\.png|\.svg)?\/?$/)
  if (!m) return ctx.next()
  const id = m[1]
  if (!/^[0-9a-f-]{8,40}$/i.test(id)) {
    return new Response('bad id', { status: 400 })
  }

  const proj = await loadProject(ctx.env, id)
  if (!proj) {
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://commit.show/og-image.png', 'x-cs-og-source': 'fallback-no-project' },
    })
  }

  // X / Twitter requests `.png` and rejects SVG-typed images. We
  // can't render PNG at the edge yet, so fall back to the static
  // image — twitter:image stays static in the rewriter for the same
  // reason.
  if (url.pathname.endsWith('.png')) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: 'https://commit.show/og-image.png',
        'x-cs-og-source':     'fallback-no-png-renderer',
        'x-cs-og-project-id': proj.id,
      },
    })
  }

  // Pick the variant. ?kind=encore|milestone, default audit.
  const kindParam = url.searchParams.get('kind') as CardKind | null
  const kind: CardKind = kindParam === 'encore' || kindParam === 'milestone' ? kindParam : 'audit'
  const milestoneLabel = url.searchParams.get('label') ?? ''

  let body: string
  switch (kind) {
    case 'encore':
      body = cardEncore(proj)
      break
    case 'milestone':
      body = cardMilestone(proj, milestoneLabel || 'Milestone reached')
      break
    case 'audit':
    default:
      body = cardAudit(proj)
  }

  return new Response(svgWrap(body), {
    headers: {
      'Content-Type':       'image/svg+xml; charset=utf-8',
      'Cache-Control':      'public, max-age=300, s-maxage=300',
      'x-cs-og-source':     'svg',
      'x-cs-og-kind':       kind,
      'x-cs-og-project-id': proj.id,
    },
  })
}
