import type { TimelinePoint } from '../lib/projectQueries'

interface Props {
  points: TimelinePoint[]
}

const W = 600
const H = 160
const PAD_X = 32
const PAD_Y = 24

// v1.7 — audition-style round labeling.
// Each snapshot gets a label based on its trigger_type: initial → "Round 1",
// resubmit/weekly → "Round 2/3/..." (incremented per appearance), season_end
// → "Final". Labels appear in the point legend so it reads like a reality-
// show progression rather than a raw time series.
function roundLabels(points: TimelinePoint[]): string[] {
  const out: string[] = []
  let round = 0
  for (const p of points) {
    if (p.trigger_type === 'initial') {
      round = 1
      out.push('Round 1')
    } else if (p.trigger_type === 'season_end') {
      out.push('Final')
    } else {
      round = Math.max(round + 1, 2)
      out.push(`Round ${round}`)
    }
  }
  return out
}

export function ScoreTimeline({ points }: Props) {
  if (points.length === 0) {
    return (
      <div className="card-navy p-5 text-center font-mono text-xs" style={{ borderRadius: '2px', color: 'rgba(248,245,238,0.35)' }}>
        No snapshots yet. Timeline will appear after your first evaluation.
      </div>
    )
  }
  const rounds = roundLabels(points)
  if (points.length === 1) {
    const p = points[0]
    return (
      <div className="card-navy p-5" style={{ borderRadius: '2px' }}>
        <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>// AUDIT TIMELINE · {rounds[0]}</div>
        <div className="font-light text-sm" style={{ color: 'rgba(248,245,238,0.55)' }}>
          First audit locked in — <strong style={{ color: 'var(--cream)' }}>{p.score_total}/100</strong> on{' '}
          {new Date(p.created_at).toLocaleDateString()}. Ship improvements and Re-analyze to see the score climb.
        </div>
      </div>
    )
  }

  const xs = points.map((_, i) => PAD_X + (i / (points.length - 1)) * (W - 2 * PAD_X))
  const maxScore = Math.max(100, ...points.map(p => p.score_total))
  const minScore = Math.min(0,  ...points.map(p => p.score_total))
  const yFor = (s: number) => {
    const t = (s - minScore) / Math.max(1, maxScore - minScore)
    return H - PAD_Y - t * (H - 2 * PAD_Y)
  }

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs[i].toFixed(1)} ${yFor(p.score_total).toFixed(1)}`).join(' ')
  const areaPath = `${path} L ${xs[points.length - 1].toFixed(1)} ${H - PAD_Y} L ${xs[0].toFixed(1)} ${H - PAD_Y} Z`

  // Overall trajectory: from Round 1 to latest — is the project climbing?
  const first = points[0]
  const last  = points[points.length - 1]
  const totalMove = last.score_total - first.score_total

  return (
    <div className="card-navy p-5" style={{ borderRadius: '2px' }}>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
          // AUDIT TIMELINE
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span style={{ color: 'rgba(248,245,238,0.4)' }}>{points.length} rounds</span>
          <span style={{
            color: totalMove > 0 ? '#00D4AA' : totalMove < 0 ? '#F88771' : 'rgba(248,245,238,0.4)',
          }}>
            {totalMove > 0 ? `Round 1 → now: +${totalMove}` : totalMove < 0 ? `Round 1 → now: ${totalMove}` : 'flat'}
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <linearGradient id="tlArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#F0C040" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#F0C040" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gridlines at 25/50/75 */}
        {[25, 50, 75].map(g => (
          <g key={g}>
            <line x1={PAD_X} x2={W - PAD_X} y1={yFor(g)} y2={yFor(g)}
              stroke="rgba(255,255,255,0.06)" strokeDasharray="2 4" />
            <text x={PAD_X - 6} y={yFor(g) + 3} textAnchor="end" fontSize="8" fill="rgba(255,255,255,0.3)" fontFamily="DM Mono, monospace">
              {g}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#tlArea)" />
        <path d={path}     fill="none" stroke="#F0C040" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* Points + round labels */}
        {points.map((p, i) => {
          const isFinal = rounds[i] === 'Final'
          return (
            <g key={p.id}>
              <circle
                cx={xs[i]}
                cy={yFor(p.score_total)}
                r={isFinal ? 5 : 3.5}
                fill={isFinal ? '#00D4AA' : '#F0C040'}
                stroke="#060C1A"
                strokeWidth="1.5"
              />
              <text
                x={xs[i]}
                y={H - 4}
                textAnchor="middle"
                fontSize="9"
                fontFamily="DM Mono, monospace"
                fill={isFinal ? '#00D4AA' : 'rgba(248,245,238,0.4)'}
                style={{ fontWeight: isFinal ? 600 : 400 }}
              >
                {rounds[i]}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[10px]">
        {points.slice(-4).map((p, i) => {
          const label = rounds[rounds.length - Math.min(4, points.length) + i]
          const isFinal = label === 'Final'
          return (
            <div key={p.id} className="px-2 py-1.5" style={{
              background: isFinal ? 'rgba(0,212,170,0.06)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${isFinal ? 'rgba(0,212,170,0.3)' : 'rgba(255,255,255,0.05)'}`,
              borderRadius: '2px',
            }}>
              <div style={{ color: isFinal ? '#00D4AA' : 'rgba(248,245,238,0.5)', fontWeight: isFinal ? 600 : 400 }}>
                {label}
              </div>
              <div className="mt-0.5" style={{ color: 'var(--cream)' }}>{p.score_total}/100</div>
              <div className="mt-0.5" style={{ color: (p.score_total_delta ?? 0) > 0 ? '#00D4AA' : (p.score_total_delta ?? 0) < 0 ? '#C8102E' : 'rgba(248,245,238,0.3)' }}>
                {p.score_total_delta == null ? 'baseline' : p.score_total_delta > 0 ? `+${p.score_total_delta}` : p.score_total_delta}
              </div>
              <div className="mt-0.5 tracking-widest" style={{ color: 'rgba(248,245,238,0.3)', fontSize: '9px' }}>
                {new Date(p.created_at).toLocaleDateString()}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
