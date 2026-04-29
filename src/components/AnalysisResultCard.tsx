import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { analyzeProject, CooldownError, type AnalysisResult, type AxisColor, type FindingAccent, type ExpertVerdict, type ExpertVerdictLabel, type ExpertRole, type ScoutBriefBullet, type ScoreBreakdownItem } from '../lib/analysis'
import { AnalysisProgressModal } from './AnalysisProgressModal'
import type { ScoutTier } from '../lib/supabase'
import { RoleIcon } from './iconMaps'
import { IconLock } from './icons'
import { DiscoveryPanel } from './DiscoveryPanel'
import { supabase } from '../lib/supabase'

// Color map — Ivy League palette, never generic rainbow.
const AXIS_PALETTE: Record<AxisColor, string> = {
  blue:    '#5C8DE6',
  indigo:  '#7B6CD9',
  green:   '#3FA874',
  emerald: '#2E9D6E',
  pink:    '#D8649A',
  amber:   '#D4922A',
  rose:    '#C8102E',
}

const ACCENT_PALETTE: Record<FindingAccent, string> = {
  green:  '#3FA874',
  indigo: '#7B6CD9',
  blue:   '#5C8DE6',
  amber:  '#D4922A',
  rose:   '#C8102E',
}

function DeltaBadge({ label }: { label: string }) {
  const isNew  = /^new$/i.test(label)
  const isUp   = label.startsWith('+')
  const isDown = label.startsWith('-') && label !== '-'
  const color  = isNew ? '#D8649A' : isUp ? '#3FA874' : isDown ? '#C8102E' : 'rgba(248,245,238,0.3)'
  return (
    <span className="font-mono text-xs font-medium" style={{ color, minWidth: '40px', textAlign: 'right' }}>
      {label}
    </span>
  )
}

function AxisBar({ a }: { a: AnalysisResult['rich'] extends infer R ? R extends { axis_scores: infer S } ? S extends Array<infer X> ? X : never : never : never }) {
  const color = AXIS_PALETTE[a.color_hint] ?? '#5C8DE6'
  const prevPct = a.previous != null ? Math.max(0, Math.min(100, a.previous)) : null
  const curPct  = Math.max(0, Math.min(100, a.current))
  return (
    <div className="grid grid-cols-[140px_1fr_auto_auto] items-center gap-3 py-2.5">
      <div className="font-mono text-xs tracking-wide" style={{ color: 'rgba(248,245,238,0.55)' }}>{a.axis}</div>
      <div className="relative h-1.5" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '1px' }}>
        {prevPct !== null && (
          <div className="absolute inset-y-0 left-0" style={{
            width: `${prevPct}%`,
            background: 'rgba(248,245,238,0.1)',
            borderRadius: '1px',
          }} />
        )}
        <div className="absolute inset-y-0 left-0 transition-all duration-700" style={{
          width: `${curPct}%`,
          background: color,
          borderRadius: '1px',
          boxShadow: `0 0 8px ${color}40`,
        }} />
      </div>
      <span className="font-mono text-sm font-medium" style={{ color: 'var(--cream)', minWidth: '30px', textAlign: 'right' }}>
        {a.current}
      </span>
      <DeltaBadge label={a.delta_label} />
    </div>
  )
}

function MetricCard({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="card-navy p-4" style={{ borderRadius: '2px' }}>
      <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--text-label)' }}>{label}</div>
      <div className="font-display font-bold text-2xl mb-1" style={{ color: 'var(--cream)' }}>{value}</div>
      <div className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{sublabel}</div>
    </div>
  )
}

function FindingBox({ title, detail, accent }: { title: string; detail: string; accent: FindingAccent }) {
  const color = ACCENT_PALETTE[accent] ?? '#3FA874'
  return (
    <div className="pl-4 py-3 pr-4 mb-2" style={{
      borderLeft: `2px solid ${color}`,
      background: 'rgba(255,255,255,0.02)',
      borderRadius: '0 2px 2px 0',
    }}>
      <div className="font-mono text-xs font-medium mb-1.5" style={{ color: 'var(--cream)' }}>{title}</div>
      <div className="text-sm font-light" style={{ color: 'rgba(248,245,238,0.6)', lineHeight: 1.65 }}>
        {detail}
      </div>
    </div>
  )
}

