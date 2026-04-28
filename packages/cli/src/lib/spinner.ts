// Spinner — simple progress indicator for long-running CLI ops (the
// preview audit poll, ~60-90s of Claude time). Renders to stderr so
// stdout stays clean for --json / pipe consumers. Animates only when
// stderr is a real TTY; in CI / redirected output we fall back to
// phase-change line prints (one line per ~15s milestone) so logs
// don't drown in spinner frames but still show progress.
//
// Phase heuristic is time-based (server doesn't currently expose
// staged progress over HTTP). The labels approximate what's actually
// happening server-side:
//   0–12 s   fetching repo signals (GitHub API · package.json · paths)
//  12–25 s   probing live URL · Lighthouse · completeness signals
//  25–55 s   running Claude audit · scout brief generation
//  55–90 s   finalizing report
//  90 s+     waiting on retry / Anthropic rate-limit recovery

import { c } from './colors.js'

const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']

interface Phase { until: number; label: string }
const DEFAULT_PHASES: Phase[] = [
  { until: 12,  label: 'fetching repo signals'                },
  { until: 25,  label: 'probing live URL · Lighthouse'        },
  { until: 55,  label: 'running audit · scout brief'          },
  { until: 90,  label: 'finalizing report'                    },
  { until: Infinity, label: 'still cooking · larger repos can take 2–3 min' },
]

export class Spinner {
  private frame = 0
  private startMs = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private label = ''
  private isTty = false
  private active = false
  // Track the last phase index we printed in non-TTY mode so we only
  // emit a new line on phase boundary (not every interval tick).
  private lastNonTtyPhase = -1

  start(label: string): void {
    if (this.active) return
    this.label   = label
    this.startMs = Date.now()
    this.isTty   = !!(process.stderr as { isTTY?: boolean }).isTTY
    this.active  = true
    if (this.isTty) {
      // Hide cursor for cleaner animation. Restored on stop().
      process.stderr.write('\x1b[?25l')
      this.timer = setInterval(() => this.tickTty(), 90)
    } else {
      // Non-TTY: print phase boundaries on a slower pulse so CI logs
      // get a heartbeat without spinner spam.
      this.timer = setInterval(() => this.tickPlain(), 1000)
    }
  }

  /** Update the static label (e.g., switching from 'Auditing X' to
   *  'Polling for snapshot…'). Phase label keeps its own clock. */
  setLabel(label: string): void {
    this.label = label
  }

  private elapsedSec(): number {
    return Math.floor((Date.now() - this.startMs) / 1000)
  }

  private phaseFor(s: number): { idx: number; label: string } {
    for (let i = 0; i < DEFAULT_PHASES.length; i++) {
      if (s < DEFAULT_PHASES[i].until) return { idx: i, label: DEFAULT_PHASES[i].label }
    }
    return { idx: DEFAULT_PHASES.length - 1, label: DEFAULT_PHASES[DEFAULT_PHASES.length - 1].label }
  }

  private tickTty(): void {
    const s   = this.elapsedSec()
    const ph  = this.phaseFor(s)
    const f   = FRAMES[this.frame % FRAMES.length]
    this.frame++
    // \r returns to column 0 · \x1b[K erases to end of line. The trailing
    // erase is needed so a previous longer line doesn't leave a tail.
    const line = `\r  ${c.gold(f)} ${c.cream(this.label)} ${c.muted('·')} ${c.muted(ph.label)} ${c.dim(`${s}s`)}\x1b[K`
    process.stderr.write(line)
  }

  private tickPlain(): void {
    const s  = this.elapsedSec()
    const ph = this.phaseFor(s)
    if (ph.idx !== this.lastNonTtyPhase) {
      this.lastNonTtyPhase = ph.idx
      process.stderr.write(`  · ${ph.label}${s > 0 ? ` (${s}s)` : ''}\n`)
    }
  }

  /** Stop the spinner and (optionally) replace the line with a final
   *  status. Final text is printed without the spinner glyph and ends
   *  with a newline so subsequent output starts on a clean line. */
  stop(finalText?: string): void {
    if (!this.active) return
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.isTty) {
      // Erase line, restore cursor.
      process.stderr.write('\r\x1b[K\x1b[?25h')
    }
    if (finalText) process.stderr.write(`  ${finalText}\n`)
    this.active = false
  }
}

// Module-level helper · ensure we always restore the cursor even if
// the user hits Ctrl+C while the spinner is animating. Idempotent.
let sigintWired = false
function wireSigintCleanup(): void {
  if (sigintWired) return
  sigintWired = true
  process.on('SIGINT', () => {
    process.stderr.write('\r\x1b[K\x1b[?25h')
    process.exit(130)
  })
}
wireSigintCleanup()
