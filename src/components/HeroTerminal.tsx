// CliDemoSection — code-rendered live `commitshow audit` terminal. Used
// as a dedicated section below the hero (NOT as a background — earlier
// attempt to layer behind the headline broke ASCII alignment via vignette
// fight; foreground-only is cleaner).
//
// Behavior:
//   - 14-stage state machine cycling every ~12s
//   - Types the `commitshow audit` command, then reveals the audit
//     output stage-by-stage (score → bars → strengths/concerns)
//   - Loops with a soft fade
//   - Honors prefers-reduced-motion (jumps to final state, no looping)
//   - Mobile: font scales down via clamp · ASCII width contained
//
// Renders inline as a centered terminal window with macOS chrome.
// Section wrapper (header + container) is provided by the caller.

import { useEffect, useRef, useState } from 'react'
import { useRecentAudits, type AuditDemo } from '../lib/recentAudits'

// ANSI Shadow figlet font · transcribed via oh-my-logo --filled. Same
// glyphs the CLI renders (commitshow/cli src/lib/render.ts), so a hero-
// page audit visual matches a terminal screenshot pixel-for-pixel.
// Variable-width per glyph (4 to 10 cols), pre-padded so adjacent digits
// concat with a single space.
const BIG_DIGITS: Record<string, string[]> = {
  "0": ["  ██████╗ ", " ██╔═████╗", " ██║██╔██║", " ████╔╝██║", " ╚██████╔╝", "  ╚═════╝ "],
  "1": ["  ██╗", " ███║", " ╚██║", "  ██║", "  ██║", "  ╚═╝"],
  "2": [" ██████╗ ", " ╚════██╗", "  █████╔╝", " ██╔═══╝ ", " ███████╗", " ╚══════╝"],
  "3": [" ██████╗ ", " ╚════██╗", "  █████╔╝", "  ╚═══██╗", " ██████╔╝", " ╚═════╝ "],
  "4": [" ██╗  ██╗", " ██║  ██║", " ███████║", " ╚════██║", "      ██║", "      ╚═╝"],
  "5": [" ███████╗", " ██╔════╝", " ███████╗", " ╚════██║", " ███████║", " ╚══════╝"],
  "6": ["  ██████╗ ", " ██╔════╝ ", " ███████╗ ", " ██╔═══██╗", " ╚██████╔╝", "  ╚═════╝ "],
  "7": [" ███████╗", " ╚════██║", "     ██╔╝", "    ██╔╝ ", "    ██║  ", "    ╚═╝  "],
  "8": ["  █████╗ ", " ██╔══██╗", " ╚█████╔╝", " ██╔══██╗", " ╚█████╔╝", "  ╚════╝ "],
  "9": ["  █████╗ ", " ██╔══██╗", " ╚██████║", "  ╚═══██║", "  █████╔╝", "  ╚════╝ "],
}

const BIG_ROWS = 6

function bigDigits(n: string): string[] {
  const rows = Array.from({ length: BIG_ROWS }, () => "")
  // 0 explicit gutter — each glyph already carries its own leading and
  // trailing whitespace, so concatenating with no extra gap still gives
  // a visible 2-col space. Pixel-grid detour reverted 2026-05-02:
  // the user-referenced look was always the oh-my-logo ANSI Shadow output
  // we transcribed from the start.
  const GAP = ""
  const chars = n.split("")
  for (let i = 0; i < chars.length; i++) {
    const glyph = BIG_DIGITS[chars[i]] ?? BIG_DIGITS["0"]
    for (let r = 0; r < BIG_ROWS; r++) {
      rows[r] += glyph[r] + (i < chars.length - 1 ? GAP : "")
    }
  }
  return rows
}

// One line of terminal output. `pre` colors the line; `cursor` shows a
// blinking caret at the end of the most recent line being typed.
type Line =
  | { kind: 'prompt'; text: string }                // $ command
  | { kind: 'note';   text: string }                // dim status text
  | { kind: 'big';    score: string }               // 5-row ASCII number
  | { kind: 'caption'; pre: string; mid: string; mid_color: string; post: string }
  | { kind: 'bar';    label: string; value: string; bar: string; color: string }
  | { kind: 'lockedBar'; label: string; value: string }
  | { kind: 'arrow';  dir: 'up' | 'down'; text: string }
  | { kind: 'spacer' }

