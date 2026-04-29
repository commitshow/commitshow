import { useEffect, useMemo, useState } from 'react'

// Shared modal shown during analyze-project pipeline runs. Used by both the
// initial submission flow and the in-detail Re-analyze button so the UX is
// identical. Animates the edge sub-phases based on elapsed time since the
// modal opened, and snaps to 100% / closes when the parent signals completion.

export const EDGE_SUB_PHASES: Array<{ label: string; estMs: number }> = [
  { label: 'Pulling your source dossier',                          estMs:  2000 },
  { label: 'Auditing live product performance',                    estMs: 28000 },
  { label: 'Reviewing codebase evidence · tech layers · brief',    estMs:  7000 },
  { label: 'Multi-axis deliberation by the evaluator panel',       estMs: 28000 },
  { label: 'Finalizing grade · sealing evidence snapshot',         estMs:  3000 },
]
export const EDGE_TOTAL_MS = EDGE_SUB_PHASES.reduce((s, p) => s + p.estMs, 0)

export const SUBMIT_OUTER_STEPS = [
  'Filing your audit request',
  'Filing your Build Brief dossier',
  'Convening the audit panel',
  'Issuing your audit snapshot',
]

export type AnalysisVariant = 'initial' | 'reanalyze'

interface Props {
  open:        boolean
  variant:     AnalysisVariant
  /** Optional external signal · when the server returns, parent flips this to
   * snap the bar to 100% before unmounting. */
  completed?:  boolean
  /** Outer-step index for the 4-step Submit flow (ignored in reanalyze). */
  outerStep?:  number
  title?:      string
  subtitle?:   string
}

export function AnalysisProgressModal({
  open, variant, completed = false, outerStep = 2, title, subtitle,
}: Props) {
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState<number>(Date.now())

  useEffect(() => {
    if (!open) { setStartedAt(null); return }
    setStartedAt(Date.now())
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 400)
    return () => window.clearInterval(id)
  }, [open])

  const elapsedMs = startedAt ? now - startedAt : 0
  const progress  = completed
    ? 100
    : Math.min(95, (elapsedMs / EDGE_TOTAL_MS) * 100)

  const activeSub = useMemo(() => {
    if (completed) return EDGE_SUB_PHASES.length - 1
    if (!startedAt) return 0
    let acc = 0
    for (let i = 0; i < EDGE_SUB_PHASES.length; i++) {
      acc += EDGE_SUB_PHASES[i].estMs
      if (elapsedMs < acc) return i
    }
    return EDGE_SUB_PHASES.length - 1
  }, [completed, elapsedMs, startedAt])

  if (!open) return null

  const heading = title ?? (variant === 'initial'
    ? 'Deep multi-axis analysis in progress'
    : 'Re-analyzing · rolling the next audit')
  const sub = subtitle ?? 'Takes 60–120s · don\'t close this tab'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="analysis-progress-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: 'rgba(6,12,26,0.88)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="card-navy w-full max-w-xl p-7 relative"
        style={{
          borderRadius: '2px',
          boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 0 120px rgba(240,192,64,0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-block w-10 h-10 border-2 rounded-full mb-4" style={{
            borderColor: 'rgba(240,192,64,0.2)',
            borderTopColor: 'var(--gold-500)',
            animation: 'spin 0.8s linear infinite',
          }} />
          <div className="font-mono text-xs tracking-widest mb-1" style={{ color: 'var(--gold-500)' }}>
            // {variant === 'initial' ? 'STEP 3 · ANALYZING' : 'RE-ANALYSIS IN PROGRESS'}
          </div>
          <h3 id="analysis-progress-title" className="font-display font-bold text-xl mb-1" style={{ color: 'var(--cream)' }}>
            {heading}
          </h3>
          <p className="font-mono text-xs" style={{ color: 'rgba(248,245,238,0.4)' }}>
            {sub}
          </p>
        </div>

        {/* Outer steps — only for initial submission */}
        {variant === 'initial' && (
          <ul className="mb-5 space-y-1.5">
            {SUBMIT_OUTER_STEPS.map((label, i) => {
              const done = i < outerStep || completed
              const active = i === outerStep && !completed
              return (
                <li key={label} className="font-mono text-[11px] flex items-center gap-2" style={{
                  color: done ? 'rgba(0,212,170,0.7)' : active ? 'var(--gold-500)' : 'rgba(248,245,238,0.3)',
                }}>
                  <span style={{ width: 12, textAlign: 'center' }}>
                    {done ? '✓' : active ? '›' : '·'}
                  </span>
                  <span style={{ textDecoration: done ? 'line-through' : 'none' }}>{label}</span>
                </li>
              )
            })}
          </ul>
        )}

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex justify-between items-baseline mb-1.5 font-mono text-[11px]">
            <span style={{ color: 'rgba(248,245,238,0.5)' }}>Pipeline progress</span>
            <span className="tabular-nums" style={{ color: 'var(--gold-500)' }}>
              {Math.round(progress)}%
              {startedAt ? ` · ${Math.round(elapsedMs / 1000)}s elapsed` : ''}
            </span>
          </div>
          <div className="relative w-full overflow-hidden" style={{
            height: '8px',
            background: 'rgba(15,32,64,0.8)',
            border: '1px solid rgba(240,192,64,0.15)',
            borderRadius: '2px',
          }}>
            <div className="absolute inset-y-0 left-0" style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #1E3A8A 0%, #4338CA 25%, #C026D3 50%, #F0C040 80%, #FFD96B 100%)',
              transition: 'width 400ms cubic-bezier(0.22, 1, 0.36, 1)',
              boxShadow: '0 0 8px rgba(240,192,64,0.35)',
            }} />
            <div className="absolute inset-0 pointer-events-none" style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 2.2s linear infinite',
            }} />
          </div>
        </div>

        {/* Sub-phase list */}
        <ul className="space-y-1.5">
          {EDGE_SUB_PHASES.map((p, idx) => {
            const subDone   = idx < activeSub || (completed && idx < EDGE_SUB_PHASES.length)
            const subActive = idx === activeSub && !completed
            return (
              <li key={p.label} className="flex items-center gap-2 font-mono text-[11px]" style={{
                color: subDone ? 'rgba(0,212,170,0.75)'
                  : subActive ? 'var(--gold-500)'
                  : 'rgba(248,245,238,0.3)',
              }}>
                <span style={{ width: 12, textAlign: 'center' }}>
                  {subDone ? '✓' : subActive ? '›' : '·'}
                </span>
                <span style={{
                  textDecoration: subDone ? 'line-through' : 'none',
                  color: subDone ? 'rgba(248,245,238,0.4)' : 'inherit',
                }}>
                  {p.label}
                </span>
              </li>
            )
          })}
        </ul>

        <p className="font-mono text-[10px] mt-5 text-center" style={{ color: 'rgba(248,245,238,0.3)' }}>
          Closing or reloading the tab will not cancel the analysis — the pipeline runs on the server.
        </p>
      </div>
    </div>
  )
}
