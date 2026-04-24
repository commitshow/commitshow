// badge — dynamic SVG badge for commit.show projects · V1 launch asset
//
// GET /functions/v1/badge?project=<uuid>&style=flat|pill
//
// Returns a shields.io-style SVG badge showing the project's current standing
// on commit.show. Drop into any README to surface the audit score:
//
//   ![commit.show](https://<fn-url>/badge?project=<uuid>)
//
// Data: latest analysis_snapshot score_total + status from projects table.
// No auth required — public project metadata only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

// ── Brand tokens (mirror src/index.css) ─────────────────────
const NAVY_900 = '#060C1A'
const NAVY_800 = '#0F2040'
const GOLD_500 = '#F0C040'
const CREAM    = '#F8F5EE'
const TEAL     = '#00D4AA'   // graduated
const SCARLET  = '#C8102E'   // retry
const MUTED    = '#6B7280'

interface ProjectRow {
  project_name: string
  score_total: number
  status: string
}

function svgResponse(body: string, cacheSeconds: number) {
  return new Response(body, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type':  'image/svg+xml; charset=utf-8',
      // Short cache — scores move during a season. 5 minutes keeps READMEs
      // fresh without hammering the DB from crawler spikes.
      'Cache-Control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
    },
  })
}

function errorBadge(label: string): Response {
  const svg = renderFlatBadge({
    leftText: 'commit.show',
    rightText: label,
    rightBg: MUTED,
  })
  return svgResponse(svg, 60)
}

// Rough text-width approximation for DM Mono at 10px · matches shields.io heuristics.
function approxWidth(text: string, charPx = 7): number {
  // Narrow glyphs (i, l, .) count less; we approximate uniformly for predictability.
  return Math.ceil(text.length * charPx) + 10  // padding
}

function renderFlatBadge({ leftText, rightText, rightBg }: {
  leftText:  string
  rightText: string
  rightBg:   string
}): string {
  const leftW  = approxWidth(leftText)
  const rightW = approxWidth(rightText)
  const totalW = leftW + rightW
  const h = 20

  // Escape text — preserve & < > in the unlikely event a project name contains them.
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}" role="img" aria-label="commit.show: ${esc(rightText)}">
  <title>commit.show: ${esc(rightText)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".12"/>
    <stop offset="1" stop-opacity=".12"/>
  </linearGradient>
  <mask id="m"><rect width="${totalW}" height="${h}" rx="2" fill="#fff"/></mask>
  <g mask="url(#m)">
    <rect width="${leftW}" height="${h}" fill="${NAVY_900}"/>
    <rect x="${leftW}" width="${rightW}" height="${h}" fill="${rightBg}"/>
    <rect width="${totalW}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="${CREAM}" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11">
    <text x="${leftW / 2}" y="14" fill="${NAVY_900}" fill-opacity=".25">${esc(leftText)}</text>
    <text x="${leftW / 2}" y="13" fill="${GOLD_500}">${esc(leftText)}</text>
    <text x="${leftW + rightW / 2}" y="14" fill="${NAVY_900}" fill-opacity=".25">${esc(rightText)}</text>
    <text x="${leftW + rightW / 2}" y="13">${esc(rightText)}</text>
  </g>
</svg>`
}

function renderPillBadge({ projectName, score, status }: {
  projectName: string
  score:       number
  status:      string
}): string {
  // Single-piece pill · brandier · for profile cards / landing embeds.
  const leftText  = 'commit.'
  const midText   = truncate(projectName, 24)
  const rightText = `${score} · ${statusLabel(status)}`
  const rightBg   = statusColor(status)

  const leftW  = approxWidth(leftText, 7)
  const midW   = approxWidth(midText, 7)
  const rightW = approxWidth(rightText, 7)
  const totalW = leftW + midW + rightW
  const h = 24

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}" role="img" aria-label="commit.show ${esc(projectName)}: ${esc(rightText)}">
  <title>commit.show ${esc(projectName)}: ${esc(rightText)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".08"/>
    <stop offset="1" stop-opacity=".12"/>
  </linearGradient>
  <mask id="m"><rect width="${totalW}" height="${h}" rx="2" fill="#fff"/></mask>
  <g mask="url(#m)">
    <rect width="${leftW}" height="${h}" fill="${NAVY_900}"/>
    <rect x="${leftW}" width="${midW}" height="${h}" fill="${NAVY_800}"/>
    <rect x="${leftW + midW}" width="${rightW}" height="${h}" fill="${rightBg}"/>
    <rect width="${totalW}" height="${h}" fill="url(#s)"/>
  </g>
  <g text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="12" font-weight="700">
    <text x="${leftW / 2}" y="16" fill="${GOLD_500}">${esc(leftText)}</text>
  </g>
  <g text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11">
    <text x="${leftW + midW / 2}" y="16" fill="${CREAM}">${esc(midText)}</text>
    <text x="${leftW + midW + rightW / 2}" y="16" fill="${NAVY_900}" font-weight="700">${esc(rightText)}</text>
  </g>
</svg>`
}

function statusColor(status: string): string {
  switch (status) {
    case 'graduated':
    case 'valedictorian':
      return TEAL
    case 'retry':
      return SCARLET
    case 'active':
    default:
      return GOLD_500
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'graduated':     return 'graduated'
    case 'valedictorian': return 'valedictorian'
    case 'retry':         return 'rookie circle'
    case 'active':        return 'in season'
    default:              return status
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'GET') return new Response('GET only', { status: 405, headers: CORS })

  const url = new URL(req.url)
  const projectId = url.searchParams.get('project')
  const style = (url.searchParams.get('style') ?? 'flat') as 'flat' | 'pill'

  if (!projectId) return errorBadge('missing project')

  // UUID sanity — cheap · avoid DB round-trip on obvious garbage
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return errorBadge('invalid id')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data, error } = await supabase
    .from('projects')
    .select('project_name, score_total, status')
    .eq('id', projectId)
    .maybeSingle<ProjectRow>()

  if (error || !data) return errorBadge('not found')

  if (style === 'pill') {
    return svgResponse(
      renderPillBadge({
        projectName: data.project_name,
        score: data.score_total,
        status: data.status,
      }),
      300,
    )
  }

  // flat (default): "commit.show | 82 · graduated"
  const rightText = `${data.score_total} · ${statusLabel(data.status)}`
  const svg = renderFlatBadge({
    leftText:  'commit.show',
    rightText,
    rightBg:   statusColor(data.status),
  })
  return svgResponse(svg, 300)
})