// Hardcoded fallback · used when the live audit pool is empty (cold start /
// API failure / RLS block). Mirrors a real shadcn-ui/ui walk-on result.
const FALLBACK_DEMO: AuditDemo = {
  projectName: 'ui',
  slug:        'shadcn-ui/ui',
  score:       82,
  band:        'strong',
  auditPts:    37,
  strengths:   [
    '90.5% TypeScript with strict mode',
    '7 CI workflows + 79 test files',
    'Lighthouse Accessibility 100, BP 100',
  ],
  concerns:    [
    'Lighthouse perf 56 on docs site',
    'Zero observability libs detected',
  ],
  source:      'platform',
}

// Build the per-cycle line sequence from a live demo. The ASCII `bar`
// uses 20 cells (matches CLI render) so the audit fill ratio (auditPts/45)
// maps cleanly to filled vs empty cells.
function sequenceForDemo(d: AuditDemo): Line[] {
  const FILL_CELLS = 20
  const ratio = Math.max(0, Math.min(1, d.auditPts / 45))
  const filled = Math.round(ratio * FILL_CELLS)
  const bar = '▰'.repeat(filled) + '▱'.repeat(FILL_CELLS - filled)
  // errors-first cycle (2026-04-30 pivot) · concerns lead after the
  // bars, score caption gets a "N concerns" tail so the screenshot
  // pairs the number with the value prop ("82 · 2 to fix"). Strengths
  // come last as the counter-balance.
  const concernCount = d.concerns.length
  const captionPost  = concernCount > 0
    ? ` · ${d.band} · ${concernCount} to fix`
    : ` · ${d.band}`
  return [
    { kind: 'prompt', text: `npx commitshow@latest audit github.com/${d.slug}` },
    { kind: 'spacer' },
    // Canonical brand copy · same line that closes the AnalysisResultCard
    // hero score (AnalysisResultCard.tsx:299). Replaces the earlier
    // "catching what your AI missed" — that read awkward when the demo
    // pool included production OSS like calcom/cal.com (cal.com isn't
    // someone's vibe-coded weekend project, so "your AI" was off).
    { kind: 'note',   text: `It's a snapshot, not a verdict. Code changes; so does this number.` },
    { kind: 'spacer' },
    { kind: 'big',    score: String(d.score) },
    { kind: 'caption', pre: '/ 100 · ', mid: 'walk-on', mid_color: 'var(--gold-500)', post: captionPost },
    { kind: 'spacer' },
    { kind: 'bar',       label: 'Audit', value: `${d.auditPts}/45`, bar, color: '#00D4AA' },
    { kind: 'lockedBar', label: 'Scout', value: '—/30' },
    { kind: 'lockedBar', label: 'Comm.', value: '—/20' },
    { kind: 'spacer' },
    // concerns (↓) lead the bullet section · errors-first.
    ...d.concerns.map((t): Line => ({ kind: 'arrow', dir: 'down', text: t })),
    ...d.strengths.map((t): Line => ({ kind: 'arrow', dir: 'up',   text: t })),
  ]
}

// Stage timeline · ms after cycle start where each line should APPEAR.
// First 7 stages fixed (the "build-up" — prompt typed, then score reveal,
// then bars). Remaining lines (strengths/concerns) interpolate at fixed
// step so demos with 2-vs-3 strengths still feel rhythmic. Tuned so the
// big score lands around 2.7s (early enough to be the hook), and the
// last line reveals before the 4s hold/fade-restart at the end of cycle.
const FIXED_STAGES = [300, 1700, 1750, 2400, 2700, 3100, 3500]
const STAGE_STEP   = 300                     // ms between strength/concern lines

function stagesFor(seq: Line[]): number[] {
  const out = [...FIXED_STAGES.slice(0, Math.min(seq.length, FIXED_STAGES.length))]
  for (let i = FIXED_STAGES.length; i < seq.length; i++) {
    out.push(FIXED_STAGES[FIXED_STAGES.length - 1] + (i - FIXED_STAGES.length + 1) * STAGE_STEP)
  }
  return out
}

const CYCLE_MS  = 12_000   // total before fade-restart
const FADE_MS   = 800      // fade out → in
const TYPING_MS = 1300     // duration of the prompt typing animation

interface Props {
  /** Force final-state render with no animation · for prefers-reduced-motion. */
  reduceMotion?: boolean
}

