// Terminal render — the canonical output spec from CLAUDE.md §15-C.2.
//
// Two output modes:
//   · Pretty (default) — fixed-width 58-col terminal screenshot layout with
//     ANSI colors, brand palette, strengths/concerns box. Human target.
//   · JSON (`--json`) — stable machine-readable shape with `schema_version`.
//     Agent target: Claude Code, AutoGPT, n8n, Zapier, GitHub Actions, etc.
//     The JSON shape is the universal contract — no SDK or MCP needed to
//     integrate. Agent workflow: shell out to commitshow, pipe to jq, act.
//
// Both modes share:
//   · 3 strengths + 2 concerns asymmetry (§15-C.2 content contract)
//   · self-delta only (no peer-vs-peer drama in V0.1)
//   · `.commitshow/audit.{md,json}` side-effect for AI re-read loop

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { c, scoreTone, deltaTone } from './colors.js'
import type { ProjectRow, SnapshotRow, StandingRow, ScoutBriefItem } from './api.js'

export interface AuditView {
  project:  ProjectRow
  snapshot: SnapshotRow | null
  standing: StandingRow | null
}

const BAR_WIDTH = 20

/** Single filled/empty bar for a 0..max score. */
function scoreBar(value: number, max: number): string {
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((value / max) * BAR_WIDTH)))
  const empty  = BAR_WIDTH - filled
  const tone   = scoreTone(Math.round((value / max) * 100))
  return tone('▰'.repeat(filled)) + c.muted('▱'.repeat(empty))
}

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length)
}

function centerPad(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, w)
  const total = w - s.length
  const left  = Math.floor(total / 2)
  return ' '.repeat(left) + s + ' '.repeat(total - left)
}

/** Strip ANSI for width math on colored strings. */
function visibleLength(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

function asStringArray(raw: unknown, take: number): string[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, take).map(row => {
    if (typeof row === 'string') return row
    if (row && typeof row === 'object') {
      const r = row as Record<string, unknown>
      return String(r.bullet ?? r.finding ?? r.text ?? r.summary ?? r.title ?? '')
    }
    return ''
  }).filter(Boolean)
}

