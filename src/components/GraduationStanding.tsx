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
import { Link } from 'react-router-dom'
import { fetchProjectStanding, type ProjectStanding } from '../lib/standing'
import {
  ENCORE_THRESHOLD, isEncoreScore,
  fetchAllProjectEncores, type EncoreRow, type EncoreKind,
  ENCORE_KIND_META,
} from '../lib/encore'
import { EncoreBadge } from './EncoreBadge'
import { supabase } from '../lib/supabase'
import { scoreBand, bandLabel, bandTone } from './../lib/laneScore'

interface FirstSpotterRow {
  supporter_id:   string
  first_voted_at: string
  display_name:   string | null
  avatar_url:     string | null
}

interface Props {
  projectId: string
  viewerMode?: 'owner' | 'visitor'
  /** §re-audit privacy · when true, blanks out the score · progress bar ·
   *  pillar breakdown · Encore serial. Owner always sees their own. */
  scoreHidden?: boolean
  /** §1-A ⑥ band gate · viewer can't see the raw digit. Surfaces only the
   *  band chip + "approaching Encore" copy. Progress bar stays so visitors
   *  still see the journey shape — they just don't see the exact number. */
  showAsBand?: boolean
}

export function GraduationStanding({ projectId, viewerMode = 'visitor', scoreHidden = false, showAsBand = false }: Props) {
  const [s, setS] = useState<ProjectStanding | null>(null)
  const [encores, setEncores] = useState<EncoreRow[]>([])
  const [supporterCount, setSupporterCount] = useState<number>(0)
  const [firstSpotters, setFirstSpotters] = useState<FirstSpotterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    let alive = true
    Promise.all([
      fetchProjectStanding(projectId),
      fetchAllProjectEncores(projectId),
      supabase.from('supporters').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
      // First Spotters · earliest 3 distinct supporters whose FIRST vote
      // landed inside the 24h window. supporters.first_spotter_tier is
      // already locked at the time of the first vote, so even if they
      // later cast more votes the tier doesn't shift.
      supabase
        .from('supporters')
        .select('supporter_id, first_voted_at, members:supporter_id(display_name, avatar_url)')
        .eq('project_id', projectId)
        .eq('first_spotter_tier', 'first')
        .order('first_voted_at', { ascending: true })
        .limit(3),
    ]).then(([r, encs, sup, firstSp]) => {
      if (!alive) return
      setS(r)
      setEncores(encs)
      setSupporterCount(sup.count ?? 0)
      // Supabase resolves the foreign-key embed as an array even when
      // the FK is to a single row; pluck [0] for the typed shape.
      const fsRaw = (firstSp.data ?? []) as unknown as Array<{
        supporter_id: string
        first_voted_at: string
        members: { display_name: string | null; avatar_url: string | null }[] | null
      }>
      setFirstSpotters(fsRaw.map(r => {
        const m = Array.isArray(r.members) ? r.members[0] : r.members
        return {
          supporter_id:   r.supporter_id,
          first_voted_at: r.first_voted_at,
          display_name:   m?.display_name ?? null,
          avatar_url:     m?.avatar_url ?? null,
        }
      }))
      setLoading(false)
    })
    return () => { alive = false }
  }, [projectId])

  const productionEncore = encores.find(e => e.kind === 'production') ?? null
  const otherEncores     = encores.filter(e => e.kind !== 'production')

  if (loading || !s) return null

  // §re-audit privacy · render a stripped-down card with score · bar ·
  // pillar · Encore serial all blanked. Owner side keeps full detail.
  if (scoreHidden) {
    return (
      <div className="card-navy" style={{ borderRadius: '2px' }}>
        <div className="p-5">
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--text-muted)' }}>
            // ENCORE STANDING · HIDDEN
          </div>
          <div className="font-display font-bold text-lg mt-1 flex items-center gap-2 flex-wrap" style={{ color: 'var(--cream)' }}>
            <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>—/100</span>
          </div>
          <p className="font-light text-sm mt-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Score is hidden from the public until the creator re-audits. Lets builders iterate before the public reveal.
          </p>
        </div>
      </div>
    )
  }

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
            {showAsBand && !isEncore ? (
              // Band mode · hide digit + distance (distance reveals digit by
              // arithmetic). Show band chip + "approaching Encore" copy
              // instead. Encore-graduated rows skip this branch since their
              // digit is publicly revealed (§1-A ⑥ trophy mechanic).
              <>
                <span className="tracking-widest uppercase" style={{ color: bandTone(scoreBand(score)) }}>{bandLabel(scoreBand(score))}</span>
                <span className="font-mono text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                  · approaching Encore
                </span>
              </>
            ) : (
              <>
                <span className="tabular-nums" style={{ color: accent }}>{score}/100</span>
                {isEncore ? (
                  <EncoreBadge score={score} serial={productionEncore?.serial} size="md" />
                ) : (
                  <span className="font-mono text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                    · {distance} to Encore
                  </span>
                )}
              </>
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
              ? productionEncore?.serial
                ? `Issued as Encore #${productionEncore.serial} on ${new Date(productionEncore.earned_at).toLocaleDateString()} when total score first crossed ${ENCORE_THRESHOLD}. The serial is permanent — even if the score later dips, this number stays attached to the product. New climbs reuse the same #.`
                : `This product cleared the ${ENCORE_THRESHOLD} bar — Encore badge active. Re-audits keep score moving; if it dips below ${ENCORE_THRESHOLD} the badge drops off until you climb back.`
              : `Encore is a quality threshold, not a season. Cross ${ENCORE_THRESHOLD} on total score (Audit 50 + Scout 30 + Community 20) and the badge appears on the product card with a permanent serial number. ${viewerMode === 'owner' ? 'The audit report below names the highest-leverage gap to close first.' : ''}`}
          </p>

          {/* Pillar breakdown · most-actionable view of the score */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            <PillarCell label="Audit"    max={50} />
            <PillarCell label="Scout"    max={30} />
            <PillarCell label="Community" max={20} />
          </div>

          {/* Other Encore tracks · streak / climb / spotlight.
              Production is already shown in the headline; these are
              the sibling honors. Each one is a distinct heirloom (per-
              kind serial sequences in the DB) so a project that earned
              a Climb #3 has it forever, even if the score later dips. */}
          {otherEncores.length > 0 && (
            <div className="mb-4">
              <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
                ALSO EARNED
              </div>
              <div className="flex flex-wrap gap-1.5">
                {otherEncores.map(e => (
                  <EncoreBadge
                    key={e.kind}
                    kind={e.kind as EncoreKind}
                    serial={e.serial}
                    size="md"
                  />
                ))}
              </div>
              <div className="font-mono text-[10px] mt-2" style={{ color: 'var(--text-faint)', lineHeight: 1.5 }}>
                {otherEncores.map(e => `${ENCORE_KIND_META[e.kind as EncoreKind].label} #${e.serial}: ${ENCORE_KIND_META[e.kind as EncoreKind].oneLineWhy}.`).join(' ')}
              </div>
            </div>
          )}

          {/* First Spotters · the 3 earliest scouts who voted within 24h
              of Round 1. Strategy doc §4.1 #3: this row is permanent —
              once #1/#2/#3 are locked, day-late scouts can never displace
              them. That's the heirloom moat for scouts (parallel to
              Encore #N for projects). */}
          {firstSpotters.length > 0 && (
            <div className="mb-3">
              <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
                FIRST SPOTTERS
              </div>
              <div className="flex flex-wrap gap-2">
                {firstSpotters.map((fs, idx) => {
                  const initial = (fs.display_name ?? 'M').slice(0, 1).toUpperCase()
                  return (
                    <Link
                      key={fs.supporter_id}
                      to={`/scouts/${fs.supporter_id}`}
                      className="flex items-center gap-2 px-2 py-1.5"
                      style={{
                        background: 'rgba(240,192,64,0.06)',
                        border: '1px solid rgba(240,192,64,0.25)',
                        borderRadius: '2px',
                        textDecoration: 'none',
                      }}
                      title={`First Spotter #${idx + 1} · spotted within 24h of Round 1 on ${new Date(fs.first_voted_at).toLocaleDateString()}`}
                    >
                      <span className="font-mono text-[10px] tabular-nums" style={{ color: 'var(--gold-500)' }}>
                        ★ #{idx + 1}
                      </span>
                      <span
                        className="flex items-center justify-center font-mono font-bold"
                        style={{
                          width: 18, height: 18,
                          background: fs.avatar_url ? 'transparent' : 'var(--gold-500)',
                          color: 'var(--navy-900)',
                          borderRadius: '2px',
                          fontSize: 9,
                          overflow: 'hidden',
                        }}
                      >
                        {fs.avatar_url
                          ? <img src={fs.avatar_url} alt="" style={{ width: 18, height: 18, objectFit: 'cover' }} />
                          : initial}
                      </span>
                      <span className="font-mono text-[11px]" style={{ color: 'var(--cream)' }}>
                        {fs.display_name ?? 'Member'}
                      </span>
                    </Link>
                  )
                })}
              </div>
              <div className="font-mono text-[10px] mt-1.5" style={{ color: 'var(--text-faint)', lineHeight: 1.5 }}>
                Permanent record · the first 3 scouts to forecast within 24h of the first audit.
              </div>
            </div>
          )}

          {/* Supporter strip · how many Scouts have placed a forecast on
              this project. Persists across re-audits so it's a real "fan
              count" — distinct from forecast votes (which can be ×N from
              the same scout). Shown only once at least one supporter exists
              so a fresh project doesn't read "0 supporters yet". */}
          {supporterCount > 0 && (
            <div className="mb-3 flex items-center gap-2 px-3 py-2" style={{
              background: 'rgba(240,192,64,0.04)',
              border: '1px solid rgba(240,192,64,0.18)',
              borderRadius: '2px',
            }}>
              <span aria-hidden="true" style={{ color: 'var(--gold-500)', fontSize: 14 }}>★</span>
              <span className="font-mono text-[11px]" style={{ color: 'var(--cream)' }}>
                <strong style={{ color: 'var(--gold-500)' }}>{supporterCount.toLocaleString()}</strong>{' '}
                <span style={{ color: 'var(--text-secondary)' }}>
                  {supporterCount === 1 ? 'Scout supporting this product' : 'Scouts supporting this product'}
                </span>
              </span>
            </div>
          )}

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
