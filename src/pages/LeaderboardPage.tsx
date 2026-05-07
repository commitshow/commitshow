// Leaderboard map · 2D scatter of active projects (§16.2 P6).
//
// X axis · score_auto (0-50)   → the Audit layer (the engine)
// Y axis · score_forecast (0-30) → the Scout layer (people)
//
// Dots cluster top-right when both layers like a project. Bottom-left is
// where the Rookie Circle lives. The diagonals tell you who's strong on
// one layer but not the other.
//
// One dot = one project. Hover to reveal name + score; click → detail page.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, type Project } from '../lib/supabase'

type ProjectDotRaw = Pick<Project, 'id' | 'project_name' | 'score_auto' | 'score_forecast' | 'score_total' | 'status'>
type ProjectDot = ProjectDotRaw & { cx: number; cy: number }

const PAD_TOP = 32
const PAD_BOTTOM = 48
const PAD_LEFT = 56
const PAD_RIGHT = 32
const VIEW_W = 880
const VIEW_H = 560

// Axis ranges
const X_MAX = 50  // Audit
const Y_MAX = 30  // Scout

// Graduation cut approximation: top-right quadrant is where winners cluster.
const AUDIT_EXCELLENT = 35   // §6.1 Audit 35+ is solid technical
const SCOUT_EXCELLENT = 21   // 70% of scout axis