export function renderAudit(view: AuditView): string {
  const { project: p, snapshot, standing } = view
  const total = p.score_total ?? 0

  // Header
  const bar = '─'.repeat(58)
  const lines: string[] = []
  lines.push(c.muted('┌' + bar + '┐'))
  lines.push(c.muted('│ ') + c.bold(c.gold('commit.show')) + c.muted(' · ') + c.cream('Audit report') + ' '.repeat(58 - 29) + c.muted('│'))
  lines.push(c.muted('└' + bar + '┘'))
  lines.push('')

  // Project title line
  const name = p.project_name ?? 'untitled'
  const slug = p.github_url?.replace(/^https?:\/\//, '') ?? ''
  lines.push('  ' + c.bold(c.cream(name)) + '   ' + c.muted(slug))
  lines.push('')

  // Hero score card
  const scoreText = `${total} / 100`
  const scoreTinted = scoreTone(total)(scoreText)
  const cardW = 14
  lines.push('  ' + ' '.repeat(20) + c.muted('╔' + '═'.repeat(cardW) + '╗'))
  lines.push('  ' + ' '.repeat(20) + c.muted('║') + centerPadAnsi(scoreTinted, cardW) + c.muted('║'))
  lines.push('  ' + ' '.repeat(20) + c.muted('╚' + '═'.repeat(cardW) + '╝'))
  lines.push('')

  // 3-axis bars
  const auditLine     = `  Audit  ${pad(`${p.score_auto}/50`, 7)}  ${scoreBar(p.score_auto, 50)}`
  const scoutLine     = `  Scout  ${pad(`${p.score_forecast}/30`, 7)}  ${scoreBar(p.score_forecast, 30)}`
  const communityLine = `  Comm.  ${pad(`${p.score_community}/20`, 7)}  ${scoreBar(p.score_community, 20)}`
  lines.push('  ' + auditLine)
  lines.push('  ' + scoutLine)
  lines.push('  ' + communityLine)
  lines.push('')

  // 3 strengths + 2 concerns from scout_brief · §15-C.2 content contract.
  // Web surfaces the full 5+3; the CLI keeps it tight for terminal screenshots.
  const strengths = asStringArray(snapshot?.rich_analysis?.scout_brief?.strengths, 3)
  const concerns  = asStringArray(snapshot?.rich_analysis?.scout_brief?.weaknesses, 2)
  if (strengths.length > 0 || concerns.length > 0) {
    lines.push('  ' + c.muted('┌' + '─'.repeat(56) + '┐'))
    for (const s of strengths) {
      lines.push('  ' + c.muted('│ ') + c.teal('↑ ') + truncate(s, 52) + fill(s, 52) + c.muted(' │'))
    }
    for (const s of concerns) {
      lines.push('  ' + c.muted('│ ') + c.scarlet('↓ ') + truncate(s, 52) + fill(s, 52) + c.muted(' │'))
    }
    lines.push('  ' + c.muted('└' + '─'.repeat(56) + '┘'))
    lines.push('')
  }

  // Standings + delta
  if (standing) {
    const rank = `#${standing.rank} of ${standing.total_in_season}`
    const tier = standing.projected_tier ?? '—'
    const pct  = `(top ${Math.max(1, Math.round(standing.percentile))}%)`
    lines.push('  ' + c.muted('Ranked   ') + c.cream(pad(rank, 12)) + c.muted(`  season`))
    lines.push('  ' + c.muted('Tier     ') + c.gold(pad(tier, 12)) + c.muted(`  ${pct}`))
  }
  if (snapshot?.score_total_delta != null && snapshot.score_total_delta !== 0) {
    const d = snapshot.score_total_delta
    const sign = d > 0 ? '+' : ''
    lines.push('  ' + c.muted('Δ        ') + deltaTone(d)(pad(`${sign}${d}`, 12)) + c.muted(`  since last audit`))
  }
  lines.push('')

  // Footer URLs
  const url = `https://commit.show/projects/${p.id}`
  lines.push('  ' + c.muted('→ ') + c.cream(url))
  const footerPad = Math.max(0, 58 - 'commit.show'.length - 2)
  lines.push(' '.repeat(footerPad) + c.gold('commit.show'))

  return lines.join('\n')
}

function truncate(s: string, w: number): string {
  const vl = s.length
  if (vl <= w) return s
  return s.slice(0, w - 1) + '…'
}

function fill(s: string, w: number): string {
  return ' '.repeat(Math.max(0, w - Math.min(w, s.length)))
}

function centerPadAnsi(s: string, w: number): string {
  const vl = visibleLength(s).length
  if (vl >= w) return s
  const total = w - vl
  const left  = Math.floor(total / 2)
  return ' '.repeat(left) + s + ' '.repeat(total - left)
}

// ─────────── Markdown sibling for .commitshow/audit.md ───────────

export function renderMarkdown(view: AuditView): string {
  const { project: p, snapshot, standing } = view
  const strengths = asStringArray(snapshot?.rich_analysis?.scout_brief?.strengths, 3)
  const concerns  = asStringArray(snapshot?.rich_analysis?.scout_brief?.weaknesses, 2)
  const delta = snapshot?.score_total_delta

  const lines: string[] = []
  lines.push(`# commit.show · Audit report`)
  lines.push('')
  lines.push(`**${p.project_name}**`)
  if (p.github_url) lines.push(`_${p.github_url}_`)
  lines.push('')
  lines.push(`## Score · ${p.score_total} / 100`)
  lines.push('')
  lines.push(`- Audit:      ${p.score_auto}/50`)
  lines.push(`- Scout:      ${p.score_forecast}/30`)
  lines.push(`- Community:  ${p.score_community}/20`)
  if (delta != null && delta !== 0) {
    lines.push(`- **Δ ${delta > 0 ? '+' : ''}${delta}** since last audit`)
  }
  if (standing) {
    lines.push(`- Ranked #${standing.rank} of ${standing.total_in_season} — projected **${standing.projected_tier ?? '—'}** (top ${Math.round(standing.percentile)}%)`)
  }
  lines.push('')
  if (strengths.length > 0) {
    lines.push(`## Strengths`)
    for (const s of strengths) lines.push(`- ${s}`)
    lines.push('')
  }
  if (concerns.length > 0) {
    lines.push(`## Concerns`)
    for (const s of concerns) lines.push(`- ${s}`)
    lines.push('')
  }
  lines.push(`---`)
  lines.push(`Auditioned on commit.show · https://commit.show/projects/${p.id}`)
  lines.push('')
  return lines.join('\n')
}

/** Persist markdown side-effect to .commitshow/audit.md in the target dir. */
export function writeAuditMarkdown(dir: string | undefined, md: string): string | null {
  if (!dir) return null
  try {
    const cshow = join(dir, '.commitshow')
    if (!existsSync(cshow)) mkdirSync(cshow, { recursive: true })
    const path = join(cshow, 'audit.md')
    writeFileSync(path, md, 'utf8')
    return path
  } catch {
    return null
  }
}

// ─────────── Agent-facing JSON shape ───────────
//
// STABILITY NOTE: this shape is the public contract agents parse. Any
// breaking change bumps `schema_version`. Additive fields don't bump.

export interface AgentJsonShape {
  schema_version: '1'
  generated_at:   string
  project: {
    id:           string
    name:         string
    github_url:   string | null
    live_url:     string | null
    status:       string
    creator: {
      name:  string | null
      grade: string | null
    }
    url: string
  }
  score: {
    total:            number
    total_max:        100
    audit:            number
    audit_max:        50
    scout:            number
    scout_max:        30
    community:        number
    community_max:    20
    /** +/- since parent snapshot, null if first audit or no change tracked. */
    delta_since_last: number | null
    /** Pass band on 0-100 scale: "strong" ≥75 · "mid" 50-74 · "weak" <50 */
    band: 'strong' | 'mid' | 'weak'
  }
  standing: {
    rank:             number
    total_in_season:  number
    percentile:       number
    projected_tier:   string | null
    live_url_ok:      boolean | null
    snapshots_ok:     boolean | null
    brief_ok:         boolean | null
  } | null
  strengths: Array<{ axis: string | null; bullet: string }>
  concerns:  Array<{ axis: string | null; bullet: string }>
  snapshot: {
    id:           string
    created_at:   string
    trigger_type: string
  } | null
}

function bandFor(score: number): 'strong' | 'mid' | 'weak' {
  if (score >= 75) return 'strong'
  if (score >= 50) return 'mid'
  return 'weak'
}

function asObjectArray(raw: unknown, take: number): Array<{ axis: string | null; bullet: string }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ axis: string | null; bullet: string }> = []
  for (const row of raw.slice(0, take)) {
    if (typeof row === 'string' && row.trim().length > 0) {
      out.push({ axis: null, bullet: row })
    } else if (row && typeof row === 'object') {
      const r = row as ScoutBriefItem & Record<string, unknown>
      const bullet = String(r.bullet ?? r.finding ?? r.text ?? r.summary ?? r.title ?? '').trim()
      if (bullet) out.push({ axis: r.axis ?? null, bullet })
    }
  }
  return out
}

