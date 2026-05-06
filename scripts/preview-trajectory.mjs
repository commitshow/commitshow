#!/usr/bin/env node
// Standalone preview · renders the trajectory OG SVG with mock data
// to /tmp/trajectory-preview.svg without needing a Pages deploy.
//
// Usage:
//   node scripts/preview-trajectory.mjs                   # default mock arc
//   node scripts/preview-trajectory.mjs --scenario flat
//   node scripts/preview-trajectory.mjs --scenario downhill
//   node scripts/preview-trajectory.mjs --scenario quick-spike
//   node scripts/preview-trajectory.mjs --scenario long
//   open /tmp/trajectory-preview.svg                       # open in browser
//
// This file MIRRORS cardTrajectory() from
// functions/og/project/_middleware.ts. Keep them in sync while iterating
// on the design. Once approved we drop this script (or repoint it at the
// deployed endpoint).

import fs from 'node:fs'

// ── Mirrored helpers (must stay in sync with _middleware.ts) ──────
function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
function fitName(name, maxChars) {
  if (name.length <= maxChars) return name
  return name.slice(0, maxChars - 1) + '…'
}
function bandLabel(score) {
  if (score == null) return 'unrated'
  if (score >= 85) return 'encore'
  if (score >= 70) return 'strong'
  if (score >= 50) return 'building'
  return 'early'
}

const BG = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#060C1A"/><stop offset="100%" stop-color="#0F2040"/></linearGradient></defs><rect width="1200" height="630" fill="url(#bg)"/>`
const BRAND_TOP = `<text x="72" y="100" font-family="Playfair Display, Georgia, serif" font-size="32" fill="#F0C040" letter-spacing="-0.5">commit.show</text><text x="72" y="124" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="14" fill="rgba(248,245,238,0.5)" letter-spacing="3">AUDIT · AUDITION · ENCORE</text>`
const FOOTER_RULE = `<line x1="72" y1="556" x2="1128" y2="556" stroke="rgba(240,192,64,0.25)" stroke-width="1"/>`
const FOOTER_TAGLINE = `<text x="1128" y="590" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="20" fill="rgba(248,245,238,0.45)" text-anchor="end">every commit, on stage</text>`

function cardTrajectory(p) {
  const pts = p.trajectory ?? []
  if (pts.length < 2) return `${BG}${BRAND_TOP}<text x="600" y="350" text-anchor="middle" font-family="Playfair Display, Georgia, serif" font-size="40" fill="#F8F5EE">need ≥2 snapshots</text>`

  const projName = escapeXml(fitName(p.project_name, 28))
  const accent   = '#F0C040'

  const chartLeft   = 130
  const chartRight  = 1110
  const chartTop    = 250
  const chartBottom = 510
  const chartW      = chartRight - chartLeft
  const chartH      = chartBottom - chartTop

  const t0 = new Date(pts[0].created_at).getTime()
  const tN = new Date(pts[pts.length - 1].created_at).getTime()
  const tSpan = Math.max(tN - t0, 1)
  const xFor  = (iso, idx) => {
    const t = new Date(iso).getTime()
    if (tN === t0) return chartLeft + (idx / (pts.length - 1)) * chartW
    return chartLeft + ((t - t0) / tSpan) * chartW
  }
  const yFor  = (score) => {
    const clamped = Math.max(0, Math.min(100, score))
    return chartBottom - (clamped / 100) * chartH
  }

  const gridLines = [0, 25, 50, 75, 100].map(v => {
    const y = yFor(v)
    return `<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="3,4"/><text x="${chartLeft - 12}" y="${y + 5}" text-anchor="end" font-family="DM Mono, Menlo, Consolas, monospace" font-size="13" fill="rgba(248,245,238,0.4)">${v}</text>`
  }).join('')
  const encoreLineY = yFor(85)
  const encoreLine  = `<line x1="${chartLeft}" y1="${encoreLineY}" x2="${chartRight}" y2="${encoreLineY}" stroke="rgba(240,192,64,0.32)" stroke-width="1" stroke-dasharray="6,4"/><text x="${chartLeft + 8}" y="${encoreLineY - 6}" font-family="DM Mono, Menlo, Consolas, monospace" font-size="11" fill="rgba(240,192,64,0.75)" letter-spacing="2">85 · ENCORE</text>`

  const linePts = pts.map((pt, i) => `${xFor(pt.created_at, i).toFixed(1)},${yFor(pt.score_total).toFixed(1)}`).join(' ')
  const linePath = `<polyline points="${linePts}" fill="none" stroke="${accent}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`

  const dots = pts.map((pt, i) => {
    const cx = xFor(pt.created_at, i)
    const cy = yFor(pt.score_total)
    const isLast = i === pts.length - 1
    const r      = isLast ? 9 : 6
    const halo   = isLast
      ? `<circle cx="${cx}" cy="${cy}" r="20" fill="${accent}" opacity="0.18"/><circle cx="${cx}" cy="${cy}" r="13" fill="${accent}" opacity="0.28"/>`
      : ''
    const labelY = cy - (isLast ? 22 : 14)
    const labelSize = isLast ? 30 : 16
    const labelWeight = isLast ? '700' : '500'
    const labelFill = isLast ? '#F0C040' : 'rgba(248,245,238,0.85)'
    return `${halo}<circle cx="${cx}" cy="${cy}" r="${r}" fill="${accent}" stroke="#060C1A" stroke-width="2"/><text x="${cx}" y="${labelY}" text-anchor="middle" font-family="DM Mono, Menlo, Consolas, monospace" font-weight="${labelWeight}" font-size="${labelSize}" fill="${labelFill}">${pt.score_total}</text>`
  }).join('')

  const dayLabels = pts.map((pt, i) => {
    const cx = xFor(pt.created_at, i)
    const dayDiff = Math.round((new Date(pt.created_at).getTime() - t0) / 86400000)
    const label = i === 0 ? 'Day 0' : `Day ${dayDiff}`
    return `<text x="${cx}" y="${chartBottom + 28}" text-anchor="middle" font-family="DM Mono, Menlo, Consolas, monospace" font-size="13" fill="rgba(248,245,238,0.55)" letter-spacing="1">${escapeXml(label)}</text>`
  }).join('')

  const startScore  = pts[0].score_total
  const endScore    = pts[pts.length - 1].score_total
  const delta       = endScore - startScore
  const totalDays   = Math.max(0, Math.round((tN - t0) / 86400000))
  const deltaSign   = delta > 0 ? '+' : delta < 0 ? '' : '±'
  const deltaColor  = delta > 0 ? '#3FA874' : delta < 0 ? 'rgba(248,120,113,0.95)' : 'rgba(248,245,238,0.6)'
  const summary     = `${deltaSign}${delta} pts in ${totalDays} day${totalDays === 1 ? '' : 's'}  ·  BAND ${p.band.toUpperCase()}`

  return `${BG}${BRAND_TOP}
    <text x="72" y="200" font-family="Playfair Display, Georgia, serif" font-size="48" fill="#F8F5EE" letter-spacing="-0.5">${projName}</text>
    <text x="72" y="228" font-family="DM Mono, Menlo, Consolas, monospace" font-size="13" fill="rgba(248,245,238,0.5)" letter-spacing="3">AUDITION TRAJECTORY · ${pts.length} SNAPSHOT${pts.length === 1 ? '' : 'S'}</text>
    ${gridLines}
    ${encoreLine}
    ${linePath}
    ${dots}
    ${dayLabels}
    ${FOOTER_RULE}
    <text x="72" y="590" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="22" fill="${deltaColor}" letter-spacing="2">${escapeXml(summary)}</text>
    ${FOOTER_TAGLINE}`
}

