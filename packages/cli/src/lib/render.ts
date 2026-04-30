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

// 5-row × 5-col ASCII digit set · used for the hero score.
// Hand-rolled (no external font dep) so the bundle stays tiny.
const BIG_DIGITS: Record<string, string[]> = {
  '0': ['█▀▀▀█', '█   █', '█   █', '█   █', '█▄▄▄█'],
  '1': ['  ▄█ ', '   █ ', '   █ ', '   █ ', '  ▄█▄'],
  '2': ['█▀▀▀█', '    █', '█▀▀▀▀', '█    ', '█▄▄▄▄'],
  '3': ['█▀▀▀█', '    █', ' ▀▀▀█', '    █', '█▄▄▄█'],
  '4': ['█   █', '█   █', '█▄▄▄█', '    █', '    █'],
  '5': ['█▀▀▀▀', '█    ', '▀▀▀▀█', '    █', '█▄▄▄█'],
  '6': ['█▀▀▀▀', '█    ', '█▀▀▀█', '█   █', '█▄▄▄█'],
  '7': ['█▀▀▀█', '    █', '   ▄▀', '  ▄▀ ', ' ▄▀  '],
  '8': ['█▀▀▀█', '█   █', '█▀▀▀█', '█   █', '█▄▄▄█'],
  '9': ['█▀▀▀█', '█   █', '█▄▄▄█', '    █', '█▄▄▄█'],
  '/': ['    █', '   ▄▀', '  ▄▀ ', ' ▄▀  ', '█    '],
  ' ': ['     ', '     ', '     ', '     ', '     '],
}

/** Render a string ("68", "100", "82/100") as 5 rows of big ASCII.
 *  Block runes ('█▀▄') render wider than ASCII chars in most monospace
 *  fonts; what looks like 1 col-width is actually closer to 1.2-1.5×.
 *  Earlier 1-space and 2-space gutters left adjacent digits visually
 *  fused. We now use a 4-space gutter — wide enough that '0' next to
 *  '0' reads as TWO digits rather than one wide blob. */
function bigText(text: string): string[] {
  const rows = ['', '', '', '', '']
  const GAP = '    '   // 4-space gutter between glyphs
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const glyph = BIG_DIGITS[ch] ?? BIG_DIGITS[' ']
    for (let r = 0; r < 5; r++) rows[r] += glyph[r] + (i < text.length - 1 ? GAP : '')
  }
  return rows
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

// ── Single source of truth for box drawing ─────────────────────
// Every panel uses 58-char outer width (1 corner + 56 interior + 1 corner)
// so screenshots line up. Helper takes the *visible* length so colored
// content (multiple ANSI spans) renders at the right padding without
// having to strip escape codes at runtime.

const BOX_W      = 58              // outer width including both corners
const INSIDE_W   = BOX_W - 2       // chars between │ and │
const CONTENT_W  = INSIDE_W - 2    // chars between '│ ' and ' │'

const boxTop    = ()    => c.muted('┌' + '─'.repeat(INSIDE_W) + '┐')
const boxBottom = ()    => c.muted('└' + '─'.repeat(INSIDE_W) + '┘')
const boxBlank  = ()    => c.muted('│' + ' '.repeat(INSIDE_W) + '│')

/**
 * Render a content row inside the box with proper padding.
 * @param visibleLen  number of visible chars in `colored` (for padding math)
 * @param colored     the rendered string (may contain ANSI escapes)
 * @param leftMargin  extra spaces inside the box, after the leading `│ `
 */