export function toAgentShape(view: AuditView): AgentJsonShape {
  const { project: p, snapshot, standing } = view
  return {
    schema_version: '1',
    generated_at:   new Date().toISOString(),
    project: {
      id:         p.id,
      name:       p.project_name,
      github_url: p.github_url,
      live_url:   p.live_url,
      status:     p.status,
      creator: { name: p.creator_name, grade: p.creator_grade },
      url:        `https://commit.show/projects/${p.id}`,
    },
    score: {
      total:            p.score_total,
      total_max:        100,
      audit:            p.score_auto,
      audit_max:        50,
      scout:            p.score_forecast,
      scout_max:        30,
      community:        p.score_community,
      community_max:    20,
      delta_since_last: snapshot?.score_total_delta ?? null,
      band:             bandFor(p.score_total),
    },
    standing: standing
      ? {
          rank:            standing.rank,
          total_in_season: standing.total_in_season,
          percentile:      standing.percentile,
          projected_tier:  standing.projected_tier,
          live_url_ok:     (standing as unknown as { live_url_ok?: boolean }).live_url_ok ?? null,
          snapshots_ok:    (standing as unknown as { snapshots_ok?: boolean }).snapshots_ok ?? null,
          brief_ok:        (standing as unknown as { brief_ok?: boolean }).brief_ok ?? null,
        }
      : null,
    strengths: asObjectArray(snapshot?.rich_analysis?.scout_brief?.strengths, 3),
    concerns:  asObjectArray(snapshot?.rich_analysis?.scout_brief?.weaknesses, 2),
    snapshot: snapshot
      ? { id: snapshot.id, created_at: snapshot.created_at, trigger_type: snapshot.trigger_type }
      : null,
  }
}

