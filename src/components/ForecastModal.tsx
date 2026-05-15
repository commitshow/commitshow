import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Project, ScoutTier } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  castForecast,
  priorForecastCount,
  loadMemberStats,
  fetchVoteWindowState,
  SPOTTER_BONUS,
  ForecastQuotaError,
  ForecastWindowClosedError,
  type SpotterTier,
  type VoteWindowState,
} from '../lib/forecast'
import { EmotionTagRow } from './EmotionTagRow'
import { useViewer } from '../lib/useViewer'
import { scoreBand, bandLabel, bandTone, viewerCanSeeDigit } from '../lib/laneScore'

interface ForecastModalProps {
  project: Project
  onClose: () => void
  onCast?: () => void
}

const TIER_COLOR: Record<ScoutTier, string> = {
  Bronze: '#B98B4E', Silver: '#D1D5DB', Gold: '#F0C040', Platinum: '#A78BFA',
}

// AP thresholds → next tier (CLAUDE.md §9). OR-condition with correct-
// forecast count is shown as a sibling hint, not the primary path.
const NEXT_TIER: Record<ScoutTier, { name: ScoutTier | null; apTarget: number | null; correctTarget: number | null }> = {
  Bronze:   { name: 'Silver',   apTarget: 500,  correctTarget: 30  },
  Silver:   { name: 'Gold',     apTarget: 2000, correctTarget: 120 },
  Gold:     { name: 'Platinum', apTarget: 5000, correctTarget: null }, // Platinum is "top 3%" not absolute · render text-only
  Platinum: { name: null,       apTarget: null, correctTarget: null },
}

