// %-based relative standing card (§6.2 · replaces GraduationChecklist).
// Surfaces the project's live rank, percentile, projected graduation tier,
// and the basic eligibility filter strip. Transparent-by-default for Scouts
// and Creators; owner mode adds a "what moves you up" hint.

import { useEffect, useState } from 'react'
import {
  fetchProjectStanding,
  nextTierTargetRank,
  TIER_LABEL,
  TIER_COLOR,
  type ProjectStanding,
  type ProjectedTier,
} from '../lib/standing'
import { IconGraduation } from './icons'

interface Props {
  projectId: string
  viewerMode?: 'owner' | 'visitor'
}

export function GraduationStanding({ projectId, viewerMode = 'visitor' }: Props) {
  const [s, setS] = useState<ProjectStanding | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    let alive = true
    fetchProjectStanding(projectId).then(r => {
      if (!alive) return
      setS(r)
      setLoading(false)
    })
    return () => { alive = false }
  }, [projectId])

  if (loading || !s) return null

  const tier        = s.projected_tier
  const tone        = TIER_COLOR[tier]
  const isOwner     = viewerMode === 'owner'
  const eligibleAll = s.live_url_ok && s.snapshots_ok && s.brief_ok
  const next        = nextTierTargetRank(s)

  // Progress-bar semantics: 100% = rank 1. Flip the percentile so lower-is-better
  // reads intuitively as a left-to-right fill.
  const pct = Math.max(0, Math.min(100, Math.round(100 - s.percentile)))

  return (
    <div className="card-navy" style={{ borderRadius: '2px' }}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start justify-between gap-3 p-5 text-left"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs tracking-widest" style={{ color: tone }}>
            // PROJECTED STANDING
          </div>
          <div className="font-display font-bold text-lg mt-1 flex items-center gap-2" style={{ color: 'var(--cream)' }}>
            <span style={{ color: tone }}><IconGraduation size={20} /></span>
            <span>{TIER_LABEL[tier]}</span>
            <span className="font-mono text-sm font-normal tabular-nums" style={{ color: 'var(--text-muted)' }}>
              · rank {s.rank} of {s.total_in_season}
            </span>
          </div>
          {!expanded && (
            <div className="mt-1 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Top {Math.max(1, Math.round(100 - pct))}% · tap to inspect the graduation cutoffs
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="relative" style={{ width: 120, height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }}>
            {/* Cutoff markers */}
            <CutoffMarker pct={99.5} />{/* Valedictorian (top 0.5%) */}
            <CutoffMarker pct={95} />  {/* Honors (top 5%) */}
            <CutoffMarker pct={80} />  {/* Graduate (top 20%) */}
            <div
              className="absolute inset-y-0 left-0 transition-all duration-500"
              style={{
                width: `${pct}%`,
                background: tone,
                borderRadius: '2px',
                boxShadow: `0 0 8px ${tone}55`,
              }}
            />
          </div>
          <span className="font-mono text-sm" style={{ color: 'var(--gold-500)' }}>
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5" style={{ borderTop: `1px solid ${tone}22` }}>
          <p className="font-light text-sm mt-4 mb-5" style={{ color: 'var(--text-primary)', lineHeight: 1.65 }}>
            Graduation is a relative cut. When the season ends the top 20% of the league auto-graduates
            — 1 Valedictorian, 5% Honors, 14.5% Graduate. The rest join the Rookie Circle and come back next season.
            {isOwner && next && ' The row below shows the rank you need to move up a tier.'}
          </p>

          {/* Tier cutoff ladder */}
          <div className="space-y-2.5 mb-5">
            <TierRow label="Valedictorian" cutoff="Rank 1"                          active={tier === 'valedictorian'} tone={TIER_COLOR.valedictorian} />
            <TierRow label="Honors"        cutoff={`Top 5% · rank ≤ ${Math.max(2, Math.ceil(s.total_in_season * 0.05))}`}  active={tier === 'honors'}        tone={TIER_COLOR.honors} />
            <TierRow label="Graduate"      cutoff={`Top 20% · rank ≤ ${Math.ceil(s.total_in_season * 0.20)}`}              active={tier === 'graduate'}      tone={TIER_COLOR.graduate} />
            <TierRow label="Rookie Circle" cutoff="Everyone else · retry next season" active={tier === 'rookie_circle'}   tone={TIER_COLOR.rookie_circle} />
          </div>

          {/* Eligibility strip · basic filter (§6.3) */}
          <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
            ELIGIBILITY FILTER
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            <EligibilityPill ok={s.live_url_ok} label="Live URL reachable" />
            <EligibilityPill ok={s.snapshots_ok} label={`Analysis ${s.snapshots_count} of 2+`} />
            <EligibilityPill ok={s.brief_ok}     label="Core Intent captured" />
          </div>
          {!eligibleAll && (
            <div className="mt-2 pl-3 py-2.5 pr-3 font-mono text-[11px]" style={{
              borderLeft: '2px solid #F88771',
              background: 'rgba(248,120,113,0.06)',
              color: '#F88771',
              lineHeight: 1.6,
            }}>
              One or more basic filters are pending. Even a top-20% score ends up in Rookie Circle until these pass.
            </div>
          )}

          {/* Owner next-step hint */}
          {isOwner && next && eligibleAll && (
            <div className="mt-4 pl-3 py-2.5 pr-3 font-mono text-[11px]" style={{
              borderLeft: '2px solid var(--gold-500)',
              background: 'rgba(240,192,64,0.06)',
              color: 'var(--gold-500)',
              lineHeight: 1.6,
            }}>
              Next: move into the top {Math.max(1, Math.round((next.rank / s.total_in_season) * 100))}%
              (rank {next.rank}) to land in {TIER_LABEL[next.tier]}. That's {Math.max(0, s.rank - next.rank)} places
              to climb.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Small vertical tick on the progress bar at `pct` from the left.
function CutoffMarker({ pct }: { pct: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0"
      style={{
        left: `${pct}%`,
        width: 1,
        background: 'rgba(255,255,255,0.25)',
      }}
    />
  )
}

function TierRow({
  label, cutoff, active, tone,
}: {
  label: string; cutoff: string; active: boolean; tone: string
}) {
  return (
    <div className="p-3 flex items-center gap-3" style={{
      background: active ? `${tone}14` : 'rgba(255,255,255,0.015)',
      border: `1px solid ${active ? `${tone}4D` : 'rgba(255,255,255,0.05)'}`,
      borderLeft: `3px solid ${tone}`,
      borderRadius: '2px',
    }}>
      <span className="font-mono text-xs font-medium flex-1" style={{ color: active ? tone : 'var(--cream)' }}>
        {label}
      </span>
      <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
        {cutoff}
      </span>
      {active && (
        <span className="font-mono text-[10px] tracking-widest px-1.5 py-0.5 flex-shrink-0" style={{
          background: `${tone}22`,
          color: tone,
          border: `1px solid ${tone}55`,
          borderRadius: '2px',
        }}>
          PROJECTED
        </span>
      )}
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
      <span aria-hidden="true" style={{ color: tone, width: 10, height: 10, display: 'inline-block',
        background: tone, borderRadius: '50%',
      }} />
      <span className="font-mono text-[10px] tracking-wide" style={{ color: 'var(--text-primary)' }}>
        {label}
      </span>
    </div>
  )
}

export type { ProjectedTier }