export function renderJson(view: AuditView): string {
  return JSON.stringify(toAgentShape(view), null, 2)
}

// ── Upsell panel (CLI-only · appended to preview audits) ─────────────
// Shown after a preview audit render so Creator sees what a real audition
// unlocks. Intentionally NOT shown for registered projects — they already
// have access to everything listed here.

// ── Quota footer (success path) ────────────────────────────────
// Compact one-liner shown after a successful audit so users see how many
// audits they have left today and when the bucket resets.

export interface QuotaTierInput { count: number; limit: number; remaining: number }
export interface QuotaInput {
  reset_at: string
  ip:     QuotaTierInput & { tier: 'anon' | 'authed' }
  url:    QuotaTierInput
  global: QuotaTierInput
}

function timeUntil(isoTarget: string): string {
  const ms = Math.max(0, new Date(isoTarget).getTime() - Date.now())
  const h  = Math.floor(ms / 3_600_000)
  const m  = Math.floor((ms % 3_600_000) / 60_000)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h >  0) return `${h}h ${m}m`
  return `${m}m`
}

export function renderQuotaFooter(q: QuotaInput): string {
  // Pick the tier closest to its cap so the user sees the most relevant pressure.
  const tiers = [
    { name: 'IP',     count: q.ip.count,     limit: q.ip.limit,     remaining: q.ip.remaining },
    { name: 'repo',   count: q.url.count,    limit: q.url.limit,    remaining: q.url.remaining },
    { name: 'global', count: q.global.count, limit: q.global.limit, remaining: q.global.remaining },
  ]
  const tightest = tiers.slice().sort((a, b) => a.remaining - b.remaining)[0]
  const tone =
    tightest.remaining === 0 ? c.scarlet :
    tightest.remaining <= 1 ? c.gold    :
    c.muted

  const reset = timeUntil(q.reset_at)
  const ipPart   = `IP ${q.ip.remaining}/${q.ip.limit}`
  const urlPart  = `repo ${q.url.remaining}/${q.url.limit}`
  return '  ' + c.muted('quota: ') +
    tone(ipPart) + c.muted(' · ') +
    tone(urlPart) + c.muted(' · ') +
    c.dim(`resets in ${reset}`)
}

// ── Rate-limit panel (deny path) ────────────────────────────────
// Replaces the bare error line. Shows which tier was hit, count vs cap,
// time until reset, and what to do next.

const REASON_LABEL: Record<string, string> = {
  ip_cap:     'Daily limit hit · per IP',
  url_cap:    'This repo audited too many times today',
  global_cap: 'commit.show daily audit cap reached',
}

function bar(filled: number, total: number, width = 20): string {
  const f = Math.max(0, Math.min(width, Math.round((filled / Math.max(1, total)) * width)))
  return c.scarlet('▰'.repeat(f)) + c.muted('▱'.repeat(width - f))
}