// ── Lighthouse breakdown card ──────────────────────────────
function LighthouseCard({ lh, githubOk, liveUrl }: { lh: AnalysisResult['lh']; githubOk: boolean; liveUrl?: string | null }) {
  const psiHref = liveUrl
    ? `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(liveUrl)}&form_factor=mobile`
    : null
  const metrics: Array<{ key: keyof AnalysisResult['lh']; label: string }> = [
    { key: 'performance',   label: 'Performance' },
    { key: 'accessibility', label: 'Accessibility' },
    { key: 'bestPractices', label: 'Best Practices' },
    { key: 'seo',           label: 'SEO' },
  ]
  // -1 sentinel = "not assessed" (PageSpeed couldn't compute this category).
  // Rendered as "N/A" in dim grey; gets neutral treatment in scoring.
  const isNA = (v: number) => v < 0
  const scoreColor = (v: number) => isNA(v) ? 'rgba(248,245,238,0.35)'
    : v >= 90 ? '#00D4AA' : v >= 70 ? '#F0C040' : v >= 50 ? '#D4922A' : v > 0 ? '#C8102E' : 'rgba(248,245,238,0.25)'
  const allZero = metrics.every(m => {
    const v = lh[m.key] as number
    return v === 0 || isNA(v)
  })

  return (
    <div>
      <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
        // LIVE PRODUCT AUDIT
        <span className="ml-2" style={{ color: 'rgba(248,245,238,0.35)' }}>
          Mobile strategy · from the public live URL
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {metrics.map(({ key, label }) => {
          const v = lh[key] as number
          const c = scoreColor(v)
          return (
            <div key={key} className="card-navy p-3" style={{ borderRadius: '2px', borderColor: `${c}33` }}>
              <div className="font-mono text-[10px] tracking-widest mb-1" style={{ color: 'var(--text-label)' }}>
                {label.toUpperCase()}
              </div>
              <div className="flex items-baseline gap-1">
                {isNA(v) ? (
                  <>
                    <span className="font-display font-black text-2xl tabular-nums" style={{ color: c }}>N/A</span>
                    <span className="font-mono text-[10px]" style={{ color: 'rgba(248,245,238,0.3)' }}>not assessed</span>
                  </>
                ) : (
                  <>
                    <span className="font-display font-black text-2xl tabular-nums" style={{ color: c }}>{v}</span>
                    <span className="font-mono text-xs" style={{ color: 'rgba(248,245,238,0.3)' }}>/ 100</span>
                  </>
                )}
              </div>
              <div className="relative mt-2" style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }}>
                <div className="absolute inset-y-0 left-0" style={{
                  width: isNA(v) ? '0%' : `${v}%`,
                  background: isNA(v) ? 'rgba(255,255,255,0.12)' : c,
                  borderRadius: '2px',
                  transition: 'width 400ms',
                }} />
              </div>
            </div>
          )
        })}
      </div>

      {allZero && (
        <div className="mt-2 pl-3 py-2 pr-3 font-mono text-xs"
          style={{ borderLeft: '2px solid #D4922A', background: 'rgba(212,146,42,0.05)', color: 'rgba(248,245,238,0.55)', lineHeight: 1.6 }}>
          The live product audit returned all zeros. Usually this means the live URL timed out, 404'd,
          returned non-HTML content, or the auditor hit a rate limit. Verify the URL opens in an incognito tab
          and re-analyze.
        </div>
      )}

      <div className="mt-3 pt-3 flex items-center justify-between gap-3 flex-wrap font-mono text-[10px]"
        style={{ color: 'rgba(248,245,238,0.4)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <span>Repository {githubOk ? '✓ publicly accessible' : '⚠ not accessible (private or wrong URL)'}</span>
        {psiHref && (
          <a href={psiHref} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1"
            style={{ color: 'var(--gold-500)', textDecoration: 'none' }}
            onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
            onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}
            title="Open Google PageSpeed Insights · all audits broken down (incl. every Best Practices check)">
            See every audit on PageSpeed Insights ↗
          </a>
        )}
      </div>
    </div>
  )
}