export function LeaderboardPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ProjectDotRaw[]>([])
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState<ProjectDot | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, project_name, score_auto, score_forecast, score_total, status')
        .in('status', ['active', 'graduated', 'valedictorian', 'retry'])
      setRows((data ?? []) as ProjectDotRaw[])
      setLoading(false)
    })()
  }, [])

  const dots = useMemo<ProjectDot[]>(
    () => rows.map(p => {
      const x = Math.max(0, Math.min(1, (p.score_auto ?? 0)     / X_MAX))
      const y = Math.max(0, Math.min(1, (p.score_forecast ?? 0) / Y_MAX))
      return {
        ...p,
        cx: PAD_LEFT + x * (VIEW_W - PAD_LEFT - PAD_RIGHT),
        // Y flipped — SVG y grows downward but we want upward = better Scout
        cy: PAD_TOP  + (1 - y) * (VIEW_H - PAD_TOP - PAD_BOTTOM),
      }
    }),
    [rows],
  )

  // Quadrant breakdown · "5 in graduation zone, 23 in rookie circle" gives
  // a one-glance snapshot of the league's overall shape. Cuts at the same
  // excellence thresholds as the dashed crosshair so the visual and the
  // numeric strip agree.
  const quadrants = useMemo(() => {
    let graduationZone = 0   // top-right
    let auditOnly      = 0   // bottom-right (engine likes it · scouts cool)
    let scoutOnly      = 0   // top-left    (scouts believe · engine concerns)
    let rookieCircle   = 0   // bottom-left
    rows.forEach(p => {
      const a = p.score_auto     ?? 0
      const s = p.score_forecast ?? 0
      const auditHigh = a >= AUDIT_EXCELLENT
      const scoutHigh = s >= SCOUT_EXCELLENT
      if (auditHigh && scoutHigh) graduationZone++
      else if (auditHigh)         auditOnly++
      else if (scoutHigh)         scoutOnly++
      else                        rookieCircle++
    })
    return { graduationZone, auditOnly, scoutOnly, rookieCircle, total: rows.length }
  }, [rows])

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* ── Header ── */}
        <header className="mb-6">
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="mb-3 font-mono text-xs tracking-wide"
            style={{ background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer', padding: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
          >
            ← BACK TO PROJECTS
          </button>
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // LEADERBOARD MAP
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl mb-2" style={{ color: 'var(--cream)' }}>
            Audit × Scout · who's where
          </h1>
          <p className="font-light max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
            Each dot is one project. Right means the engine likes your technical work.
            Up means Scouts are betting on your finish. Top-right is Encore territory.
          </p>
        </header>

        {/* ── Chart ── */}
        <div
          className="card-navy overflow-hidden"
          style={{ borderRadius: '2px', padding: 4 }}
        >
          <div className="relative">
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ width: '100%', height: 'auto', display: 'block' }}
              role="img"
              aria-label="2D scatter of audit score versus scout score"
            >
              {/* Axes frame */}
              <rect
                x={PAD_LEFT} y={PAD_TOP}
                width={VIEW_W - PAD_LEFT - PAD_RIGHT}
                height={VIEW_H - PAD_TOP - PAD_BOTTOM}
                fill="rgba(255,255,255,0.015)"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={1}
              />

              {/* Excellence thresholds · crosshair on the winners quadrant */}
              <line
                x1={PAD_LEFT + (AUDIT_EXCELLENT / X_MAX) * (VIEW_W - PAD_LEFT - PAD_RIGHT)}
                y1={PAD_TOP}
                x2={PAD_LEFT + (AUDIT_EXCELLENT / X_MAX) * (VIEW_W - PAD_LEFT - PAD_RIGHT)}
                y2={VIEW_H - PAD_BOTTOM}
                stroke="rgba(240,192,64,0.2)"
                strokeDasharray="4 4"
              />
              <line
                x1={PAD_LEFT}
                y1={PAD_TOP + (1 - SCOUT_EXCELLENT / Y_MAX) * (VIEW_H - PAD_TOP - PAD_BOTTOM)}
                x2={VIEW_W - PAD_RIGHT}
                y2={PAD_TOP + (1 - SCOUT_EXCELLENT / Y_MAX) * (VIEW_H - PAD_TOP - PAD_BOTTOM)}
                stroke="rgba(240,192,64,0.2)"
                strokeDasharray="4 4"
              />

              {/* Quadrant labels */}
              <text x={VIEW_W - PAD_RIGHT - 8} y={PAD_TOP + 16}
                textAnchor="end" fontFamily="DM Mono, monospace" fontSize={10}
                fill="rgba(240,192,64,0.65)">
                ENCORE ZONE
              </text>
              <text x={PAD_LEFT + 8} y={VIEW_H - PAD_BOTTOM - 8}
                textAnchor="start" fontFamily="DM Mono, monospace" fontSize={10}
                fill="rgba(248,245,238,0.25)">
                ROOKIE CIRCLE
              </text>

              {/* X axis label + ticks */}
              <text
                x={PAD_LEFT + (VIEW_W - PAD_LEFT - PAD_RIGHT) / 2}
                y={VIEW_H - 12}
                textAnchor="middle"
                fontFamily="DM Mono, monospace"
                fontSize={11}
                fill="var(--text-secondary)"
              >
                AUDIT SCORE (0 – {X_MAX})
              </text>
              {[0, X_MAX / 2, X_MAX].map(v => {
                const x = PAD_LEFT + (v / X_MAX) * (VIEW_W - PAD_LEFT - PAD_RIGHT)
                return (
                  <g key={`tx-${v}`}>
                    <line x1={x} y1={VIEW_H - PAD_BOTTOM} x2={x} y2={VIEW_H - PAD_BOTTOM + 4}
                      stroke="rgba(255,255,255,0.25)" />
                    <text x={x} y={VIEW_H - PAD_BOTTOM + 16} textAnchor="middle"
                      fontFamily="DM Mono, monospace" fontSize={10}
                      fill="var(--text-muted)">{v}</text>
                  </g>
                )
              })}

              {/* Y axis label + ticks */}
              <text
                transform={`rotate(-90, 16, ${PAD_TOP + (VIEW_H - PAD_TOP - PAD_BOTTOM) / 2})`}
                x={16}
                y={PAD_TOP + (VIEW_H - PAD_TOP - PAD_BOTTOM) / 2}
                textAnchor="middle"
                fontFamily="DM Mono, monospace"
                fontSize={11}
                fill="var(--text-secondary)"
              >
                SCOUT SCORE (0 – {Y_MAX})
              </text>
              {[0, Y_MAX / 2, Y_MAX].map(v => {
                const y = PAD_TOP + (1 - v / Y_MAX) * (VIEW_H - PAD_TOP - PAD_BOTTOM)
                return (
                  <g key={`ty-${v}`}>
                    <line x1={PAD_LEFT - 4} y1={y} x2={PAD_LEFT} y2={y}
                      stroke="rgba(255,255,255,0.25)" />
                    <text x={PAD_LEFT - 8} y={y + 3} textAnchor="end"
                      fontFamily="DM Mono, monospace" fontSize={10}
                      fill="var(--text-muted)">{v}</text>
                  </g>
                )
              })}

              {/* Dots */}
              {!loading && dots.map(d => {
                const tone = toneFor(d)
                return (
                  <circle
                    key={d.id}
                    cx={d.cx}
                    cy={d.cy}
                    r={7}
                    fill={tone}
                    fillOpacity={0.8}
                    stroke={tone}
                    strokeWidth={1}
                    style={{ cursor: 'pointer', transition: 'r 120ms' }}
                    onMouseEnter={() => setHover(d)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => navigate(`/projects/${d.id}`)}
                  />
                )
              })}

              {/* Loading state — soft dot pulse */}
              {loading && (
                <text
                  x={VIEW_W / 2} y={VIEW_H / 2}
                  textAnchor="middle"
                  fontFamily="DM Mono, monospace"
                  fontSize={12}
                  fill="var(--text-muted)"
                >
                  Loading audit × scout map…
                </text>
              )}
              {!loading && dots.length === 0 && (
                <text
                  x={VIEW_W / 2} y={VIEW_H / 2}
                  textAnchor="middle"
                  fontFamily="DM Mono, monospace"
                  fontSize={12}
                  fill="var(--text-muted)"
                >
                  No projects in the league yet.
                </text>
              )}
            </svg>

            {/* Hover tooltip · absolutely positioned above the scatter */}
            {hover && (
              <div
                className="absolute pointer-events-none px-3 py-2 font-mono text-[11px]"
                style={{
                  left: `${(hover.cx / VIEW_W) * 100}%`,
                  top:  `${(hover.cy / VIEW_H) * 100}%`,
                  transform: 'translate(-50%, calc(-100% - 14px))',
                  background: 'rgba(6,12,26,0.95)',
                  border: '1px solid rgba(240,192,64,0.4)',
                  borderRadius: '2px',
                  color: 'var(--cream)',
                  whiteSpace: 'nowrap',
                }}
              >
                <div className="font-display font-bold text-sm mb-0.5">{hover.project_name}</div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  audit <span style={{ color: 'var(--cream)' }}>{hover.score_auto ?? 0}</span>
                  {' · '}
                  scout <span style={{ color: 'var(--cream)' }}>{hover.score_forecast ?? 0}</span>
                  {' · '}
                  total <span style={{ color: 'var(--gold-500)' }}>{hover.score_total ?? 0}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Cross-link · the token leaderboard sits next to this map.
            Same headline (who's standing where) but the axis is token spend
            instead of audit-vs-scout. Surfaced as a peer link, not a tab,
            so the URL state stays clean. */}
        <div className="mt-3 flex items-center gap-2 font-mono text-[11px]">
          <span style={{ color: 'var(--text-muted)' }}>see also</span>
          <Link
            to="/leaderboard/tokens"
            style={{
              color: 'var(--gold-500)',
              textDecoration: 'none',
              borderBottom: '1px dashed rgba(240,192,64,0.5)',
              paddingBottom: 1,
            }}
          >
            token-maxxers · with receipts
          </Link>
        </div>

        {/* Quadrant breakdown · league pulse strip */}
        {!loading && quadrants.total > 0 && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
            <QuadStat
              label="ENCORE ZONE"
              count={quadrants.graduationZone}
              hint="audit + scout both high"
              tone="#F0C040"
            />
            <QuadStat
              label="ENGINE FAVORITES"
              count={quadrants.auditOnly}
              hint="strong audit · scouts not yet"
              tone="#00D4AA"
            />
            <QuadStat
              label="SCOUT FAVORITES"
              count={quadrants.scoutOnly}
              hint="scouts believe · audit catching up"
              tone="#7AA8FF"
            />
            <QuadStat
              label="ROOKIE CIRCLE"
              count={quadrants.rookieCircle}
              hint="early · room to climb"
              tone="rgba(248,245,238,0.45)"
            />
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 flex items-center gap-4 font-mono text-[11px] flex-wrap" style={{ color: 'var(--text-secondary)' }}>
          <Legend tone="#00D4AA" label="Encore-ready · score 75+" />
          <Legend tone="#F0C040" label="contender · score 50–74" />
          <Legend tone="#6B7280" label="rookie · below 50" />
          <span style={{ color: 'var(--text-muted)' }}>
            · dashed lines mark excellence thresholds (audit ≥ {AUDIT_EXCELLENT} · scout ≥ {SCOUT_EXCELLENT})
          </span>
        </div>
      </div>
    </section>
  )
}

function toneFor(d: ProjectDot): string {
  const total = d.score_total ?? 0
  if (d.status === 'valedictorian')            return '#F0C040'
  if (d.status === 'graduated' || total >= 75) return '#00D4AA'
  if (total >= 50)                              return '#F0C040'
  return '#6B7280'
}

function QuadStat({ label, count, hint, tone }: { label: string; count: number; hint: string; tone: string }) {
  return (
    <div
      className="px-3 py-2.5"
      style={{
        background:   'rgba(255,255,255,0.025)',
        borderLeft:   `2px solid ${tone}`,
        borderRadius: '0 2px 2px 0',
      }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <span className="font-mono text-[10px] tracking-widest" style={{ color: tone }}>
          {label}
        </span>
        <span className="font-display font-bold tabular-nums text-lg" style={{ color: 'var(--cream)' }}>
          {count}
        </span>
      </div>
      <p className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
        {hint}
      </p>
    </div>
  )
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 9, height: 9,
          background: tone,
          border: `1px solid ${tone}`,
          borderRadius: '2px',
        }}
      />
      {label}
    </span>
  )
}