export function renderRateLimitDeny(opts: {
  reason:  'ip_cap' | 'url_cap' | 'global_cap'
  message: string
  limit:   number
  count:   number
  quota?:  QuotaInput
}): string {
  const lines: string[] = []
  const horiz = '─'.repeat(58)
  lines.push('  ' + c.muted('┌' + horiz + '┐'))
  lines.push('  ' + c.muted('│ ') + c.bold(c.scarlet('Rate limit')) + c.muted(' · ') + c.cream(REASON_LABEL[opts.reason] ?? opts.reason) + ' '.repeat(Math.max(0, 58 - 14 - (REASON_LABEL[opts.reason]?.length ?? opts.reason.length))) + c.muted('│'))
  lines.push('  ' + c.muted('│' + ' '.repeat(58) + '│'))
  lines.push('  ' + c.muted('│ ') + c.cream(`${opts.count}/${opts.limit}  `) + bar(opts.count, opts.limit) + ' '.repeat(58 - 28) + c.muted('│'))
  if (opts.quota) {
    const reset = timeUntil(opts.quota.reset_at)
    lines.push('  ' + c.muted('│ ') + c.dim(`resets in ${reset}`) + ' '.repeat(58 - 12 - reset.length - 9 - 2) + c.muted('│'))
  }
  // Wrap the message into ~54-char lines.
  for (const w of wrapText(opts.message, 54)) {
    lines.push('  ' + c.muted('│ ') + c.cream(w) + ' '.repeat(56 - w.length) + c.muted('│'))
  }
  if (opts.reason === 'url_cap') {
    lines.push('  ' + c.muted('│ ') + c.dim('Tip: cached audit (< 7d) is free — `commitshow status <repo>`.') + c.muted(' │'))
  }
  if (opts.reason === 'ip_cap' && opts.quota?.ip.tier === 'anon') {
    lines.push('  ' + c.muted('│ ') + c.dim('Sign in (commit.show) for a higher daily cap.') + ' '.repeat(58 - 49) + c.muted('│'))
  }
  lines.push('  ' + c.muted('└' + horiz + '┘'))
  return lines.join('\n')
}

function wrapText(s: string, width: number): string[] {
  const words = s.split(/\s+/)
  const out: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      if (line) out.push(line.trim())
      line = w
    } else {
      line += ' ' + w
    }
  }
  if (line.trim()) out.push(line.trim())
  return out
}

export function renderUpsell(): string {
  const lines: string[] = []
  const bar = '─'.repeat(58)
  lines.push('  ' + c.muted('┌' + bar + '┐'))
  lines.push('  ' + c.muted('│ ') + c.bold(c.gold('Preview')) + c.muted(' · ') + c.cream('not entered in the season') + ' '.repeat(58 - 35) + c.muted('│'))
  lines.push('  ' + c.muted('│' + ' '.repeat(58) + '│'))
  lines.push('  ' + c.muted('│ ') + c.cream('Audition to unlock:') + ' '.repeat(58 - 20) + c.muted('│'))
  const items = [
    'Scout forecasts · human verdicts (30% of score)',
    'Season ranking  · top 20% graduate each 3-week cycle',
    'Hall of Fame    · permanent archive + public badge',
    'Live applauds   · notifications when reviewers react',
    'Recommit loop   · weekly delta + trajectory share card',
  ]
  for (const it of items) {
    lines.push('  ' + c.muted('│ ') + c.teal('→ ') + c.cream(pad(it, 54)) + c.muted('│'))
  }
  lines.push('  ' + c.muted('│' + ' '.repeat(58) + '│'))
  lines.push('  ' + c.muted('│ ') + c.gold('→ https://commit.show/submit') + ' '.repeat(58 - 30) + c.muted('│'))
  lines.push('  ' + c.muted('└' + bar + '┘'))
  return lines.join('\n')
}

export function writeAuditJson(dir: string | undefined, json: string): string | null {
  if (!dir) return null
  try {
    const cshow = join(dir, '.commitshow')
    if (!existsSync(cshow)) mkdirSync(cshow, { recursive: true })
    const path = join(cshow, 'audit.json')
    writeFileSync(path, json, 'utf8')
    return path
  } catch {
    return null
  }
}