export function AnalysisResultCard({
  result, onReset, projectId, onReanalyzed, viewerMode = 'owner', seasonPhase, viewerTier = null,
}: {
  result: AnalysisResult
  onReset?: () => void
  projectId?: string
  onReanalyzed?: (next: AnalysisResult) => void
  /**
   * Who's looking? 'owner' gets the full deep-dive (tampering signals, open
   * questions, honest evaluation, discovery panel). 'visitor' sees the public
   * slice only. Defaults to 'owner' for existing callers.
   */
  viewerMode?: 'owner' | 'visitor'
  /**
   * When provided, enforces Week 1 blind rule for visitors — score numbers get
   * swapped for a "BLIND STAGE" tile. Owner view is never blinded.
   */
  seasonPhase?: 'upcoming' | 'week_1' | 'week_2' | 'week_3' | 'applaud' | 'graduation' | 'completed'
  /**
   * Scout tier of the visitor (PRD §9 · §10). Only 'Platinum' gets the full
   * analysis pre-release. Others see the 5-strength / 3-weakness distillation
   * with the last 2 weaknesses locked behind Platinum.
   */
  viewerTier?: ScoutTier | null
}) {
  const navigate = useNavigate()
  const isOwner = viewerMode === 'owner'
  const blindVisitor = !isOwner && (seasonPhase === 'upcoming' || seasonPhase === 'week_1')
  // Platinum Scouts get the same deep view as the creator (PRD §9 full pre-release).
  const hasFullAccess = isOwner || viewerTier === 'Platinum'
  const r = result.rich
  const [rerunBusy, setRerunBusy] = useState(false)
  const [rerunError, setRerunError] = useState<string | null>(null)
  const [githubUrl, setGithubUrl] = useState<string | null>(null)
  const [liveUrl,   setLiveUrl]   = useState<string | null>(null)

  // Fetch the project's GitHub URL once — the Discovery panel needs it to build
  // preview links and fetch raw content at publish time.
  useEffect(() => {
    if (!projectId) { setGithubUrl(null); setLiveUrl(null); return }
    supabase.from('projects').select('github_url, live_url').eq('id', projectId).maybeSingle()
      .then(({ data }) => {
        setGithubUrl(data?.github_url ?? null)
        setLiveUrl(data?.live_url ?? null)
      })
  }, [projectId])

  const handleReanalyze = async () => {
    if (!projectId) return
    setRerunBusy(true); setRerunError(null)
    try {
      const next = await analyzeProject(projectId, 'resubmit')
      // Score may have changed · drop ladder cache so the user sees the
      // updated rank without waiting 30s for TTL.
      void import('../lib/ladder').then(m => m.invalidateLadderCache())
      onReanalyzed?.(next)
      // Scroll to the top so the creator sees the fresh result from the
      // headline down (the modal covered whatever was underneath, so the
      // reveal should land at the top of the project).
      window.setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'auto' })
        document.documentElement.scrollTop = 0
        document.body.scrollTop = 0
      }, 0)
    } catch (e) {
      if (e instanceof CooldownError) {
        setRerunError(`⏳ Re-analysis available in ${e.retryAfterHours}h. The 24-hour cooldown prevents spam.`)
      } else {
        setRerunError(`Re-analysis failed: ${(e as Error).message}`)
      }
    } finally { setRerunBusy(false) }
  }

  // Fallback render: panel evaluation unavailable → minimal score card only.
  if (!r || (!r.tldr && !r.headline && r.axis_scores.length === 0)) {
    return (
      <div className="card-navy p-8" style={{ borderRadius: '2px' }}>
        <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>// EVALUATION (BASIC)</div>
        <div className="font-display font-black text-5xl mb-2" style={{ color: 'var(--cream)' }}>{result.score_total}</div>
        <div className="font-mono text-xs tracking-wide" style={{ color: 'rgba(248,245,238,0.4)' }}>/ 100</div>
        <div className="font-light text-[11px] mt-2" style={{ color: 'rgba(248,245,238,0.35)', lineHeight: 1.5, fontStyle: 'italic' }}>
          It's a snapshot, not a verdict. Code changes; so does this number.
        </div>
        <p className="mt-6 text-sm font-light" style={{ color: 'rgba(248,245,238,0.6)', lineHeight: 1.7 }}>
          Panel deliberation was unavailable for this submission. Only the automated score components are shown.
        </p>
      </div>
    )
  }

  const scoreDelta = r.score.current - r.score.previous_estimate
  const deltaColor = scoreDelta > 0 ? '#3FA874' : scoreDelta < 0 ? '#C8102E' : 'rgba(248,245,238,0.4)'

  return (
    <div className="space-y-8">
      {/* ── HEADLINE ── */}
      <div>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// TL;DR</div>
        <p className="font-display font-bold text-xl md:text-2xl leading-snug mb-4" style={{ color: 'var(--cream)' }}>
          {r.headline}
        </p>
        <p className="text-sm font-light" style={{ color: 'rgba(248,245,238,0.55)', lineHeight: 1.7 }}>
          {r.tldr}
        </p>
      </div>

      {/* ── ROLE TITLE — narrative chip · show transition only when it actually moved ── */}
      {(() => {
        const prev = (r.role_title.previous ?? '').trim()
        const curr = (r.role_title.current  ?? '').trim()
        const changed = prev && curr && prev !== curr
        return (
          <div className="flex flex-wrap items-center gap-3">
            <div className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-label)' }}>
              Role implied by this project
            </div>
            {changed ? (
              <>
                <span className="font-mono text-xs px-3 py-1.5" style={{
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(248,245,238,0.4)', borderRadius: '2px', textDecoration: 'line-through',
                }}>
                  {prev}
                </span>
                <span style={{ color: 'rgba(248,245,238,0.3)' }}>→</span>
                <span className="font-mono text-xs px-3 py-1.5 font-medium" style={{
                  background: 'rgba(240,192,64,0.1)', border: '1px solid rgba(240,192,64,0.35)',
                  color: 'var(--gold-500)', borderRadius: '2px',
                }}>
                  {curr}
                </span>
              </>
            ) : (
              <span className="font-mono text-xs px-3 py-1.5 font-medium" style={{
                background: 'rgba(240,192,64,0.1)', border: '1px solid rgba(240,192,64,0.35)',
                color: 'var(--gold-500)', borderRadius: '2px',
              }}>
                {curr || prev || '—'}
              </span>
            )}
          </div>
        )
      })()}

      {/* ── BLIND-STAGE NOTICE (Week 1 visitor) ── */}
      {blindVisitor && (
        <div className="card-navy p-6 text-center" style={{
          borderRadius: '2px',
          borderColor: 'rgba(240,192,64,0.35)',
          background: 'linear-gradient(135deg, rgba(240,192,64,0.06), rgba(15,32,64,0.5))',
        }}>
          <div className="font-mono text-xs tracking-widest mb-2 inline-flex items-center gap-1.5" style={{ color: 'var(--gold-500)' }}>
            <IconLock size={12} /> BLIND STAGE · WEEK 1
          </div>
          <div className="font-display font-bold text-lg mb-1" style={{ color: 'var(--cream)' }}>
            Scores are hidden to the public this week.
          </div>
          <p className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
            Percentile band opens on Day 8 · concrete scores on Day 15.
            The creator can still iterate without public pressure.
          </p>
        </div>
      )}

      {/* ── SCORE + METRIC CARDS (hidden from visitors on Week 1) ── */}
      {!blindVisitor && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="card-navy p-4" style={{ borderRadius: '2px', borderColor: 'rgba(240,192,64,0.2)' }}>
            <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--text-label)' }}>OVERALL SCORE</div>
            <div className="flex items-baseline gap-2 mb-1">
              {scoreDelta !== 0 && (
                <>
                  <span className="font-display font-light text-2xl" style={{ color: 'rgba(248,245,238,0.35)', textDecoration: 'line-through' }}>
                    {r.score.previous_estimate}
                  </span>
                  <span style={{ color: 'rgba(248,245,238,0.3)' }}>→</span>
                </>
              )}
              <span className="font-display font-black text-3xl" style={{ color: 'var(--gold-500)' }}>
                {r.score.current}
              </span>
              <span className="font-mono text-xs" style={{ color: 'rgba(248,245,238,0.35)' }}>/ 100</span>
            </div>
            <div className="font-mono text-xs" style={{ color: deltaColor }}>
              {scoreDelta === 0
                ? 'initial snapshot'
                : `${scoreDelta > 0 ? '+' : ''}${scoreDelta} pts ${scoreDelta > 0 ? 'up' : 'down'} from last analysis`}
            </div>
            {/* Snapshot disclaimer · sets expectation that the number is
                a checkpoint, not a verdict. See /rulebook §10. */}
            <div className="font-light text-[11px] mt-1.5" style={{ color: 'rgba(248,245,238,0.35)', lineHeight: 1.5, fontStyle: 'italic' }}>
              It's a snapshot, not a verdict. Code changes; so does this number.
            </div>
          </div>
          {r.headline_metrics.slice(0, 3).map((m, i) => (
            <MetricCard key={i} {...m} />
          ))}
        </div>
      )}

      {/* ── AXIS BARS (hidden from visitors on Week 1) ── */}
      {!blindVisitor && (
        <div>
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>
            // SCORES BY AXIS <span style={{ color: 'rgba(248,245,238,0.3)' }}>(gray = previous, color = current)</span>
          </div>
          <div>
            {r.axis_scores.map((a, i) => <AxisBar key={i} a={a} />)}
          </div>
        </div>
      )}

      {/* ── LIGHTHOUSE & LIVE HEALTH (hidden from visitors on Week 1) ── */}
      {!blindVisitor && <LighthouseCard lh={result.lh} githubOk={result.github_ok} liveUrl={liveUrl} />}


      {/* ── SCORE BREAKDOWN LEDGER (v1.7) ──
         Priority: structured breakdown → parsed-from-prose → raw prose fallback. */}
      {(() => {
        if (r.score.breakdown && r.score.breakdown.length > 0) {
          return <ScoreBreakdownLedger breakdown={r.score.breakdown} narrative={r.score.delta_reasoning} />
        }
        const parsed = r.score.delta_reasoning ? parseScoreProse(r.score.delta_reasoning) : null
        if (parsed) {
          return <ScoreBreakdownLedger breakdown={parsed.items} narrative={parsed.narrative ?? undefined} />
        }
        if (r.score.delta_reasoning) {
          return (
            <div className="pl-4 py-3 pr-4" style={{
              borderLeft: '2px solid var(--gold-500)',
              background: 'rgba(240,192,64,0.04)',
            }}>
              <div className="font-mono text-xs tracking-wide mb-1.5" style={{ color: 'var(--gold-500)' }}>HOW WE GOT HERE</div>
              <p className="text-sm font-light" style={{ color: 'rgba(248,245,238,0.7)', lineHeight: 1.7 }}>
                {r.score.delta_reasoning}
              </p>
            </div>
          )
        }
        return null
      })()}

      {/* ── SCOUT BRIEF · 5 strengths + 5 weaknesses (visibility-gated) ── */}
      {!blindVisitor && r.scout_brief && (
        <ScoutBriefSection
          brief={r.scout_brief}
          hasFullAccess={hasFullAccess}
          viewerTier={viewerTier}
          isOwner={isOwner}
        />
      )}

      {/* ── GITHUB FINDINGS (Platinum · owner only) ── */}
      {!blindVisitor && hasFullAccess && r.github_findings.length > 0 && (
        <div>
          <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
            // FACTS VERIFIED FROM THE REPOSITORY
          </div>
          {r.github_findings.map((f, i) => <FindingBox key={i} {...f} />)}
        </div>
      )}

      {/* ── REVIEW PANEL · 4 experts (Platinum · owner only) ── */}
      {!blindVisitor && hasFullAccess && r.expert_panel && r.expert_panel.length > 0 && (
        <div>
          <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
            // REVIEW PANEL · {r.expert_panel.length} EXPERT{r.expert_panel.length === 1 ? '' : 'S'}
          </div>
          <p className="text-xs font-light mb-4" style={{ color: 'rgba(248,245,238,0.55)', lineHeight: 1.7 }}>
            Same evidence, four lenses. Each reviewer reads the project from their role and issues a short verdict —
            they're allowed to disagree with the numeric score.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {r.expert_panel.map((v, i) => <ExpertCard key={`${v.role}-${i}`} verdict={v} />)}
          </div>
        </div>
      )}

      {/* ── TAMPERING SIGNALS · Platinum · owner only ── */}
      {hasFullAccess && r.tampering_signals && r.tampering_signals.length > 0 && (
        <div>
          <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--scarlet)' }}>
            // EVIDENCE INTEGRITY · {r.tampering_signals.length} SIGNAL{r.tampering_signals.length === 1 ? '' : 'S'}
          </div>
          <div className="card-navy p-4 mb-2" style={{ borderRadius: '2px', borderColor: 'rgba(200,16,46,0.35)', background: 'rgba(200,16,46,0.04)' }}>
            <p className="text-xs font-light mb-3" style={{ color: 'rgba(248,245,238,0.65)', lineHeight: 1.65 }}>
              Divergences detected between the Build Brief claims and the GitHub ground truth. These reduced the
              current score. If you believe the signals are wrong, regenerate the brief with your AI after
              syncing the codebase.
            </p>
            {r.tampering_signals.map((t, i) => {
              const color = t.severity === 'high' ? 'var(--scarlet)' : t.severity === 'medium' ? '#D4922A' : '#5C8DE6'
              return (
                <div key={i} className="pl-3 py-2 pr-3 mb-2 last:mb-0" style={{
                  borderLeft: `2px solid ${color}`,
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '0 2px 2px 0',
                }}>
                  <div className="flex items-start gap-2 mb-1">
                    <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5" style={{
                      background: `${color}22`, color, border: `1px solid ${color}44`, borderRadius: '1px',
                    }}>{t.severity}</span>
                    <span className="font-mono text-xs font-medium" style={{ color: 'var(--cream)' }}>{t.signal}</span>
                  </div>
                  <div className="text-xs font-light" style={{ color: 'rgba(248,245,238,0.6)', lineHeight: 1.6, paddingLeft: '2px' }}>
                    {t.detail}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── OPEN QUESTIONS · Platinum · owner only ── */}
      {hasFullAccess && r.open_questions.length > 0 && (
        <div>
          <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
            // OPEN QUESTIONS
          </div>
          {r.open_questions.map((q, i) => (
            <FindingBox key={i} title={q.title} detail={q.detail} accent="amber" />
          ))}
        </div>
      )}

      {/* ── HONEST EVALUATION · Platinum · owner only · collapsible (v1.7) ── */}
      {hasFullAccess && r.honest_evaluation && (
        <HonestEvaluationSection prose={r.honest_evaluation} />
      )}

      {/* ── SCORE DELTA (v1.3 Re-analysis loop) ── */}
      {result.score_total_delta !== null && result.score_total_delta !== undefined && (
        <div
          className="pl-4 py-3 pr-4"
          style={{
            borderLeft: `2px solid ${result.score_total_delta > 0 ? '#3FA874' : result.score_total_delta < 0 ? '#C8102E' : 'rgba(248,245,238,0.3)'}`,
            background: result.score_total_delta > 0 ? 'rgba(63,168,116,0.05)' : result.score_total_delta < 0 ? 'rgba(200,16,46,0.05)' : 'rgba(255,255,255,0.02)',
          }}
        >
          <div className="font-mono text-xs tracking-wide mb-1" style={{ color: 'rgba(248,245,238,0.5)' }}>
            CHANGE FROM PREVIOUS ANALYSIS
          </div>
          <div className="flex items-baseline gap-3">
            <span className="font-display font-black text-2xl" style={{
              color: result.score_total_delta > 0 ? '#3FA874' : result.score_total_delta < 0 ? '#C8102E' : 'rgba(248,245,238,0.5)',
            }}>
              {result.score_total_delta > 0 ? '+' : ''}{result.score_total_delta}
            </span>
            <span className="font-mono text-xs" style={{ color: 'rgba(248,245,238,0.4)' }}>total points</span>
          </div>
          {result.delta_from_parent && Object.keys(result.delta_from_parent).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(result.delta_from_parent).map(([axis, d]) => (
                <span key={axis} className="font-mono text-xs px-2 py-0.5" style={{
                  background: 'rgba(255,255,255,0.04)',
                  color: d > 0 ? '#3FA874' : d < 0 ? '#C8102E' : 'rgba(248,245,238,0.4)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px',
                }}>
                  {axis} {d > 0 ? '+' : ''}{d}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ACTIONS ── */}
      <div className="pt-4 flex flex-wrap gap-3">
        {onReset && projectId && (
          <button
            onClick={() => navigate(`/projects/${projectId}`)}
            className="font-mono text-xs font-medium tracking-wide px-4 py-2"
            style={{
              background: 'var(--gold-500)',
              color: 'var(--navy-900)',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer',
            }}
          >
            VIEW ON PROJECT PAGE →
          </button>
        )}
        {projectId && onReanalyzed && (
          <button
            onClick={handleReanalyze}
            disabled={rerunBusy}
            className="font-mono text-xs tracking-wide px-4 py-2"
            style={{
              background: rerunBusy ? 'rgba(240,192,64,0.15)' : 'rgba(240,192,64,0.1)',
              border: '1px solid rgba(240,192,64,0.35)',
              color: 'var(--gold-500)', borderRadius: '2px',
              cursor: rerunBusy ? 'not-allowed' : 'pointer',
            }}
          >
            {rerunBusy ? '⏳ RE-ANALYZING (60–120s)…' : '🔁 RE-ANALYZE (24h cooldown)'}
          </button>
        )}
        {onReset && (
          <button
            onClick={onReset}
            className="font-mono text-xs tracking-wide px-4 py-2"
            style={{
              background: 'none',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(248,245,238,0.5)',
              borderRadius: '2px',
              cursor: 'pointer',
            }}
          >
            Apply with another project ↻
          </button>
        )}
      </div>

      {rerunError && (
        <div className="pl-3 py-2 pr-3 font-mono text-xs" style={{
          borderLeft: '2px solid var(--scarlet)',
          background: 'rgba(200,16,46,0.05)',
          color: 'rgba(248,120,113,0.85)',
          lineHeight: 1.6,
        }}>
          {rerunError}
        </div>
      )}

      {/* v1.4 §15.6 — Library-worthy files suggested from this analysis · owner only */}
      {isOwner && projectId && <DiscoveryPanel projectId={projectId} githubUrl={githubUrl} />}

      {/* Re-analyze progress overlay · shared modal */}
      <AnalysisProgressModal
        open={rerunBusy}
        variant="reanalyze"
        completed={false}
      />
    </div>
  )
}

// ── Honest Evaluation · collapsible (v1.7) ──────────────────
// The long-form review used to dump 4-5 paragraphs into the page. Now it
// stays collapsed by default; Creator/Platinum expands for the full read.
function HonestEvaluationSection({ prose }: { prose: string }) {
  const [open, setOpen] = useState(false)
  const paras = prose.split(/\n\n+/).filter(Boolean)
  const wordCount = prose.split(/\s+/).filter(Boolean).length
  return (
    <div className="card-navy" style={{ borderRadius: '2px' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            HONEST EVALUATION
          </div>
          <div className="font-light text-xs mt-0.5" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Full long-form review · {paras.length} paragraph{paras.length === 1 ? '' : 's'} · {wordCount} words
          </div>
        </div>
        <span className="font-mono text-sm flex-shrink-0" style={{ color: 'var(--gold-500)' }}>
          {open ? 'Collapse ▲' : 'Read full review ▼'}
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-0"
          style={{ borderTop: '1px solid rgba(240,192,64,0.1)' }}>
          <div className="prose-custom text-sm font-light pt-4"
            style={{ color: 'rgba(248,245,238,0.75)', lineHeight: 1.85 }}>
            {paras.map((para, i) => (
              <p key={i} className="mb-4">{para}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Prose → breakdown parser (v1.7 fallback) ────────────────
// Older snapshots have `score.delta_reasoning` as a single paragraph like:
//   "Baseline 72 (auto 36 × 2). +4 RLS enforced. -5 Lighthouse Performance 56.
//    = 76. Score dropped -2 from 78 because nothing shipped."
// Parse that into the same ledger shape the new prompt emits directly, so the
// UI stays consistent. Returns null when nothing parseable is found.

function parseScoreProse(
  prose: string,
): { items: ScoreBreakdownItem[]; narrative: string | null } | null {
  // Split on period boundaries while keeping leading markers attached.
  const sentences = prose
    .split(/\.\s+(?=[A-Z+\-=])|\.\s*$/)
    .map(s => s.trim())
    .filter(Boolean)

  const items: ScoreBreakdownItem[] = []
  const narrativeParts: string[] = []
  let finalPoints: number | null = null

  const stripTrailingDot = (s: string) => s.replace(/[.,]+$/, '').trim()

  for (const raw of sentences) {
    // Strip leading "Deductions:" marker if present
    const s = raw.replace(/^Deductions:\s*/i, '').trim()

    // Baseline N  · Baseline N (auto 36 × 2)
    let m = s.match(/^Baseline\s+(\d+)(\s*\([^)]+\))?/i)
    if (m) {
      items.push({
        kind: 'baseline',
        points: parseInt(m[1]),
        label: 'Auto baseline' + (m[2] ? ' ' + m[2].trim() : ''),
      })
      continue
    }

    // +N label …
    m = s.match(/^\+(\d+)\s+(.+)$/)
    if (m) {
      items.push({ kind: 'plus', points: parseInt(m[1]), label: stripTrailingDot(m[2]) })
      continue
    }

    // -N label …
    m = s.match(/^-(\d+)\s+(.+)$/)
    if (m) {
      items.push({ kind: 'minus', points: -parseInt(m[1]), label: stripTrailingDot(m[2]) })
      continue
    }

    // = N (subtotal / final — last one wins)
    m = s.match(/^=\s*(\d+)/)
    if (m) { finalPoints = parseInt(m[1]); continue }

    // Anything else is narrative glue
    narrativeParts.push(stripTrailingDot(raw))
  }

  if (finalPoints !== null) {
    items.push({ kind: 'final', points: finalPoints, label: 'Score.current' })
  }

  // Parse only useful if we have a baseline + at least one adjustment + a final.
  const hasBase  = items.some(i => i.kind === 'baseline')
  const hasFinal = items.some(i => i.kind === 'final')
  const adjusts  = items.filter(i => i.kind === 'plus' || i.kind === 'minus')
  if (!hasBase || !hasFinal || adjusts.length === 0) return null

  return {
    items,
    narrative: narrativeParts.length ? narrativeParts.join('. ').trim() : null,
  }
}

// ── Score breakdown ledger (v1.7) ───────────────────────────
// Renders Claude's arithmetic as a vertical ledger instead of a dense prose
// paragraph. Makes "why the score is what it is" scannable at a glance.

function ScoreBreakdownLedger({
  breakdown, narrative,
}: {
  breakdown: ScoreBreakdownItem[]
  narrative?: string
}) {
  // Running total for display
  let running: number | null = null
  return (
    <div className="card-navy" style={{ borderRadius: '2px' }}>
      <div className="px-5 pt-5 pb-3 flex items-baseline justify-between flex-wrap gap-2"
        style={{ borderBottom: '1px solid rgba(240,192,64,0.1)' }}>
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            HOW WE GOT HERE
          </div>
          <div className="font-light text-xs mt-0.5" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Claude's arithmetic · each row is an evidence-backed adjustment from the auto baseline.
          </div>
        </div>
      </div>

      <ul className="px-5 py-4 space-y-1.5">
        {breakdown.map((b, i) => {
          const isBaseline = b.kind === 'baseline'
          const isFinal    = b.kind === 'final'
          const isPlus     = b.kind === 'plus'
          const isMinus    = b.kind === 'minus'
          if (isBaseline) running = b.points
          else if (isPlus || isMinus) running = (running ?? 0) + b.points
          else if (isFinal) running = b.points

          const chipColor = isBaseline ? '#F0C040'
                          : isFinal    ? '#00D4AA'
                          : isPlus     ? '#3FA874'
                          :              '#F88771'
          const chipBg = isBaseline ? 'rgba(240,192,64,0.12)'
                        : isFinal    ? 'rgba(0,212,170,0.15)'
                        : isPlus     ? 'rgba(63,168,116,0.12)'
                        :              'rgba(248,120,113,0.12)'
          const prefix = isPlus ? '+' : isMinus ? '' : ''   // minus already carries -

          return (
            <li key={i} className="grid items-start gap-3" style={{ gridTemplateColumns: '56px 1fr 48px' }}>
              <span className="font-mono text-xs tabular-nums font-bold text-center px-1.5 py-1" style={{
                background: chipBg,
                color: chipColor,
                border: `1px solid ${chipColor}44`,
                borderRadius: '2px',
              }}>
                {isBaseline ? 'BASE' : isFinal ? 'FINAL' : `${prefix}${b.points}`}
              </span>
              <div className="min-w-0 py-0.5">
                <div className="font-mono text-xs" style={{
                  color: isFinal ? 'var(--cream)' : 'var(--text-primary)',
                  fontWeight: isFinal || isBaseline ? 600 : 400,
                }}>
                  {b.label}
                </div>
                {b.evidence && (
                  <div className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
                    {b.evidence}
                  </div>
                )}
              </div>
              <span className="font-mono text-xs tabular-nums text-right pt-1" style={{
                color: isFinal ? 'var(--cream)' : 'var(--text-muted)',
                fontWeight: isFinal ? 700 : 400,
              }}>
                {running ?? ''}
              </span>
            </li>
          )
        })}
      </ul>

      {narrative && (
        <div className="px-5 pb-5 pt-0">
          <div className="pl-3 pr-3 py-2 font-mono text-[11px]" style={{
            borderLeft: '2px solid rgba(240,192,64,0.4)',
            background: 'rgba(240,192,64,0.04)',
            color: 'var(--text-secondary)',
            lineHeight: 1.7,
          }}>
            {narrative}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Scout Brief section (v1.6.1) ───────────────────────────
// Asymmetric visibility: everyone who passes the blind rule sees all 5
// strengths + first 3 weaknesses. Positions 4-5 in weaknesses are locked
// behind Platinum (PRD §9). Owner always sees everything.

const SCOUT_VISIBLE_WEAKNESSES = 3

function ScoutBriefSection({
  brief, hasFullAccess, viewerTier, isOwner,
}: {
  brief: { strengths: ScoutBriefBullet[]; weaknesses: ScoutBriefBullet[] }
  hasFullAccess: boolean
  viewerTier: ScoutTier | null
  isOwner: boolean
}) {
  const strengths = brief.strengths ?? []
  const allWeaknesses = brief.weaknesses ?? []
  const visibleWeaknesses = hasFullAccess ? allWeaknesses : allWeaknesses.slice(0, SCOUT_VISIBLE_WEAKNESSES)
  const hiddenCount = Math.max(0, allWeaknesses.length - visibleWeaknesses.length)

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
          // SCOUT BRIEF · {strengths.length}+{allWeaknesses.length}
        </div>
        {!hasFullAccess && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Tier: <span style={{ color: 'var(--cream)' }}>{viewerTier ?? 'Guest'}</span> · full view at Platinum
          </span>
        )}
      </div>
      <p className="text-xs font-light mb-4" style={{ color: 'rgba(248,245,238,0.55)', lineHeight: 1.7 }}>
        {isOwner
          ? 'The same 5-and-5 distillation Scouts use to forecast — useful for you to see what signal they get.'
          : 'Ten bullets distilled from the full audit. Scout this before you forecast.'}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ScoutBulletColumn
          label="STRENGTHS"
          glyph="+"
          accent="#3FA874"
          bullets={strengths}
        />
        <ScoutBulletColumn
          label="WEAKNESSES"
          glyph="−"
          accent="#C8102E"
          bullets={visibleWeaknesses}
          lockedCount={hiddenCount}
        />
      </div>
    </div>
  )
}

function ScoutBulletColumn({
  label, glyph, accent, bullets, lockedCount = 0,
}: {
  label: string
  glyph: string
  accent: string
  bullets: ScoutBriefBullet[]
  lockedCount?: number
}) {
  return (
    <div className="pl-3 pr-3 py-3" style={{
      borderLeft: `2px solid ${accent}`,
      background: 'rgba(255,255,255,0.02)',
      borderRadius: '0 2px 2px 0',
    }}>
      <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: accent }}>
        {label} · {bullets.length + lockedCount}
      </div>
      <ul className="space-y-2">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2 text-xs font-light" style={{ lineHeight: 1.55 }}>
            <span className="font-mono font-bold flex-shrink-0" style={{ color: accent, width: 12 }}>{glyph}</span>
            <span className="flex-1 min-w-0">
              <span className="font-mono text-[10px] tracking-wider mr-1.5" style={{ color: accent, opacity: 0.8 }}>
                [{b.axis}]
              </span>
              <span style={{ color: 'rgba(248,245,238,0.78)' }}>{b.bullet}</span>
            </span>
          </li>
        ))}
      </ul>
      {lockedCount > 0 && (
        <div className="mt-3 pl-2 pr-2 py-2" style={{
          background: 'rgba(240,192,64,0.04)',
          border: '1px dashed rgba(240,192,64,0.3)',
          borderRadius: '2px',
        }}>
          <div className="font-mono text-[11px] tracking-wide inline-flex items-center gap-1.5" style={{ color: 'var(--gold-500)' }}>
            <IconLock size={11} /> {lockedCount} more weakness{lockedCount === 1 ? '' : 'es'} · unlock at Platinum
          </div>
          <div className="font-mono text-[10px] mt-1" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Platinum Scouts (5000+ AP) read the full audit before anyone else. Earn AP by forecasting and applauding.
          </div>
        </div>
      )}
    </div>
  )
}

// ── Expert panel helpers (v1.6) ────────────────────────────

const ROLE_ACCENT: Record<ExpertRole, string> = {
  staff_engineer:   '#5C8DE6',
  security_officer: '#C8102E',
  designer:         '#D8649A',
  ceo:              '#F0C040',
}

const VERDICT_META: Record<ExpertVerdictLabel, { label: string; color: string; bg: string }> = {
  ship:    { label: 'SHIP',    color: '#3FA874', bg: 'rgba(63,168,116,0.12)' },
  iterate: { label: 'ITERATE', color: '#D4922A', bg: 'rgba(212,146,42,0.12)' },
  block:   { label: 'BLOCK',   color: '#C8102E', bg: 'rgba(200,16,46,0.12)' },
}

function ExpertCard({ verdict: v }: { verdict: ExpertVerdict }) {
  const roleAccent = ROLE_ACCENT[v.role] ?? 'rgba(248,245,238,0.4)'
  const verdict = VERDICT_META[v.verdict_label] ?? VERDICT_META.iterate
  return (
    <div className="pl-3 pr-3 py-3" style={{
      borderLeft: `2px solid ${roleAccent}`,
      background: 'rgba(255,255,255,0.02)',
      borderRadius: '0 2px 2px 0',
    }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-shrink-0" style={{ color: roleAccent }}>
            <RoleIcon role={v.role} size={16} />
          </span>
          <span className="font-mono text-xs tracking-wide truncate" style={{ color: 'var(--cream)' }}>
            {v.display_name}
          </span>
        </div>
        <span className="font-mono text-[10px] font-bold tracking-wider px-1.5 py-0.5 flex-shrink-0" style={{
          background: verdict.bg,
          color: verdict.color,
          border: `1px solid ${verdict.color}44`,
          borderRadius: '1px',
        }}>
          {verdict.label}
        </span>
      </div>
      <p className="text-xs font-light mb-2" style={{ color: 'rgba(248,245,238,0.78)', lineHeight: 1.6 }}>
        {v.verdict_summary}
      </p>
      <div className="space-y-1 font-mono text-[11px]" style={{ lineHeight: 1.55 }}>
        <div>
          <span style={{ color: '#3FA874' }}>+ </span>
          <span style={{ color: 'rgba(248,245,238,0.7)' }}>{v.top_strength}</span>
        </div>
        <div>
          <span style={{ color: '#C8102E' }}>− </span>
          <span style={{ color: 'rgba(248,245,238,0.7)' }}>{v.top_issue}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px]" style={{ color: 'rgba(248,245,238,0.4)' }}>
        <span>CONFIDENCE</span>
        <div className="flex-1 h-1" style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '1px' }}>
          <div style={{
            width: `${Math.max(0, Math.min(10, v.confidence)) * 10}%`,
            height: '100%',
            background: roleAccent,
            borderRadius: '1px',
          }} />
        </div>
        <span style={{ color: 'rgba(248,245,238,0.6)' }}>{v.confidence}/10</span>
      </div>
    </div>
  )
}
