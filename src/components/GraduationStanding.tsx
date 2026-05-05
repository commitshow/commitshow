// Encore Standing card · 2026-05-05 rebrand of the legacy
// GraduationStanding tier ladder. Now a single threshold-bar that
// shows the project's current total score relative to the Encore
// line (84). When the score crosses the line, the card flips into
// "Encore" mode (gold accent + ★ Encore badge); when below, it
// shows distance-to-Encore and the eligibility filter.
//
// Component name kept (still imported as GraduationStanding) so the
// ProjectDetailPage mount point doesn't churn — file path is the
// stable contract. New mounts should use the named export.

import { useEffect, useState } from 'react'
import { fetchProjectStanding, type ProjectStanding } from '../lib/standing'
import {
  ENCORE_THRESHOLD, isEncoreScore,
  fetchProjectEncore, type EncoreRow,
} from '../lib/encore'
import { EncoreBadge } from './EncoreBadge'

interface Props {
  projectId: string
  viewerMode?: 'owner' | 'visitor'
}

export function GraduationStanding({ projectId, viewerMode = 'visitor' }: Props) {
  const [s, setS] = useState<ProjectStanding | null>(null)
  const [encore, setEncore] = useState<EncoreRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    let alive = true
    Promise.all([
      fetchProjectStanding(projectId),
      fetchProjectEncore(projectId),
    ]).then(([r, e]) => {
      if (!alive) return
      setS(r)
      setEncore(e)
      setLoading(false)
    })
    return () => { alive = false }
  }, [projectId])

  if (loading || !s) return null

  const score      = s.score_total ?? 0
  const isEncore   = isEncoreScore(score)
  const eligibleAll = s.live_url_ok && s.snapshots_ok && s.brief_ok
  const accent     = isEncore ? 'var(--gold-500)' : '#60A5FA'
  const distance   = Math.max(0, ENCORE_THRESHOLD - score)
  // Bar fill: 0-100 → 0-100%. Past the threshold, fill stays full.
  const pct = Math.min(100, Math.max(0, score))

  return (
    <div className="card-navy" style={{ borderRadius: '2px' }}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start justify-between gap-3 p-5 text-left"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs tracking-widest" style={{ color: accent }}>
            // ENCORE STANDING
          </div>
          <div className="font-display font-bold text-lg mt-1 flex items-center gap-2 flex-wrap" style={{ color: 'var(--cream)' }}>
            <span className="tabular-nums" style={{ color: accent }}>{score}/100</span>
            {isEncore ? (
              <EncoreBadge score={score} serial={encore?.serial} size="md" />
            ) : (
              <span className="font-mono text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                · {distance} to Encore
              </span>
            )}
          </div>
          {!expanded && (
            <div className="mt-1 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {isEncore
                ? 'Above the Encore line · tap to see what keeps you here'
                : 'Below the Encore line · tap to see what to fix first'}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="relative" style={{ width: 140, height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }}>
            {/* Encore threshold marker · the only line that matters now. */}
            <span
              aria-hidden="true"
              className="absolute inset-y-0"
              style={{
                left: `${ENCORE_THRESHOLD}%`,
                width: 2,
                background: 'var(--gold-500)',
              }}
              title={`Encore @ ${ENCORE_THRESHOLD}`}
            />
            <div
              className="absolute inset-y-0 left-0 transition-all duration-500"
              style={{
                width: `${pct}%`,
                background: accent,
                borderRadius: '2px',
                boxShadow: `0 0 8px ${accent}55`,
              }}
            />
          </div>
          <span className="font-mono text-sm" style={{ color: 'var(--gold-500)' }}>
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5" style={{ borderTop: `1px solid ${accent}22` }}>
          <p className="font-light text-sm mt-4 mb-5" style={{ color: 'var(--text-primary)', lineHeight: 1.65 }}>
            {isEncore
              ? encore?.serial
                ? `Issued as Encore #${encore.serial} on ${new Date(encore.earned_at).toLocaleDateString()} when total score first crossed ${ENCORE_THRESHOLD}. The serial is permanent — even if the score later dips, this number stays attached to the product. New climbs reuse the same #.`
                : `This product cleared the ${ENCORE_THRESHOLD} bar — Encore badge active. Re-audits keep score moving; if it dips below ${ENCORE_THRESHOLD} the badge drops off until you climb back.`
              : `Encore is a quality threshold, not a season. Cross ${ENCORE_THRESHOLD} on total score (Audit 50 + Scout 30 + Community 20) and the badge appears on the product card with a permanent serial number. ${viewerMode === 'owner' ? 'The audit report below names the highest-leverage gap to close first.' : ''}`}
          </p>

          {/* Pillar breakdown · most-actionable view of the score */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            <PillarCell label="Audit"    max={50} />
            <PillarCell label="Scout"    max={30} />
            <PillarCell label="Community" max={20} />
          </div>

          {/* Eligibility strip · still useful (Encore = score-only, but
              live URL + brief make the score meaningful in the first place) */}
          <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
            FOUNDATIONS
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            <EligibilityPill ok={s.live_url_ok}  label="Live URL reachable" />
            <EligibilityPill ok={s.snapshots_ok} label={`${s.snapshots_count} audit snapshot${s.snapshots_count === 1 ? '' : 's'}`} />
            <EligibilityPill ok={s.brief_ok}     label="Core Intent captured" />
          </div>
          {!eligibleAll && (
            <div className="mt-2 pl-3 py-2.5 pr-3 font-mono text-[11px]" style={{
              borderLeft: '2px solid #F88771',
              background: 'rgba(248,120,113,0.06)',
              color: '#F88771',
              lineHeight: 1.6,
            }}>
              One foundation pending. Encore evaluates score on a live, audited, briefed product — the badge holds back until those land, even if the number says you'd qualify.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Tiny placeholder for pillar breakdown · the actual pillar-score
// component already lives elsewhere on ProjectDetailPage so this is a
// label-only stub. Could later be wired to live pillar values via
// fetchProjectStanding (would require expanding the standing query).
function PillarCell({ label, max }: { label: string; max: number }) {
  return (
    <div className="px-2.5 py-2" style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '2px',
    }}>
      <div className="font-mono text-[9px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="font-mono text-[11px] tabular-nums mt-0.5" style={{ color: 'var(--cream)' }}>0–{max}</div>
    </div>
  )
}

function EligibilityPill({ ok, label }: { ok: boolean; label: string }) {
  const tone = ok ? '#00D4AA' : '#F88771'
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5" style={{
      background: ok ? 'rgba(0,212,170,0.06)' : 'rgba(248,120,113,0.05)',
      border: `1px solid ${tone}55`,
      borderRadius: '2px',
    }}>
      <span aria-hidden="true" style={{
        color: tone, width: 10, height: 10, display: 'inline-block',
        background: tone, borderRadius: '50%',
      }} />
      <span className="font-mono text-[10px] tracking-wide" style={{ color: 'var(--text-primary)' }}>
        {label}
      </span>
    </div>
  )
}
