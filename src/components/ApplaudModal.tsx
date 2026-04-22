import { useEffect, useState } from 'react'
import type { Project, ScoutTier } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  castApplaud,
  hasApplaudedThisSeason,
  AlreadyApplaudedThisSeasonError,
  CannotApplaudOwnProjectError,
} from '../lib/applaud'
import { IconApplaud } from './icons'

interface ApplaudModalProps {
  project: Project
  onClose: () => void
  onCast?: () => void
}

const TIER_COLOR: Record<ScoutTier, string> = {
  Bronze: '#B98B4E', Silver: '#D1D5DB', Gold: '#F0C040', Platinum: '#A78BFA',
}

const TIER_WEIGHT: Record<ScoutTier, string> = {
  Bronze: '1.0', Silver: '1.5', Gold: '2.0', Platinum: '3.0',
}

export function ApplaudModal({ project, onClose, onCast }: ApplaudModalProps) {
  const { user, member } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<null | { weight: number; ap: number; tier: ScoutTier }>(null)
  const [seasonWinnerProjectId, setSeasonWinnerProjectId] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Has this scout already picked a Craft Award winner for this season?
  useEffect(() => {
    if (!user?.id) return
    hasApplaudedThisSeason(user.id).then(setSeasonWinnerProjectId)
  }, [user?.id])

  const tier = (member?.tier ?? 'Bronze') as ScoutTier
  const alreadyPickedElsewhere = seasonWinnerProjectId !== null && seasonWinnerProjectId !== project.id
  const alreadyPickedHere      = seasonWinnerProjectId === project.id
  const canSubmit = !!user && !busy && !alreadyPickedElsewhere && !alreadyPickedHere

  const handleSubmit = async () => {
    if (!user?.id) return
    setBusy(true)
    setError('')
    try {
      const res = await castApplaud({ projectId: project.id, memberId: user.id })
      setSuccess({ weight: res.weight, ap: res.apEarned, tier: res.scoutTier })
      setSeasonWinnerProjectId(project.id)
      onCast?.()
    } catch (e) {
      if (e instanceof AlreadyApplaudedThisSeasonError) {
        setError(e.message)
      } else if (e instanceof CannotApplaudOwnProjectError) {
        setError(e.message)
      } else {
        setError((e as Error).message || 'Applaud failed.')
      }
    } finally { setBusy(false) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      style={{ background: 'rgba(6,12,26,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="card-navy p-7 w-full max-w-md max-h-[90vh] overflow-y-auto relative"
        style={{ borderRadius: '2px' }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 font-mono text-xs px-2 py-1"
          style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px', cursor: 'pointer' }}
        >
          ESC
        </button>

        <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
          // CRAFT AWARD · APPLAUD WEEK
        </div>
        <h3 className="font-display font-bold text-xl mb-1" style={{ color: 'var(--cream)' }}>
          {project.project_name}
        </h3>
        <p className="font-mono text-xs mb-5" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Pick the one project worthy of the season's Craft Award. One applaud per Scout per season —
          choose carefully.
        </p>

        {user && (
          <div className="mb-5 px-3 py-2 flex items-center justify-between font-mono text-xs" style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '2px',
          }}>
            <span>
              <span style={{ color: TIER_COLOR[tier] }}>{tier} Scout</span>
              <span style={{ color: 'var(--text-muted)' }}>{` · weight ×${TIER_WEIGHT[tier]}`}</span>
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>+5 AP</span>
          </div>
        )}

        {!user && (
          <div className="mb-5 pl-3 py-2 pr-3 font-mono text-xs"
            style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
            Sign in to applaud.
          </div>
        )}

        {alreadyPickedElsewhere && !success && (
          <div className="mb-4 pl-3 py-2 pr-3 font-mono text-xs"
            style={{ borderLeft: '2px solid #A78BFA', background: 'rgba(167,139,250,0.05)', color: 'rgba(248,245,238,0.75)', lineHeight: 1.6 }}>
            You already cast this season's Craft Award on another project. Only one applaud per season.
          </div>
        )}

        {alreadyPickedHere && !success && (
          <div className="mb-4 pl-3 py-2 pr-3 font-mono text-xs"
            style={{ borderLeft: '2px solid #00D4AA', background: 'rgba(0,212,170,0.05)', color: '#00D4AA', lineHeight: 1.6 }}>
            ✓ You've already applauded this project for the Craft Award.
          </div>
        )}

        {success ? (
          <div className="space-y-4">
            <div className="px-4 py-4 text-center" style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: '2px' }}>
              <div className="font-mono text-xs tracking-widest mb-1" style={{ color: '#A78BFA' }}>APPLAUDED</div>
              <div className="font-display font-bold text-2xl inline-flex items-center justify-center gap-2" style={{ color: 'var(--cream)' }}>
                <span style={{ color: '#A78BFA' }}><IconApplaud size={20} /></span>
                {project.project_name}
              </div>
              <div className="font-mono text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                +{success.ap} AP · weight ×{success.weight.toFixed(1)} · {success.tier} Scout
              </div>
            </div>
            <button onClick={onClose} className="w-full py-2.5 font-mono text-xs tracking-wide"
              style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}>
              DONE
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="pl-3 py-2 pr-3 font-mono text-xs"
                style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-full py-3 font-mono text-xs font-medium tracking-wide"
              style={{
                background: canSubmit ? 'var(--gold-500)' : 'rgba(255,255,255,0.06)',
                color: canSubmit ? 'var(--navy-900)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: '2px',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {busy ? 'CASTING…'
                : alreadyPickedHere      ? 'ALREADY APPLAUDED'
                : alreadyPickedElsewhere ? 'SEASON APPLAUD USED'
                : (
                  <span className="inline-flex items-center justify-center gap-1.5"><IconApplaud size={12} /> CAST CRAFT AWARD APPLAUD</span>
                )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