export function ForecastModal({ project, onClose, onCast }: ForecastModalProps) {
  const { user } = useAuth()
  // §1-A ⑥ + design rationale · Scout is forecasting the project's
  // ladder trajectory. If we show the digit here the Scout anchors to
  // it ("82 already, I'll vote 82-ish") and the Forecast becomes a
  // consensus echo instead of a prediction. Showing the band keeps the
  // tier signal (Strong / Building) without anchoring the precise
  // number. Creator on own project gets digit but a creator can't
  // forecast their own anyway.
  const viewer       = useViewer()
  const canSeeDigit  = viewerCanSeeDigit(project, viewer)
  const projBand     = scoreBand(project.score_total ?? 0)
  const [score, setScore] = useState(75)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<null | { tier: ScoutTier; weight: number; ap: number; spotterTier: SpotterTier | null; spotterBonus: number }>(null)
  const [voteWindow, setVoteWindow] = useState<VoteWindowState | null>(null)
  // priorCount = how many forecasts this member already cast on this
  // project this season. PRD §1-A ① / §9 lets the same Scout cast ×N
  // (conviction expressed as multiple votes inside their monthly quota),
  // so this is informational, NOT a gate.
  const [priorCount, setPriorCount] = useState<number | null>(null)
  const [tier, setTier] = useState<ScoutTier>('Bronze')
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null)
  const [quotaCap, setQuotaCap] = useState<number | null>(null)
  const [ap, setAP] = useState<number>(0)

  // Close on escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Load scout status + prior forecast count + window state (anyone can
  // see the window status, even before sign-in, so the gate copy reads
  // honestly: "Window closed 6 days ago" beats a generic "sign in").
  useEffect(() => {
    let alive = true
    ;(async () => {
      const winP = fetchVoteWindowState(project.id)
      if (user?.id) {
        const [stats, prior, win] = await Promise.all([
          loadMemberStats(user.id),
          priorForecastCount(user.id, project.id),
          winP,
        ])
        if (!alive) return
        if (stats) {
          setTier(stats.tier)
          setQuotaRemaining(stats.monthly_votes_remaining)
          setQuotaCap(stats.monthly_vote_cap)
          setAP(stats.activity_points)
        }
        setPriorCount(prior)
        setVoteWindow(win)
      } else {
        const win = await winP
        if (!alive) return
        setVoteWindow(win)
      }
    })()
    return () => { alive = false }
  }, [user?.id, project.id])

  const canSubmit = !!user && !busy && (quotaRemaining ?? 0) > 0 && !!voteWindow?.isOpen

  const handleSubmit = async () => {
    if (!user?.id) return
    setBusy(true)
    setError('')
    try {
      const res = await castForecast({ projectId: project.id, predictedScore: score, comment: comment.trim() || undefined, memberId: user.id })
      setSuccess({ tier: res.scoutTier, weight: res.weight, ap: res.apEarned, spotterTier: res.spotterTier, spotterBonus: res.spotterBonus })
      onCast?.()
    } catch (e) {
      if (e instanceof ForecastQuotaError) {
        setError(`Monthly quota exhausted for ${e.tier} tier (${e.used} / ${e.cap}). Resets on the 1st.`)
      } else if (e instanceof ForecastWindowClosedError) {
        setError('Forecast window closed for this project · windows last 14 days from the first audit.')
      } else {
        setError((e as Error).message || 'Failed to cast forecast.')
      }
    } finally { setBusy(false) }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(6,12,26,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="card-navy p-7 w-full max-w-md relative"
        style={{ borderRadius: '2px' }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 font-mono text-xs px-2 py-1"
          style={{ background: 'transparent', color: 'rgba(248,245,238,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px', cursor: 'pointer' }}
        >
          ESC
        </button>

        <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
          // FORECAST THIS PROJECT
        </div>
        <h3 className="font-display font-bold text-xl mb-1" style={{ color: 'var(--cream)' }}>
          {project.project_name}
        </h3>
        <p className="text-xs font-mono mb-5" style={{ color: 'rgba(248,245,238,0.4)' }}>
          {canSeeDigit
            ? <>Current score: {project.score_total} / 100</>
            : <>Current band: <span className="tracking-widest uppercase" style={{ color: bandTone(projBand) }}>{bandLabel(projBand)}</span> · forecast unanchored</>}
        </p>

        {/* Scout status · two labelled rows so the lifetime AP count never
            fuses with the monthly votes-left number (CEO read "30 AP earned
            18 / 20" as one phrase). Labels on the left, values on the right. */}
        {user && (
          <div className="mb-5 px-3 py-2.5 font-mono text-xs space-y-1" style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '2px',
          }}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>TIER</span>
              <span>
                <span style={{ color: TIER_COLOR[tier] }}>{tier}</span>
                <span style={{ color: 'rgba(248,245,238,0.35)' }}> · {ap.toLocaleString()} AP earned</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '5px' }}>
              <span className="text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>THIS MONTH</span>
              <span style={{ color: quotaRemaining === 0 ? '#C8102E' : 'rgba(248,245,238,0.55)' }}>
                <strong style={{ color: quotaRemaining === 0 ? '#C8102E' : 'var(--cream)' }}>{quotaRemaining ?? '—'}</strong>
                <span style={{ color: 'rgba(248,245,238,0.35)' }}> / {quotaCap ?? '—'}</span>
                <span style={{ color: 'rgba(248,245,238,0.35)' }}> votes left</span>
              </span>
            </div>
          </div>
        )}

        {!user && (
          <div className="mb-5 pl-3 py-2 pr-3 font-mono text-xs"
            style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
            Sign in to cast a forecast.
          </div>
        )}

        {voteWindow && <SpotterWindowStrip window={voteWindow} />}

        {success ? (
          <div className="space-y-4">
            <div className="px-4 py-4 text-center" style={{ background: 'rgba(0,212,170,0.06)', border: '1px solid rgba(0,212,170,0.3)', borderRadius: '2px' }}>
              <div className="font-mono text-xs tracking-widest mb-1" style={{ color: '#00D4AA' }}>FORECAST CAST</div>
              <div className="font-display font-bold text-2xl" style={{ color: 'var(--cream)' }}>
                +{success.ap} AP
              </div>
              <div className="font-mono text-xs mt-1" style={{ color: 'rgba(248,245,238,0.55)' }}>
                {success.tier} Scout
              </div>
              {success.spotterTier && success.spotterBonus > 0 && (
                <div className="mt-2 inline-block px-2 py-1 font-mono text-[10px] tracking-widest" style={{
                  background: 'rgba(240,192,64,0.12)',
                  color: 'var(--gold-500)',
                  border: '1px solid rgba(240,192,64,0.45)',
                  borderRadius: '2px',
                }}>
                  ★ {SPOTTER_LABELS[success.spotterTier].label} · +{success.spotterBonus} AP
                </div>
              )}
              <div className="font-mono text-xs mt-2" style={{ color: 'rgba(248,245,238,0.4)' }}>
                Accuracy bonus resolves once this build crosses the Encore line if your forecast is on target.
              </div>
            </div>

            {/* AP total + progress to next tier · so the user sees the +10 land
                in their lifetime AP and how far they are from the next promotion.
                AP path is the primary metric on the bar; the OR-condition (correct
                forecasts) gets a small hint underneath since most users won't
                track that count manually. */}
            {(() => {
              const apBefore = ap
              const apAfter  = ap + success.ap
              const next     = NEXT_TIER[success.tier]
              const target   = next.apTarget ?? 0
              const pct      = next.apTarget ? Math.min(100, Math.max(0, (apAfter / target) * 100)) : 100
              const remaining = next.apTarget ? Math.max(0, target - apAfter) : 0
              return (
                <div className="px-4 py-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px' }}>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>YOUR TOTAL AP</span>
                    <span className="font-mono text-sm tabular-nums" style={{ color: 'var(--cream)' }}>
                      {apBefore.toLocaleString()}
                      <span className="mx-1" style={{ color: 'var(--text-muted)' }}>→</span>
                      <strong>{apAfter.toLocaleString()}</strong>
                    </span>
                  </div>
                  {next.name ? (
                    <>
                      <div className="relative h-1.5 mb-1.5" style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div className="absolute inset-y-0 left-0 transition-all duration-500" style={{
                          width: `${pct}%`,
                          background: `linear-gradient(90deg, ${TIER_COLOR[success.tier]} 0%, ${TIER_COLOR[next.name]} 100%)`,
                        }} />
                      </div>
                      <div className="flex items-baseline justify-between font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        <span>
                          {remaining.toLocaleString()} AP to{' '}
                          <span style={{ color: TIER_COLOR[next.name] }}>{next.name}</span>
                        </span>
                        {next.correctTarget && (
                          <span style={{ color: 'rgba(248,245,238,0.3)' }}>
                            or {next.correctTarget} verified hits
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      Top tier reached · keep your hit rate up to stay in the top 3%.
                    </div>
                  )}
                </div>
              )
            })()}

            <button onClick={onClose} className="w-full py-2.5 font-mono text-xs tracking-wide"
              style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}>
              DONE
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Prior-cast chip · informational only, never a gate. PRD lets
                a Scout pile multiple casts onto a project they're convinced
                about; the chip just makes that history visible so they don't
                spam by accident. */}
            {priorCount !== null && priorCount > 0 && (
              <div className="px-3 py-2 font-mono text-[11px]" style={{
                background: 'rgba(240,192,64,0.05)',
                border: '1px solid rgba(240,192,64,0.2)',
                borderRadius: '2px',
                color: 'rgba(248,245,238,0.65)',
              }}>
                You've cast <strong style={{ color: 'var(--gold-500)' }}>{priorCount}</strong> {priorCount === 1 ? 'forecast' : 'forecasts'} on this project already this season.
                Cast another to express stronger conviction · burns one from your monthly quota.
              </div>
            )}

            <div>
              <label className="block font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
                YOUR GRADUATION FORECAST (0 – 100)
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range" min={0} max={100} step={1}
                  value={score}
                  onChange={e => setScore(parseInt(e.target.value))}
                  disabled={!canSubmit}
                  className="flex-1"
                  style={{ accentColor: 'var(--gold-500)' }}
                />
                <span className="font-display font-black text-3xl tabular-nums" style={{ color: 'var(--cream)', minWidth: '72px', textAlign: 'right' }}>
                  {score}
                </span>
              </div>
              <div className="flex justify-between font-mono text-[10px] mt-1" style={{ color: 'rgba(248,245,238,0.3)' }}>
                <span>Will fail</span>
                <span>At Encore line</span>
                <span>Valedictorian</span>
              </div>
            </div>

            <div>
              <label className="block font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
                RATIONALE (OPTIONAL · ≤140 CHARS)
              </label>
              <EmotionTagRow
                value={comment}
                onChange={setComment}
                maxLength={140}
                className="mb-2"
              />
              <textarea
                value={comment}
                maxLength={140}
                onChange={e => setComment(e.target.value)}
                disabled={!canSubmit}
                rows={2}
                placeholder="What signal moved your forecast? A tag is enough — no essay needed."
                className="w-full px-3 py-2 font-mono text-xs"
                style={{ lineHeight: 1.5 }}
              />
              <div className="text-right font-mono text-[10px] mt-0.5" style={{ color: 'rgba(248,245,238,0.3)' }}>
                {comment.length} / 140
              </div>
            </div>

            {error && (
              <div className="pl-3 py-2 pr-3 font-mono text-xs"
                style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-full py-2.5 font-mono text-xs font-medium tracking-wide"
              style={{
                background: canSubmit ? 'var(--gold-500)' : 'rgba(255,255,255,0.06)',
                color: canSubmit ? 'var(--navy-900)' : 'rgba(248,245,238,0.3)',
                border: 'none',
                borderRadius: '2px',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {busy ? 'CASTING…' : 'CAST FORECAST'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// Spotter-tier window strip · 3 segments (First 24h · Early 3d · Spotter 14d).
// Active segment glows, past segments dim, future segments are placeholders.
// When window is closed, the whole strip mutes and the headline says so.
const SPOTTER_LABELS: Record<SpotterTier, { label: string; window: string; bonus: number }> = {
  first:   { label: 'First Spotter',   window: '≤ 24h',  bonus: SPOTTER_BONUS.first },
  early:   { label: 'Early Spotter',   window: '≤ 3 days', bonus: SPOTTER_BONUS.early },
  spotter: { label: 'Spotter',         window: '≤ 14 days', bonus: SPOTTER_BONUS.spotter },
}

function SpotterWindowStrip({ window }: { window: VoteWindowState }) {
  const tiers: SpotterTier[] = ['first', 'early', 'spotter']
  const activeIdx = window.tierNow ? tiers.indexOf(window.tierNow) : -1

  if (!window.openedAt) {
    return (
      <div className="mb-5 px-3 py-2.5 font-mono text-[11px]" style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '2px',
        color: 'var(--text-muted)',
      }}>
        Forecast window opens after the first audit.
      </div>
    )
  }

  const closesAt = window.closesAt ? new Date(window.closesAt) : null
  const now = new Date()
  const msLeft = closesAt ? closesAt.getTime() - now.getTime() : 0
  const daysLeft = Math.max(0, Math.floor(msLeft / (1000 * 60 * 60 * 24)))
  const hoursLeft = Math.max(0, Math.floor(msLeft / (1000 * 60 * 60)))

  return (
    <div className="mb-5 px-3 py-2.5" style={{
      background: window.isOpen ? 'rgba(240,192,64,0.04)' : 'rgba(248,120,113,0.05)',
      border: `1px solid ${window.isOpen ? 'rgba(240,192,64,0.2)' : 'rgba(248,120,113,0.25)'}`,
      borderRadius: '2px',
    }}>
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-mono text-[10px] tracking-widest" style={{ color: window.isOpen ? 'var(--gold-500)' : '#F88771' }}>
          {window.isOpen ? 'FORECAST WINDOW OPEN' : 'FORECAST WINDOW CLOSED'}
        </span>
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {window.isOpen
            ? (daysLeft > 0 ? `${daysLeft}d left` : `${hoursLeft}h left`)
            : 'closed > 14 days after Round 1'}
        </span>
      </div>
      <div className="flex gap-1">
        {tiers.map((t, i) => {
          const meta = SPOTTER_LABELS[t]
          const isActive = i === activeIdx && window.isOpen
          const isPast   = activeIdx !== -1 && i < activeIdx
          const isFuture = activeIdx === -1 || i > activeIdx
          const fg = isActive ? 'var(--gold-500)'
                  : isPast   ? 'var(--text-muted)'
                  : isFuture && window.isOpen ? 'var(--text-secondary)'
                  : 'var(--text-faint)'
          const bg = isActive ? 'rgba(240,192,64,0.12)' : 'rgba(255,255,255,0.02)'
          const border = isActive ? '1px solid rgba(240,192,64,0.4)' : '1px solid rgba(255,255,255,0.04)'
          return (
            <div key={t} className="flex-1 px-2 py-1.5 font-mono text-[10px]" style={{
              background: bg, border, borderRadius: '2px', color: fg, textAlign: 'center',
              opacity: isFuture && !window.isOpen ? 0.5 : 1,
            }}>
              <div style={{ fontWeight: isActive ? 700 : 400 }}>{meta.label}</div>
              <div style={{ color: isActive ? fg : 'var(--text-muted)', marginTop: 1 }}>
                {meta.window} · +{meta.bonus} AP
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