export function HeroTerminal({ reduceMotion: forceReduce }: Props) {
  const [tick, setTick] = useState(0)            // ms elapsed in current cycle
  const [cycleId, setCycleId] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(forceReduce ?? false)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)

  // Demo pool — live recent audits (≥70 score, ≤7d old). When empty
  // (cold-start / API error / no recent demos), fall back to hardcoded
  // shadcn-ui/ui sample so the section never sits empty.
  const liveDemos = useRecentAudits()
  const pool = liveDemos.length > 0 ? liveDemos : [FALLBACK_DEMO]
  const currentDemo = pool[cycleId % pool.length]
  const sequence = sequenceForDemo(currentDemo)
  const stages   = stagesFor(sequence)

  useEffect(() => {
    if (forceReduce) { setReducedMotion(true); return }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [forceReduce])

  useEffect(() => {
    if (reducedMotion) return
    startRef.current = performance.now()
    const loop = (now: number) => {
      const elapsed = now - startRef.current
      if (elapsed >= CYCLE_MS) {
        // restart cycle · fade is handled in CSS via cycleId key
        startRef.current = now
        setTick(0)
        setCycleId(c => c + 1)
      } else {
        setTick(elapsed)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [reducedMotion])

  // How many lines (and chars within the typing prompt) are visible right now.
  // In reduced-motion mode, everything is at final state.
  const visibleLines = reducedMotion ? sequence.length : stages.filter(t => tick >= t).length
  const promptCharProgress = reducedMotion
    ? 1
    : Math.max(0, Math.min(1, (tick - stages[0]) / TYPING_MS))

  // Cycle fade · briefly drop opacity right before/after restart so the loop
  // doesn't feel jarring. Computed off the same tick.
  const fadeOpacity = reducedMotion ? 1
    : tick > CYCLE_MS - FADE_MS ? Math.max(0.15, 1 - (tick - (CYCLE_MS - FADE_MS)) / FADE_MS)
    : tick < FADE_MS              ? Math.min(1, 0.15 + (tick / FADE_MS) * 0.85)
    : 1

  return (
    <div
      key={cycleId}
      className="font-mono mx-auto"
      style={{
        opacity: fadeOpacity,
        transition: 'opacity 200ms ease-out',
        width: 'min(640px, 100%)',
        fontSize: 'clamp(11px, 1.6vw, 14px)',
        lineHeight: 1.6,
        color: 'rgba(248,245,238,0.85)',
        background: 'rgba(15, 32, 64, 0.5)',
        border: '1px solid rgba(240,192,64,0.15)',
        borderRadius: 4,
        boxShadow: '0 12px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.02)',
        overflow: 'hidden',
      }}
    >
      <TerminalChrome demoSlug={currentDemo.slug} />
      <div className="px-4 md:px-6 py-4 md:py-5" style={{ minHeight: '380px' }}>
        {sequence.slice(0, visibleLines).map((line, i) => (
          <LineRow
            key={i}
            line={line}
            index={i}
            isLastLine={i === visibleLines - 1}
            promptProgress={i === 0 ? promptCharProgress : 1}
            showCursor={!reducedMotion && (
              (i === 0 && promptCharProgress < 1) ||
              (i === visibleLines - 1 && i > 0 && tick < CYCLE_MS - FADE_MS)
            )}
          />
        ))}
      </div>
    </div>
  )
}

function TerminalChrome({ demoSlug }: { demoSlug: string }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-2"
      style={{
        background: 'rgba(15, 32, 64, 0.55)',
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        borderBottom: '1px solid rgba(240,192,64,0.08)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <Dot color="rgba(255,95,86,0.7)" />
      <Dot color="rgba(255,189,46,0.7)" />
      <Dot color="rgba(39,201,63,0.7)" />
      <span
        className="ml-3 tracking-widest truncate"
        style={{ color: 'rgba(248,245,238,0.45)', fontSize: '10px', maxWidth: 'calc(100% - 80px)' }}
      >
        commit.show — auditing {demoSlug}
      </span>
    </div>
  )
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block rounded-full" style={{ width: 9, height: 9, background: color }} />
}

function LineRow({
  line, index, isLastLine, promptProgress, showCursor,
}: {
  line:           Line
  index:          number
  isLastLine:     boolean
  promptProgress: number
  showCursor:     boolean
}) {
  const cursor = showCursor ? <span className="terminal-cursor" aria-hidden="true" /> : null
  const _ = isLastLine // marker so future fade-in-last logic has a hook

  if (line.kind === 'spacer') {
    return <div style={{ height: '0.6em' }} />
  }

  if (line.kind === 'prompt') {
    const visibleChars = Math.floor(line.text.length * promptProgress)
    const shown = line.text.slice(0, visibleChars)
    return (
      <div>
        <span style={{ color: 'rgba(240,192,64,0.7)' }}>$ </span>
        <span style={{ color: 'rgba(248,245,238,0.85)' }}>{shown}</span>
        {cursor}
      </div>
    )
  }

  if (line.kind === 'note') {
    return <div style={{ color: 'rgba(248,245,238,0.45)' }}>{line.text}{cursor}</div>
  }

  if (line.kind === 'big') {
    const rows = bigDigits(line.score)
    // ANSI Shadow rendering · same glyphs the CLI emits (oh-my-logo style).
    // The block-drawing chars (╔═╗║╚╝) only join cleanly at letter-spacing
    // 0 — any positive tracking introduces gaps between segments and the
    // numeral falls apart visually. lineHeight 1 keeps row segments
    // touching so the chunky pixel silhouette holds together.
    // Color: peach pixel-ink to match the CLI hero (CLAUDE Code family).
    return (
      <div className="text-center" style={{ margin: '0.6em 0' }}>
        {rows.map((row, i) => (
          <div
            key={i}
            style={{
              color:         '#F0C040',
              fontFamily:    '"DM Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize:      'clamp(18px, 4.5vw, 26px)',
              lineHeight:    1,
              letterSpacing: 0,
              whiteSpace:    'pre',
              fontWeight:    700,
              fontVariantLigatures: 'none',
            }}
          >
            {row}
          </div>
        ))}
      </div>
    )
  }

  if (line.kind === 'caption') {
    return (
      <div className="text-center" style={{ color: 'rgba(248,245,238,0.6)', marginBottom: '0.4em' }}>
        {line.pre}
        <span style={{ color: line.mid_color }}>{line.mid}</span>
        {line.post}
      </div>
    )
  }

  if (line.kind === 'bar') {
    return (
      <div className="flex items-baseline" style={{ paddingLeft: '2em' }}>
        <span style={{ color: 'rgba(248,245,238,0.7)', minWidth: '5em' }}>{line.label}</span>
        <span style={{ color: 'rgba(248,245,238,0.5)', minWidth: '4.5em' }}>{line.value}</span>
        <span style={{ color: line.color, fontFamily: 'DM Mono, monospace', letterSpacing: '0.04em' }}>{line.bar}</span>
      </div>
    )
  }

  if (line.kind === 'lockedBar') {
    return (
      <div className="flex items-baseline" style={{ paddingLeft: '2em' }}>
        <span style={{ color: 'rgba(248,245,238,0.55)', minWidth: '5em' }}>{line.label}</span>
        <span style={{ color: 'rgba(248,245,238,0.4)', minWidth: '4.5em' }}>{line.value}</span>
        <span style={{ color: 'rgba(248,245,238,0.3)', letterSpacing: '0.04em' }}>─ audit unlocks ─</span>
      </div>
    )
  }

  if (line.kind === 'arrow') {
    const arrowChar = line.dir === 'up' ? '↑' : '↓'
    const arrowColor = line.dir === 'up' ? '#00D4AA' : 'rgba(200,16,46,0.85)'
    return (
      <div style={{ paddingLeft: '2em' }}>
        <span style={{ color: arrowColor, marginRight: '0.5em' }}>{arrowChar}</span>
        <span style={{ color: 'rgba(248,245,238,0.7)' }}>{line.text}</span>
      </div>
    )
  }

  return null
}

// ── Section wrapper · used in LandingPage just below the hero ──
//
// Shows the live audit demo with a small header + CTA hint. Sits in its
// own section (not as hero background) because the ASCII score box reads
// best when it owns the canvas, not when fighting a vignette.
export function CliDemoSection() {
  return (
    <section
      className="relative z-10 px-4 md:px-6 py-16 md:py-20"
      style={{ borderTop: '1px solid rgba(240,192,64,0.08)' }}
    >
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8 md:mb-10">
          <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
            // LIVE FROM YOUR TERMINAL
          </div>
          <h2 className="font-display font-black text-2xl sm:text-3xl md:text-4xl mb-3" style={{ color: 'var(--cream)', lineHeight: 1.15 }}>
            One command. Real audit
          </h2>
          <p className="font-light max-w-md mx-auto text-sm md:text-base" style={{ color: 'rgba(248,245,238,0.55)' }}>
            <span className="font-mono" style={{ color: 'var(--gold-500)' }}>npx commitshow@latest audit</span>
            {' '}on any GitHub repo. Score in 60 seconds.
          </p>
        </div>
        <HeroTerminal />
      </div>
    </section>
  )
}