function boxRow(visibleLen: number, colored: string, leftMargin = 0): string {
  const padding = Math.max(0, CONTENT_W - leftMargin - visibleLen)
  return c.muted('│ ') + ' '.repeat(leftMargin) + colored + ' '.repeat(padding) + c.muted(' │')
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

  // Walk-on vs league. Walk-on = preview status (anonymous CLI · not in
  // a season). For walk-ons, Scout (0/30) and Community (low/20) are
  // structurally absent — not evaluated zeros.
  //
  // We display Claude's calibrated score_total directly for walk-ons. The
  // server prompt (rule 7 in analyze-project) tells Claude to score
  // walk-ons assuming Scout+Comm absent, so score_total IS the walk-on
  // score. This lets ecosystem signals (stars, npm reach), Production
  // Maturity gaps (no tests / no CI), and double-counting safeguards
  // shape the final number — none of which a deterministic /45
  // normalization could capture.
  //
  // The /45 normalization (audit pillar excluding Brief slot) is still
  // computed and exposed in JSON as `walk_on_audit_normalized` for agents
  // that want a deterministic floor, but the user-facing big-digit uses
  // the calibrated total.
  const WALK_ON_AUDIT_MAX = 50
  const isWalkOn   = p.status === 'preview'
  const total = p.score_total ?? 0

  // Header
  const lines: string[] = []
  lines.push(boxTop())
  lines.push(boxRow(
    /* visibleLen */ 'commit.show · Audit report'.length,
    c.bold(c.gold('commit.show')) + c.muted(' · ') + c.cream('Audit report'),
  ))
  lines.push(boxBottom())
  lines.push('')

  // Project title line
  const name = p.project_name ?? 'untitled'
  const slug = p.github_url?.replace(/^https?:\/\//, '') ?? ''
  lines.push('  ' + c.bold(c.cream(name)) + '   ' + c.muted(slug))
  lines.push('')

  // ── 3 strengths + 2 concerns box · errors-first reorder (2026-04-30) ──
  // CONCERNS render before STRENGTHS · the value prop is "what your AI
  // missed", so they lead. Score follows as the receipt below.
  const strengths = asStringArray(snapshot?.rich_analysis?.scout_brief?.strengths, 3)
  const concerns  = asStringArray(snapshot?.rich_analysis?.scout_brief?.weaknesses, 2)
  if (strengths.length > 0 || concerns.length > 0) {
    const bulletWidth = CONTENT_W - 2
    lines.push('  ' + boxTop())
    // Heading row inside the box · "What this build missed" lead.
    if (concerns.length > 0) {
      const heading = 'What this build missed'
      lines.push('  ' + boxRow(heading.length, c.bold(c.scarlet(heading))))
    }
    for (const s of concerns) {
      const txt = truncate(s, bulletWidth)
      lines.push('  ' + boxRow(2 + txt.length, c.scarlet('↓ ') + c.cream(txt)))
    }
    if (strengths.length > 0) {
      if (concerns.length > 0) lines.push('  ' + boxBlank())
      const heading = 'What it got right'
      lines.push('  ' + boxRow(heading.length, c.bold(c.teal(heading))))
    }
    for (const s of strengths) {
      const txt = truncate(s, bulletWidth)
      lines.push('  ' + boxRow(2 + txt.length, c.teal('↑ ') + c.cream(txt)))
    }
    lines.push('  ' + boxBottom())
    lines.push('')
  }

  // Hero score · big-digit ASCII for X-share screenshots.
  // Now positioned AFTER concerns/strengths · the score is the receipt
  // for the findings above, not the lead. Always brand gold for cohesive
  // wordmark + score brand mark.
  const bigRows  = bigText(String(total))
  const bigWidth = bigRows[0].length
  const leftPad  = Math.floor((58 - bigWidth) / 2)
  for (const row of bigRows) {
    lines.push('  ' + ' '.repeat(leftPad) + c.goldDeep(row))
  }
  // Caption · small "/ 100 · band" · band tinted so the signal lives there.
  // Walk-on track gets an extra middle segment + a sub-line surfacing the
  // 95 max so users read the score in the right context (88 walk-on ≠ 88
  // league · perfect walk-on caps at 95 because Scout+Community pillars
  // structurally unevaluated).
  const band     = total >= 75 ? 'strong' : total >= 50 ? 'mid' : 'weak'
  const bandTone = scoreTone(total)
  const captionVisible = isWalkOn
    ? `/ 100 · walk-on · ${band}`
    : `/ 100 · ${band}`
  const capPad   = Math.floor((58 - captionVisible.length) / 2)
  if (isWalkOn) {
    lines.push('  ' + ' '.repeat(capPad)
      + c.muted('/ 100 · ') + c.gold('walk-on') + c.muted(' · ') + bandTone(band))
    // Sub-caption explaining the 5pt headroom · centered, dim
    const subVisible = 'audition unlocks final 5 · max walk-on score 95'
    const subPad     = Math.floor((58 - subVisible.length) / 2)
    lines.push('  ' + ' '.repeat(subPad) + c.muted(subVisible))
  } else {
    lines.push('  ' + ' '.repeat(capPad) + c.muted('/ 100 · ') + bandTone(band))
  }
  lines.push('')

  // Axis bars · league shows all three; walk-on shows Audit only and
  // surfaces Scout + Community as locked-with-unlock-hint rows.
  // Walk-on Audit denominator is 45 (Brief slot excluded) so the math is
  // visibly consistent with the big-digit normalization above.
  const lockedBar     = '─ audition unlocks ─'   // exactly 20 cells · matches scoreBar width
  const auditDen      = isWalkOn ? WALK_ON_AUDIT_MAX : 50
  const auditScoreClamp = Math.min(p.score_auto ?? 0, auditDen)
  const auditLine     = `  Audit  ${pad(`${auditScoreClamp}/${auditDen}`, 7)}  ${scoreBar(auditScoreClamp, auditDen)}`
  lines.push('  ' + auditLine)
  if (isWalkOn) {
    lines.push('  ' + `  Scout  ${pad('—/30', 7)}  ` + c.muted(lockedBar))
    lines.push('  ' + `  Comm.  ${pad('—/20', 7)}  ` + c.muted(lockedBar))
  } else {
    lines.push('  ' + `  Scout  ${pad(`${p.score_forecast}/30`, 7)}  ${scoreBar(p.score_forecast, 30)}`)
    lines.push('  ' + `  Comm.  ${pad(`${p.score_community}/20`, 7)}  ${scoreBar(p.score_community, 20)}`)
  }
  lines.push('')

  // (concerns/strengths block moved above the score · errors-first 2026-04-30)

  // ─── Vibe Coder Checklist · 7-category framework ───
  // Render only the categories that produced an actionable status (fail /
  // warn / pass when meaningful). N/A categories are dropped to keep the
  // terminal output compact. Helps beginners see "the 7 things AI-coded
  // projects miss" framework directly in the report.
  const vc = (snapshot as { github_signals?: { vibe_concerns?: any } } | null)?.github_signals?.vibe_concerns
  if (vc) {
    const items = vibeChecklistLines(vc)
    const actionable = items.filter(i => i.status !== 'na')
    if (actionable.length > 0) {
      lines.push('  ' + boxTop())
      lines.push('  ' + boxRow('Vibe Coder Checklist · 7 things AI-coded projects miss'.length,
        c.bold(c.gold('Vibe Coder Checklist')) + c.muted(' · 7 things AI-coded projects miss')))
      lines.push('  ' + boxBlank())
      for (const it of actionable.slice(0, 7)) {
        const tone = it.status === 'fail' ? c.scarlet : it.status === 'warn' ? c.gold : c.teal
        const dot  = it.status === 'fail' ? '✕' : it.status === 'warn' ? '⚠' : '✓'
        const labelVisible = `${dot} ${it.label}`
        const detailVisible = it.detail
        // First line: dot + label (status colored)
        lines.push('  ' + boxRow(labelVisible.length, tone(`${dot} `) + c.cream(it.label)))
        // Second line: indented detail
        const detailTrunc = truncate(detailVisible, 50)
        lines.push('  ' + boxRow(2 + detailTrunc.length, c.muted('  ') + c.muted(detailTrunc)))
        // Third line: evidence (if any) · only on fail/warn so success cases stay compact
        if (it.evidence && (it.status === 'fail' || it.status === 'warn')) {
          const evTrunc = truncate(it.evidence, 50)
          lines.push('  ' + boxRow(2 + evTrunc.length, c.muted('  → ') + c.muted(evTrunc)))
        }
      }
      lines.push('  ' + boxBottom())
      lines.push('')
    }
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

// ─── Vibe Coder Checklist · 7-category framework ───
type VibeStatus = 'pass' | 'warn' | 'fail' | 'na'
function vibeChecklistLines(vc: any): Array<{ key: string; status: VibeStatus; label: string; detail: string; evidence?: string }> {
  const out: Array<{ key: string; status: VibeStatus; label: string; detail: string; evidence?: string }> = []
  // 1. Webhook idempotency
  {
    const w = vc?.webhook_idempotency
    if (w && w.handlers_seen > 0) {
      const ev = w.sample_files?.[0]
      out.push(w.gap
        ? { key:'webhook', status:'fail', label:'Webhook idempotency', detail:`${w.handlers_seen} handler${w.handlers_seen>1?'s':''} · 0 idempotency-key check found`, evidence: ev }
        : { key:'webhook', status:'pass', label:'Webhook idempotency', detail:`${w.idempotency_signal_seen}/${w.handlers_seen} handler${w.handlers_seen>1?'s':''} dedupe by event id`, evidence: ev })
    } else {
      out.push({ key:'webhook', status:'na', label:'Webhook idempotency', detail:'no webhook handler files detected' })
    }
  }
  // 2. RLS gaps
  {
    const r = vc?.rls_gaps
    if (r && r.tables > 0) {
      const evList: string[] = r.tables_uncovered ?? []
      const ev = evList.length > 0 ? `tables: ${evList.slice(0,3).join(', ')}${evList.length > 3 ? ` +${evList.length-3}` : ''}` : undefined
      if (!r.has_rls_intent) out.push({ key:'rls', status:'fail', label:'RLS coverage', detail:`${r.tables} tables · 0 row-level-security policies`, evidence: ev })
      else if (r.gap_estimate >= 3) out.push({ key:'rls', status:'warn', label:'RLS coverage', detail:`${r.tables} tables · ${r.policies} policies · ${r.gap_estimate} uncovered`, evidence: ev })
      else if (r.gap_estimate > 0) out.push({ key:'rls', status:'warn', label:'RLS coverage', detail:`${r.tables} tables · ${r.policies} policies · ${r.gap_estimate} uncovered`, evidence: ev })
      else out.push({ key:'rls', status:'pass', label:'RLS coverage', detail:`${r.tables} tables · ${r.policies} policies · all covered` })
    } else {
      out.push({ key:'rls', status:'na', label:'RLS coverage', detail:'no SQL migrations detected' })
    }
  }
  // 3. Secret exposure
  {
    const s = vc?.secret_exposure
    if (s && s.total > 0) {
      const first = s.client_violations[0]
      const ev = first ? `${first.file} · ${first.reason ?? first.pattern}` : undefined
      out.push({ key:'secrets', status:'fail', label:'Secret in client code', detail:`${s.total} file${s.total>1?'s':''} · e.g. ${first?.pattern ?? '?'}`, evidence: ev })
    } else {
      out.push({ key:'secrets', status:'pass', label:'Secret in client code', detail:'no service-role keys in client paths' })
    }
  }
  // 4. DB indexes
  {
    const d = vc?.db_indexes
    if (d && d.fk_columns_seen > 0) {
      const sample = d.unindexed_samples?.[0]
      const ev = sample
        ? (sample.references ? `${sample.file} · ${sample.column} → ${sample.references}` : `${sample.file} · ${sample.column}`)
        : undefined
      if (d.gap_estimate >= 3) out.push({ key:'indexes', status:'warn', label:'Database indexes', detail:`${d.fk_columns_seen} FK columns · ${d.indexes_seen} indexes · ${d.gap_estimate} unindexed`, evidence: ev })
      else if (d.gap_estimate > 0) out.push({ key:'indexes', status:'warn', label:'Database indexes', detail:`${d.fk_columns_seen} FK · ${d.indexes_seen} idx · ${d.gap_estimate} unindexed`, evidence: ev })
      else out.push({ key:'indexes', status:'pass', label:'Database indexes', detail:`${d.fk_columns_seen} FK columns · ${d.indexes_seen} indexes · healthy` })
    } else {
      out.push({ key:'indexes', status:'na', label:'Database indexes', detail:'no SQL migrations detected' })
    }
  }
  // 5. Observability
  {
    const o = vc?.observability
    if (o?.detected) out.push({ key:'observability', status:'pass', label:'Error tracking', detail:o.libs.join(' · ') })
    else out.push({ key:'observability', status:'fail', label:'Error tracking', detail:'no sentry / datadog / pino / winston / otel lib in package.json' })
  }
  // 6. Rate limiting
  {
    const r = vc?.rate_limit
    if (r) {
      if (!r.has_api_routes) out.push({ key:'rate_limit', status:'na', label:'API rate limiting', detail:'no API routes detected' })
      else if (r.lib_detected) out.push({ key:'rate_limit', status:'pass', label:'API rate limiting', detail:r.lib_detected })
      else if (r.middleware_detected) out.push({ key:'rate_limit', status:'pass', label:'API rate limiting', detail:'custom middleware detected' })
      else if (r.needs_attention) out.push({ key:'rate_limit', status:'fail', label:'API rate limiting', detail:'API routes · 0 rate-limit lib or middleware' })
    } else {
      out.push({ key:'rate_limit', status:'na', label:'API rate limiting', detail:'unknown' })
    }
  }
  // 7. Prompt injection
  {
    const p = vc?.prompt_injection
    if (!p?.uses_ai_sdk) out.push({ key:'prompt_injection', status:'na', label:'Prompt injection risk', detail:'no AI SDK detected' })
    else if (p.suspicious) out.push({ key:'prompt_injection', status:'warn', label:'Prompt injection risk', detail:`${p.raw_input_to_prompt_files.length} file${p.raw_input_to_prompt_files.length>1?'s':''} pipe user input into prompt` })
    else out.push({ key:'prompt_injection', status:'pass', label:'Prompt injection risk', detail:'AI SDK in use · no obvious raw-input patterns' })
  }
  // Sort fail → warn → pass → na
  const order: Record<VibeStatus, number> = { fail:0, warn:1, pass:2, na:3 }
  return out.sort((a,b) => order[a.status] - order[b.status])
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

  // errors-first markdown order (2026-04-30) · concerns + strengths
  // BEFORE the score so the AI agent reading audit.md picks up the
  // actionable items in its first pass.
  if (concerns.length > 0) {
    lines.push(`## What this build missed`)
    for (const s of concerns) lines.push(`- ${s}`)
    lines.push('')
  }
  if (strengths.length > 0) {
    lines.push(`## What it got right`)
    for (const s of strengths) lines.push(`- ${s}`)
    lines.push('')
  }

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

  lines.push(`---`)
  lines.push(`Audited on commit.show · https://commit.show/projects/${p.id}`)
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
    /** "walk_on" = preview / CLI-only · scored on Audit pillar normalized
     *   to /100. Scout + Community are structurally absent (not zero by
     *   evaluation) so agents should prefer `walk_on_total` for display.
     *  "league" = auditioned project · Audit + Scout + Community sum to
     *   `total`. */
    track:            'walk_on' | 'league'
    /** Raw league total (Audit + Scout + Community + bonuses). Always
     *   present. For walk-ons this is the un-normalized DB value — agents
     *   that want the user-facing walk-on score should use `walk_on_total`. */
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
    /** Pass band on 0-100 scale based on `total`: "strong" ≥75 · "mid" 50-74 · "weak" <50 */
    band: 'strong' | 'mid' | 'weak'
    /** Walk-on score · Claude's calibrated total. Identical to `total`
     *  when track === "walk_on"; null in league mode. */
    walk_on_total:    number | null
    /** Pass band derived from `walk_on_total`. Null in league mode. */
    walk_on_band:     'strong' | 'mid' | 'weak' | null
    /** Deterministic audit-pillar-only normalized score (Brief slot excluded
     *  · base /45). Provided as a sanity-check floor for agents that want
     *  pure algorithmic scoring without Claude's qualitative adjustments.
     *  Null in league mode. */
    walk_on_audit_normalized: number | null
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
  // Walk-on context fields. The user-facing score is Claude's calibrated
  // total (score_total). `walk_on_audit_normalized` is the deterministic
  // pillar-only fallback (Brief slot excluded · base /45).
  const WALK_ON_AUDIT_MAX = 50
  const isWalkOn    = p.status === 'preview'
  const walkOnTotal = isWalkOn ? (p.score_total ?? 0) : null
  const walkOnAuditNormalized = isWalkOn
    ? Math.min(100, Math.round(((p.score_auto ?? 0) / WALK_ON_AUDIT_MAX) * 100))
    : null
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
      track:            isWalkOn ? 'walk_on' : 'league',
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
      walk_on_total:            walkOnTotal,
      walk_on_band:             walkOnTotal != null ? bandFor(walkOnTotal) : null,
      walk_on_audit_normalized: walkOnAuditNormalized,
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

// ── Audit-engine error panel ────────────────────────────────────────
// Rendered when the snapshot exists but rich_analysis.error is set —
// i.e., the Claude call itself failed (quota, rate limit, network). The
// project's auto-50 signals may still be valid; we explain that and tell
// the user when fresh audits will resume.

const AUDIT_ERROR_LABEL: Record<string, string> = {
  anthropic_quota_exceeded: 'Daily audit budget reached',
  anthropic_rate_limited:   'Audit engine rate-limited',
  anthropic_overloaded:     'Audit engine overloaded',
  anthropic_auth_error:     'Audit engine auth issue',
  anthropic_other:          'Audit engine error',
  claude_returned_no_data:  'Audit engine returned no data',
  network_error:            'Audit engine network error',
}

const AUDIT_ERROR_DETAIL: Record<string, string> = {
  anthropic_quota_exceeded:
    "commit.show paused fresh audits until the daily budget refills. " +
    "Cached audits (any repo audited in the last 7 days) still work normally.",
  anthropic_rate_limited:
    "Too many fresh audits in a short window. Wait a minute and retry. " +
    "Cached results stay available.",
  anthropic_overloaded:
    "The audit engine is briefly overloaded. Retry in a minute or two.",
  anthropic_auth_error:
    "commit.show's API key needs attention. Cached results still work.",
  anthropic_other:
    "Something on the audit engine side blocked this run. Try again later.",
  claude_returned_no_data:
    "The audit engine ran but returned an empty response. Try again.",
  network_error:
    "The audit engine couldn't be reached. Check your connection or retry.",
}

export interface AuditErrorInput {
  type:                 string
  message?:             string
  retry_after_seconds?: number | null
  http_status?:         number
}

function untilHuman(seconds: number): string {
  if (seconds < 60)    return `${seconds}s`
  if (seconds < 3600)  return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

export function renderAuditError(err: AuditErrorInput, projectName?: string, projectUrl?: string): string {
  const label  = AUDIT_ERROR_LABEL[err.type]  ?? AUDIT_ERROR_LABEL.anthropic_other
  const detail = AUDIT_ERROR_DETAIL[err.type] ?? AUDIT_ERROR_DETAIL.anthropic_other
  const lines: string[] = []
  const titleVisible = `commit.show · ${label}`

  lines.push('  ' + boxTop())
  lines.push('  ' + boxRow(
    titleVisible.length,
    c.bold(c.gold('commit.show')) + c.muted(' · ') + c.scarlet(label),
  ))
  lines.push('  ' + boxBlank())

  if (projectName) {
    const repoLine = `Repo: ${projectName}`
    lines.push('  ' + boxRow(repoLine.length, c.cream(repoLine)))
    lines.push('  ' + boxBlank())
  }
  for (const w of wrapText(detail, CONTENT_W)) {
    lines.push('  ' + boxRow(w.length, c.cream(w)))
  }
  if (err.retry_after_seconds && err.retry_after_seconds > 0) {
    lines.push('  ' + boxBlank())
    const t = `Retry after ~${untilHuman(err.retry_after_seconds)}`
    lines.push('  ' + boxRow(t.length, c.dim(t)))
  }
  lines.push('  ' + boxBlank())
  const statusLine = `Status check: commitshow status ${projectName ?? '<repo>'}`
  lines.push('  ' + boxRow(Math.min(statusLine.length, CONTENT_W), c.dim(statusLine.slice(0, CONTENT_W))))
  if (projectUrl) {
    const urlMax = CONTENT_W - 'Web view: '.length
    const urlText = projectUrl.length > urlMax ? projectUrl.slice(0, urlMax - 1) + '…' : projectUrl
    lines.push('  ' + boxRow(
      'Web view: '.length + urlText.length,
      c.dim('Web view: ') + c.cream(urlText),
    ))
  }
  lines.push('  ' + boxBottom())
  return lines.join('\n')
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
  const reasonLabel = REASON_LABEL[opts.reason] ?? opts.reason
  const titleVisible = `Rate limit · ${reasonLabel}`

  lines.push('  ' + boxTop())
  lines.push('  ' + boxRow(
    titleVisible.length,
    c.bold(c.scarlet('Rate limit')) + c.muted(' · ') + c.cream(reasonLabel),
  ))
  lines.push('  ' + boxBlank())

  // Count + bar row · "5/5  " (5 chars) + 20-char bar = 25 visible
  const counter = `${opts.count}/${opts.limit}  `
  lines.push('  ' + boxRow(counter.length + 20, c.cream(counter) + bar(opts.count, opts.limit)))

  if (opts.quota) {
    const reset = `resets in ${timeUntil(opts.quota.reset_at)}`
    lines.push('  ' + boxRow(reset.length, c.dim(reset)))
  }

  for (const w of wrapText(opts.message, CONTENT_W)) {
    lines.push('  ' + boxRow(w.length, c.cream(w)))
  }

  if (opts.reason === 'url_cap') {
    const tip = 'Tip: cached audit (< 7d) is free — commitshow status <repo>'
    lines.push('  ' + boxRow(tip.length, c.dim(tip)))
  }
  if (opts.reason === 'ip_cap' && opts.quota?.ip.tier === 'anon') {
    const tip = 'Sign in (commit.show) for a higher daily cap.'
    lines.push('  ' + boxRow(tip.length, c.dim(tip)))
  }
  lines.push('  ' + boxBottom())
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

export function renderUpsell(githubUrl?: string | null): string {
  const lines: string[] = []
  // "Walk-on" — anyone running CLI without auditioning. Theatre-coherent
  // (Audition / Audit / Stage / Backstage / Walk-on) · friendlier than
  // "preview" (which doubles as our DB status) · positions audition as the
  // upgrade path without making the walk-on tier feel lesser.
  //
  // CTA carries the repo URL as a query param so /submit pre-fills the
  // GitHub input — one-click conversion from the terminal to the form.
  // Slug form (github.com/owner/repo) keeps the URL short.
  const repoSlug   = githubUrl ? githubUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : null
  const submitUrl  = repoSlug
    ? `https://commit.show/submit?repo=${encodeURIComponent(repoSlug)}`
    : 'https://commit.show/submit'
  const titleVisible = 'Walk-on · drop-in audit, no audition yet'
  const headVisible  = 'Audition to unlock:'
  const ctaVisible   = `→ ${submitUrl}`

  lines.push('  ' + boxTop())
  lines.push('  ' + boxRow(
    titleVisible.length,
    c.bold(c.gold('Walk-on')) + c.muted(' · ') + c.cream('drop-in audit, no audition yet'),
  ))
  lines.push('  ' + boxBlank())
  lines.push('  ' + boxRow(headVisible.length, c.cream(headVisible)))

  // Backstage = our brand for the prompt-extraction analysis (Phase 2 brief).
  // Lead the unlock list with it because it's the most concrete, immediate
  // payoff on signup: see how the project was built (delegation map, failure
  // log, decision archaeology) and unlock +15-20 audit points typical.
  // Tags are 15-char column-aligned so the · separator lines up vertically.
  // Tags column-padded to 16 chars (1 trailing space guaranteed so the · in
  // `rest` always has a visual gap from the tag, even when the tag fills 15).
  const items: Array<{ tag: string; rest: string; tone: (s: string) => string }> = [
    { tag: 'Backstage       ', rest: '· build process + prompts · +15 pts', tone: c.gold },
    { tag: 'Scout forecasts ', rest: '· human verdicts (30% of score)',     tone: c.teal },
    { tag: 'Season ranking  ', rest: '· top 20% graduate per cycle',        tone: c.teal },
    { tag: 'Hall of Fame    ', rest: '· permanent archive + badge',         tone: c.teal },
    { tag: 'Live applauds   ', rest: '· notifications on reactions',        tone: c.teal },
    { tag: 'Recommit loop   ', rest: '· weekly delta + share card',         tone: c.teal },
  ]
  for (const it of items) {
    const visible = `→ ${it.tag}${it.rest}`
    lines.push('  ' + boxRow(visible.length, it.tone('→ ') + c.cream(it.tag) + c.muted(it.rest)))
  }

  lines.push('  ' + boxBlank())
  lines.push('  ' + boxRow(ctaVisible.length, c.gold(ctaVisible)))
  lines.push('  ' + boxBottom())
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