function svgWrap(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  ${inner}
</svg>`
}

// ── Mock scenarios ────────────────────────────────────────────────
const SCENARIOS = {
  default: [
    { offsetDays: 0,  score: 47 },
    { offsetDays: 5,  score: 58 },
    { offsetDays: 11, score: 71 },
    { offsetDays: 18, score: 82 },
    { offsetDays: 22, score: 89 },
  ],
  flat: [
    { offsetDays: 0,  score: 64 },
    { offsetDays: 7,  score: 66 },
    { offsetDays: 14, score: 65 },
    { offsetDays: 21, score: 67 },
  ],
  downhill: [
    { offsetDays: 0,  score: 78 },
    { offsetDays: 6,  score: 71 },
    { offsetDays: 13, score: 64 },
    { offsetDays: 20, score: 58 },
  ],
  'quick-spike': [
    { offsetDays: 0,  score: 42 },
    { offsetDays: 1,  score: 91 },
  ],
  long: [
    { offsetDays: 0,  score: 38 },
    { offsetDays: 3,  score: 47 },
    { offsetDays: 6,  score: 55 },
    { offsetDays: 9,  score: 61 },
    { offsetDays: 12, score: 68 },
    { offsetDays: 15, score: 74 },
    { offsetDays: 18, score: 79 },
    { offsetDays: 21, score: 86 },
  ],
}

const scenarioFlag = process.argv.indexOf('--scenario')
const scenarioName = scenarioFlag >= 0 ? process.argv[scenarioFlag + 1] : 'default'
const scenario = SCENARIOS[scenarioName]
if (!scenario) {
  console.error(`unknown scenario: ${scenarioName}\navailable: ${Object.keys(SCENARIOS).join(', ')}`)
  process.exit(1)
}

const t0 = new Date('2026-04-15T09:00:00Z').getTime()
const trajectory = scenario.map(p => ({
  created_at:   new Date(t0 + p.offsetDays * 86400000).toISOString(),
  score_total:  p.score,
  trigger_type: p.offsetDays === 0 ? 'initial' : 'resubmit',
}))

const lastScore = scenario[scenario.length - 1].score
const proj = {
  id:               '00000000-0000-0000-0000-000000000001',
  project_name:     scenarioName === 'long' ? 'supabase-resend-auth' : 'commit-show',
  score:            lastScore,
  score_auto:       Math.min(50, Math.round(lastScore * 0.5)),
  score_forecast:   null,
  score_community:  null,
  status:           'active',
  band:             bandLabel(lastScore),
  encore_kind:      null,
  encore_serial:    null,
  scanned_scope:    null,
  top_concern:      null,
  top_strength:     null,
  trajectory,
}

const svg = svgWrap(cardTrajectory(proj))
const out = '/tmp/trajectory-preview.svg'
fs.writeFileSync(out, svg)
console.log(`wrote ${out}  (scenario=${scenarioName} · ${scenario.length} pts · final=${lastScore})`)
console.log(`open it:   open ${out}`)
