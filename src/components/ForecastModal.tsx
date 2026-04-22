import { useEffect, useState } from 'react'
import type { Project, ScoutTier } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  castForecast,
  hasForecasted,
  loadMemberStats,
  ForecastQuotaError,
  AlreadyForecastedError,
} from '../lib/forecast'

interface ForecastModalProps {
  project: Project
  onClose: () => void
  onCast?: () => void
}

const TIER_COLOR: Record<ScoutTier, string> = {
  Bronze: '#B98B4E', Silver: '#D1D5DB', Gold: '#F0C040', Platinum: '#A78BFA',
}

export function ForecastModal({ project, onClose, onCast }: ForecastModalProps) {
  const { user } = useAuth()
  const [score, setScore] = useState(75)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<null | { tier: ScoutTier; weight: number; ap: number }>(null)
  const [alreadyCast, setAlreadyCast] = useState<boolean | null>(null)
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

  // Load scout status + previous forecast state.
  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      const [stats, prior] = await Promise.all([
        loadMemberStats(user.id),
        hasForecasted(user.id, project.id),
      ])
      if (stats) {
        setTier(stats.tier)
        setQuotaRemaining(stats.monthly_votes_remaining)
        setQuotaCap(stats.monthly_vote_cap)
        setAP(stats.activity_points)
      }
      setAlreadyCast(prior)
    })()
  }, [user?.id, project.id])

  const canSubmit = user && !busy && alreadyCast === false && (quotaRemaining ?? 0) > 0

  const handleSubmit = async () => {
    if (!user?.id) return
    setBusy(true)
    setError('')
    try {
      const res = await castForecast({ projectId: project.id, predictedScore: score, comment: comment.trim() || undefined, memberId: user.id })
      setSuccess({ tier: res.scoutTier, weight: res.weight, ap: res.apEarned })
      onCast?.()
    } catch (e) {
      if (e instanceof ForecastQuotaError) {
        setError(`Monthly quota exhausted for ${e.tier} tier (${e.used} / ${e.cap}). Resets on the 1st.`)
      } else if (e instanceof AlreadyForecastedError) {
        setError("You've already forecasted this project this season.")
        setAlreadyCast(true)
      } else {
        setError((e as Error).message || 'Failed to cast forecast.')
      }
    } finally { setBusy(false) }
  }

  return (
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
          Current score: {project.score_total} / 100
        </p>

        {/* Scout status strip */}
        {user && (
          <div className="mb-5 px-3 py-2 flex items-center justify-between font-mono text-xs" style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '2px',
          }}>
            <span>
              <span style={{ color: TIER_COLOR[tier] }}>{tier}</span>
              <span style={{ color: 'rgba(248,245,238,0.35)' }}> · {ap.toLocaleString()} AP</span>
            </span>
            <span style={{ color: quotaRemaining === 0 ? '#C8102E' : 'rgba(248,245,238,0.45)' }}>
              {quotaRemaining ?? '—'} / {quotaCap ?? '—'} votes left this month
            </span>
          </div>
        )}

        {!user && (
          <div className="mb-5 pl-3 py-2 pr-3 font-mono text-xs"
            style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
            Sign in to cast a forecast.
          </div>
        )}

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
              <div className="font-mono text-xs mt-2" style={{ color: 'rgba(248,245,238,0.4)' }}>
                Bonus AP resolves at graduation if your forecast is accurate.
              </div>
            </div>
            <button onClick={onClose} className="w-full py-2.5 font-mono text-xs tracking-wide"
              style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}>
              DONE
            </button>
          </div>
        ) : alreadyCast ? (
          <div className="px-4 py-4 text-center" style={{ background: 'rgba(240,192,64,0.05)', border: '1px solid rgba(240,192,64,0.25)', borderRadius: '2px' }}>
            <div className="font-mono text-xs tracking-widest mb-1" style={{ color: 'var(--gold-500)' }}>ALREADY FORECASTED</div>
            <div className="font-light text-sm" style={{ color: 'rgba(248,245,238,0.6)' }}>
              You've already cast a forecast on this project this season. One per Scout per season.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
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
                <span>At graduation threshold</span>
                <span>Valedictorian</span>
              </div>
            </div>

            <div>
              <label className="block font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
                RATIONALE (OPTIONAL · ≤140 CHARS)
              </label>
              <textarea
                value={comment}
                maxLength={140}
                onChange={e => setComment(e.target.value)}
                disabled={!canSubmit}
                rows={2}
                placeholder="What signal moved your forecast?"
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
    </div>
  )
}
