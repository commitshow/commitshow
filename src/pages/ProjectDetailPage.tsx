import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Project } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import {
  fetchProjectById,
  fetchProjectTimeline,
  fetchProjectForecasts,
  fetchProjectApplauds,
  fetchProjectCreator,
  type TimelinePoint,
  type ForecastRow,
  type ApplaudRow,
  type CreatorIdentity,
} from '../lib/projectQueries'
import type { AnalysisResult } from '../lib/analysis'
import { AnalysisResultCard } from '../components/AnalysisResultCard'
import { ScoreTimeline } from '../components/ScoreTimeline'
import { ForecastModal } from '../components/ForecastModal'
import { ApplaudModal } from '../components/ApplaudModal'
import { EditProjectModal } from '../components/EditProjectModal'
import { IconForecast, IconApplaud } from '../components/icons'
import { fetchAuditionStreak } from '../lib/auditionStreak'
import { OwnerBriefPanel } from '../components/OwnerBriefPanel'
import { GraduationChecklist } from '../components/GraduationChecklist'
import { useAuth } from '../lib/auth'
import { computeSeasonProgress, loadCurrentSeason } from '../lib/season'
import type { Season } from '../lib/supabase'
import type { SeasonPhase, SeasonProgress } from '../lib/season'

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, member } = useAuth()

  const [project, setProject] = useState<Project | null>(null)
  const [snapshotResult, setSnapshotResult] = useState<AnalysisResult | null>(null)
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [forecasts, setForecasts] = useState<ForecastRow[]>([])
  const [applauds, setApplauds] = useState<ApplaudRow[]>([])
  const [loading, setLoading] = useState(true)
  const [forecastOpen, setForecastOpen] = useState(false)
  const [applaudOpen, setApplaudOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [streakClimbs, setStreakClimbs] = useState(0)
  const [notFound, setNotFound] = useState(false)
  const [seasonPhase, setSeasonPhase] = useState<SeasonPhase | undefined>(undefined)
  const [seasonProgress, setSeasonProgress] = useState<SeasonProgress | null>(null)
  const [creator, setCreator] = useState<CreatorIdentity | null>(null)
  const [activeSection, setActiveSection] = useState<string>('overview')
  const [descExpanded, setDescExpanded] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setNotFound(false)
    ;(async () => {
      const proj = await fetchProjectById(id)
      if (!proj) { setNotFound(true); setLoading(false); return }
      setProject(proj)

      // Resolve the current season so we can enforce blind-stage rules for
      // visitors (Week 1 hides scores per CLAUDE.md §11).
      loadCurrentSeason().then((s: Season | null) => {
        if (!s) return
        const p = computeSeasonProgress(s)
        setSeasonPhase(p.phase)
        setSeasonProgress(p)
      })

      // Creator identity — current display_name + avatar from members table
      // (may diverge from project.creator_name which was stored at submission).
      if (proj.creator_id) fetchProjectCreator(proj.creator_id).then(setCreator)

      const [{ data: latest }, tlPts, fcRows, apRows] = await Promise.all([
        supabase
          .from('analysis_snapshots')
          .select('id, score_auto, score_total, score_total_delta, delta_from_parent, rich_analysis, lighthouse, github_signals, trigger_type, created_at')
          .eq('project_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        fetchProjectTimeline(id),
        fetchProjectForecasts(id),
        fetchProjectApplauds(id),
      ])

      if (latest) {
        const lhRaw = (latest.lighthouse ?? {}) as { performance?: number; accessibility?: number; bestPractices?: number; seo?: number }
        setSnapshotResult({
          score_auto:        latest.score_auto ?? 0,
          score_forecast:    proj.score_forecast ?? 0,
          score_community:   proj.score_community ?? 0,
          score_total:       latest.score_total ?? proj.score_total ?? 0,
          score_total_delta: latest.score_total_delta ?? null,
          delta_from_parent: latest.delta_from_parent ?? null,
          creator_grade:     proj.creator_grade,
          verdict:           proj.verdict ?? '',
          insight:           proj.claude_insight ?? '',
          tech_layers:       proj.tech_layers ?? [],
          graduation_ready:  (latest.score_total ?? 0) >= 75,
          unlock_level:      0,
          lh: {
            performance:   lhRaw.performance ?? 0,
            accessibility: lhRaw.accessibility ?? 0,
            bestPractices: lhRaw.bestPractices ?? 0,
            seo:           lhRaw.seo ?? 0,
          },
          github_ok:  proj.github_accessible,
          rich:       (latest.rich_analysis as AnalysisResult['rich']) ?? null,
        })
      }
      setTimeline(tlPts)
      setForecasts(fcRows)
      setApplauds(apRows)
      if (proj.creator_id) {
        fetchAuditionStreak(proj.creator_id).then(s => setStreakClimbs(s.climbs)).catch(() => {})
      }
      setLoading(false)
    })()
  }, [id])

  // Scroll-spy · highlight the section nav chip that matches the viewport
  useEffect(() => {
    if (loading) return
    const ids = ['overview', 'analysis', 'activity', 'brief']
    const observer = new IntersectionObserver(
      entries => {
        // Pick the most-visible intersecting section; fall back to first hit
        const visible = entries.filter(e => e.isIntersecting)
        if (visible.length === 0) return
        const best = visible.reduce((a, b) =>
          (a.intersectionRatio >= b.intersectionRatio ? a : b))
        const id = (best.target as HTMLElement).id
        if (id) setActiveSection(id)
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
    )
    ids.forEach(id => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [loading])

  if (loading) {
    return (
      <div className="pt-24 pb-16 px-6 text-center font-mono text-sm" style={{ color: 'rgba(248,245,238,0.35)', minHeight: '100vh' }}>
        Loading project…
      </div>
    )
  }
  if (notFound || !project) {
    return (
      <div className="pt-24 pb-16 px-6 text-center min-h-[60vh]">
        <div className="font-display font-bold text-2xl mb-2" style={{ color: 'var(--cream)' }}>Project not found</div>
        <p className="font-mono text-xs mb-6" style={{ color: 'rgba(248,245,238,0.4)' }}>It may have been removed or the URL is wrong.</p>
        <button
          onClick={() => navigate('/projects')}
          className="px-5 py-2 font-mono text-xs tracking-wide"
          style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
        >
          BACK TO PROJECTS
        </button>
      </div>
    )
  }

  const canForecast = !!user && user.id !== project.creator_id
  const isOwner     = !!user && user.id === project.creator_id

  // ── Section nav config (order = scroll order) ───────────────
  const sections: Array<{ id: string; label: string; ownerOnly?: boolean }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'analysis', label: 'Analysis' },
    { id: 'activity', label: 'Activity' },
  ]
  if (isOwner) sections.push({ id: 'brief', label: 'Private brief', ownerOnly: true })

  // Audition delta badge · latest round change (reused in hero + scan strip)
  const latestSnap = timeline[timeline.length - 1]
  const roundDelta = latestSnap?.score_total_delta ?? null
  const roundCount = timeline.length

  return (
    <section className="relative z-10 pt-20 pb-16 px-6 min-h-screen">
      <div className="max-w-5xl mx-auto">
        {/* Back link */}
        <button
          onClick={() => navigate('/projects')}
          className="mb-5 font-mono text-xs tracking-wide"
          style={{ background: 'transparent', color: 'rgba(248,245,238,0.5)', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,245,238,0.5)')}
        >
          ← BACK TO PROJECTS
        </button>

        {/* ── Compact Hero (description moved to Overview pullquote) ── */}
        <header className="card-navy overflow-hidden mb-4 relative" style={{ borderRadius: '2px' }}>
          {isOwner && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="absolute top-3 right-3 z-10 font-mono text-[11px] tracking-wide px-3 py-1.5"
              style={{
                background: 'rgba(6,12,26,0.8)',
                color: 'var(--gold-500)',
                border: '1px solid rgba(240,192,64,0.4)',
                borderRadius: '2px',
                cursor: 'pointer',
                backdropFilter: 'blur(4px)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--gold-500)'; e.currentTarget.style.color = 'var(--navy-900)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(6,12,26,0.8)'; e.currentTarget.style.color = 'var(--gold-500)' }}
            >
              EDIT
            </button>
          )}
          <div className="grid grid-cols-1 md:grid-cols-[260px_1fr]">
            <div style={{ aspectRatio: '3 / 2', background: 'var(--navy-800)', overflow: 'hidden' }}>
              {project.thumbnail_url ? (
                <img src={project.thumbnail_url} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-mono text-xs" style={{ color: 'rgba(248,245,238,0.25)' }}>NO IMAGE</div>
              )}
            </div>
            <div className="p-6 flex flex-col gap-4 justify-between">
              <div>
                <div className="font-mono text-[10px] tracking-widest mb-2 flex items-center gap-2 flex-wrap" style={{ color: 'var(--gold-500)' }}>
                  <span>PROJECT · {(project.status === 'retry' ? 'ROOKIE CIRCLE' : project.status.toUpperCase())}</span>
                  {streakClimbs >= 2 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 tracking-wider" style={{
                      background: 'rgba(248,146,42,0.14)',
                      color: '#F0C040',
                      border: '1px solid rgba(240,192,64,0.45)',
                      borderRadius: '2px',
                      fontSize: '10px',
                      boxShadow: streakClimbs >= 3 ? '0 0 10px rgba(240,192,64,0.35)' : undefined,
                    }}
                    title={`${streakClimbs} consecutive round climbs — auditioning on fire`}>
                      ON FIRE · {streakClimbs}R STREAK
                    </span>
                  )}
                </div>
                <h1 className="font-display font-black text-3xl md:text-4xl leading-tight mb-2" style={{ color: 'var(--cream)', letterSpacing: '-0.01em' }}>
                  {project.project_name}
                </h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  {creator && (
                    <div className="flex items-center gap-2">
                      <div
                        className="flex items-center justify-center font-mono text-xs font-bold overflow-hidden"
                        style={{
                          width: '24px', height: '24px',
                          background: creator.avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
                          color: 'var(--navy-900)',
                          border: '1px solid rgba(240,192,64,0.3)',
                          borderRadius: '2px',
                        }}
                      >
                        {creator.avatar_url ? (
                          <img src={creator.avatar_url} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
                        ) : (
                          (creator.display_name ?? project.creator_name ?? '?').slice(0, 1).toUpperCase()
                        )}
                      </div>
                      <div className="font-mono text-xs" style={{ color: 'var(--cream)' }}>
                        by <strong>{creator.display_name || project.creator_name || 'Anonymous'}</strong>
                      </div>
                    </div>
                  )}
                  <span
                    className="font-mono text-[11px]"
                    title="Creator career grade — based on cumulative graduations (§8)."
                    style={{ color: 'var(--gold-500)' }}
                  >
                    · {project.creator_grade}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {project.live_url && (
                  <a href={project.live_url} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-xs tracking-wide px-3 py-1.5"
                    style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', textDecoration: 'none' }}>
                    OPEN LIVE ↗
                  </a>
                )}
                {isOwner && project.github_url && (
                  <a href={project.github_url} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-xs tracking-wide px-3 py-1.5"
                    style={{ background: 'transparent', color: 'rgba(248,245,238,0.7)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '2px', textDecoration: 'none' }}>
                    GITHUB ↗
                  </a>
                )}
                {canForecast && seasonPhase !== 'applaud' && (
                  <button
                    onClick={() => setForecastOpen(true)}
                    className="font-mono text-xs font-medium tracking-wide px-3 py-1.5"
                    style={{ background: 'rgba(240,192,64,0.08)', color: 'var(--gold-500)', border: '1px solid rgba(240,192,64,0.3)', borderRadius: '2px', cursor: 'pointer' }}
                  >
                    <span className="inline-flex items-center justify-center gap-1.5"><IconForecast size={12} /> FORECAST</span>
                  </button>
                )}
                {canForecast && seasonPhase === 'applaud' && (
                  <button
                    onClick={() => setApplaudOpen(true)}
                    className="font-mono text-xs font-medium tracking-wide px-3 py-1.5"
                    style={{ background: 'rgba(167,139,250,0.08)', color: '#A78BFA', border: '1px solid rgba(167,139,250,0.35)', borderRadius: '2px', cursor: 'pointer' }}
                    title="Craft Award · Applaud Week (post-season)"
                  >
                    <span className="inline-flex items-center justify-center gap-1.5"><IconApplaud size={12} /> CAST CRAFT AWARD</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* ── Scan strip · at-a-glance metrics ── */}
        <ScanStrip
          score={project.score_total}
          roundCount={roundCount}
          roundDelta={roundDelta}
          forecasts={project.score_forecast ?? 0}
          applauds={applauds.length}
          dayNumber={seasonProgress?.dayNumber ?? null}
          totalDays={seasonProgress?.totalDays ?? 28}
          phaseLabel={seasonProgress?.phaseLabel ?? ''}
        />

        {/* ── Sticky section nav (scroll-spy) ── */}
        <SectionNav
          sections={sections}
          active={activeSection}
          onJump={(id) => {
            const el = document.getElementById(id)
            if (!el) return
            const top = el.getBoundingClientRect().top + window.scrollY - 96
            window.scrollTo({ top, behavior: 'smooth' })
          }}
        />

        {/* ── Sections ──────────────────────────────────────── */}
        <div className="grid gap-10">
          {/* OVERVIEW */}
          <section id="overview" className="scroll-mt-28">
            <SectionHeader label="OVERVIEW" />

            {/* Description pullquote — the hero text now lives here, styled up */}
            {project.description && (
              <DescriptionPullquote
                text={project.description}
                expanded={descExpanded}
                onToggle={() => setDescExpanded(v => !v)}
              />
            )}

            {/* Screenshots (images beyond the hero thumbnail) */}
            {(project.images?.length ?? 0) > 1 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
                {project.images.slice(1).map((img, i) => (
                  <a
                    key={img.path || i}
                    href={img.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden transition-opacity"
                    style={{
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '2px',
                      aspectRatio: '3 / 2',
                      background: 'var(--navy-800)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.4)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
                  >
                    <img src={img.url} alt={`${project.project_name} image ${i + 2}`} loading="lazy" className="w-full h-full" style={{ objectFit: 'cover' }} />
                  </a>
                ))}
              </div>
            )}

            <div className="grid gap-5">
              <GraduationChecklist projectId={project.id} viewerMode={isOwner ? 'owner' : 'visitor'} />
              <ScoreTimeline points={timeline} />
            </div>
          </section>

          {/* ANALYSIS */}
          <section id="analysis" className="scroll-mt-28">
            <SectionHeader
              label="ANALYSIS"
              hint={
                isOwner
                  ? 'Full report · you see everything your scouts see.'
                  : member?.tier === 'Platinum'
                    ? 'Platinum · full report · early access.'
                    : member?.tier === 'Gold'
                      ? 'Gold · security layer early · distilled 5 + 5 brief.'
                      : member?.tier === 'Silver'
                        ? 'Silver · security layer (12 h early) · distilled 5 + 3 brief.'
                        : 'Scout · 5 strengths + 3 key issues. Higher tier = earlier access.'
              }
            />
            {snapshotResult ? (
              <AnalysisResultCard
                result={snapshotResult}
                projectId={isOwner ? project.id : undefined}
                onReanalyzed={isOwner ? (next) => setSnapshotResult(next) : undefined}
                viewerMode={isOwner ? 'owner' : 'visitor'}
                seasonPhase={seasonPhase}
                viewerTier={member?.tier ?? null}
              />
            ) : (
              <EmptyBox label="No analysis yet — awaiting first round." />
            )}
          </section>

          {/* ACTIVITY */}
          <section id="activity" className="scroll-mt-28">
            <SectionHeader label="ACTIVITY" hint="Forecasts and craft-award applauds on this project." />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ActivityList title="FORECASTS" emptyLabel="No forecasts cast yet." accent="var(--gold-500)">
                {forecasts.map(f => (
                  <ActivityRow
                    key={f.id}
                    primary={`${f.scout_tier} Scout`}
                    detail={f.predicted_score != null ? `Forecast ${f.predicted_score}/100` : ''}
                    secondary={f.comment ?? ''}
                    time={f.created_at}
                  />
                ))}
              </ActivityList>

              <ActivityList title="CRAFT AWARD · APPLAUDS" emptyLabel="No applauds yet. Applaud Week opens Day 22." accent="#A78BFA">
                {applauds.map(a => (
                  <ActivityRow
                    key={a.id}
                    primary={`${a.scout_tier} Scout`}
                    detail={`weight ×${a.weight}`}
                    secondary=""
                    time={a.created_at}
                  />
                ))}
              </ActivityList>
            </div>
          </section>

          {/* BRIEF · owner only */}
          {isOwner && (
            <section id="brief" className="scroll-mt-28">
              <SectionHeader label="PRIVATE BRIEF" hint="Only you can see this — editor + integrity score." />
              <OwnerBriefPanel projectId={project.id} />
            </section>
          )}
        </div>
      </div>

      {forecastOpen && (
        <ForecastModal project={project} onClose={() => setForecastOpen(false)} onCast={() => {
          // reload forecasts + project score after cast
          fetchProjectForecasts(project.id).then(setForecasts)
          fetchProjectById(project.id).then(p => p && setProject(p))
        }} />
      )}

      {applaudOpen && (
        <ApplaudModal project={project} onClose={() => setApplaudOpen(false)} onCast={() => {
          fetchProjectApplauds(project.id).then(setApplauds)
        }} />
      )}

      {editOpen && isOwner && (
        <EditProjectModal
          project={project}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => { setProject(updated); setEditOpen(false) }}
        />
      )}
    </section>
  )
}

function ActivityList({ title, emptyLabel, accent, children }: {
  title: string; emptyLabel: string; accent: string; children: React.ReactNode
}) {
  const rows = Array.isArray(children) ? children : [children]
  return (
    <div className="card-navy p-4" style={{ borderRadius: '2px' }}>
      <div className="font-mono text-xs tracking-widest mb-3" style={{ color: accent }}>// {title}</div>
      {rows.length === 0 ? (
        <div className="font-mono text-xs text-center py-6" style={{ color: 'rgba(248,245,238,0.3)' }}>{emptyLabel}</div>
      ) : (
        <ul className="space-y-2 max-h-[400px] overflow-y-auto pr-1">{children}</ul>
      )}
    </div>
  )
}

function ActivityRow({ primary, detail, secondary, time }: {
  primary: string; detail: string; secondary?: string; time: string
}) {
  return (
    <li className="px-3 py-2 font-mono text-xs" style={{
      background: 'rgba(255,255,255,0.015)',
      border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: '2px',
    }}>
      <div className="flex justify-between items-baseline gap-2">
        <span style={{ color: 'var(--cream)' }}>{primary}</span>
        <span style={{ color: 'rgba(248,245,238,0.35)' }}>{new Date(time).toLocaleDateString()}</span>
      </div>
      <div className="text-[11px] mt-0.5" style={{ color: 'rgba(248,245,238,0.55)' }}>{detail}</div>
      {secondary && (
        <div className="text-[11px] mt-1 italic" style={{ color: 'rgba(248,245,238,0.45)' }}>"{secondary}"</div>
      )}
    </li>
  )
}

// ── Scan strip · 5-6 metric pills in one row ────────────────────
function ScanStrip({
  score, roundCount, roundDelta, forecasts, applauds, dayNumber, totalDays, phaseLabel,
}: {
  score: number
  roundCount: number
  roundDelta: number | null
  forecasts: number
  applauds: number
  dayNumber: number | null
  totalDays: number
  phaseLabel: string
}) {
  const scoreColor = score >= 75 ? '#00D4AA' : score >= 50 ? '#F0C040' : '#C8102E'
  const deltaColor = roundDelta == null || roundDelta === 0 ? 'var(--text-muted)'
    : roundDelta > 0 ? '#00D4AA' : '#F88771'
  const deltaText  = roundDelta == null ? '—' : roundDelta === 0 ? '0' : (roundDelta > 0 ? `+${roundDelta}` : `${roundDelta}`)
  return (
    <div
      className="mb-4 grid grid-cols-3 md:grid-cols-6 gap-0 overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '2px',
      }}
    >
      <ScanCell label="Score"     value={`${score}`}                      sub="out of 100"   color={scoreColor} />
      <ScanCell label="Round"     value={roundCount > 0 ? `${roundCount}` : '—'} sub="analyses" color="var(--cream)" />
      <ScanCell label="Δ Round"   value={deltaText}                       sub="vs last round" color={deltaColor} />
      <ScanCell label="Forecasts" value={`${forecasts}`}                  sub="cast"         color="var(--cream)" />
      <ScanCell label="Applauds"  value={`${applauds}`}                   sub="craft award"  color="#A78BFA" />
      <ScanCell label="Season"
        value={dayNumber != null ? `D ${dayNumber}/${totalDays}` : '—'}
        sub={phaseLabel || 'schedule'}
        color="var(--gold-500)"
      />
    </div>
  )
}

function ScanCell({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div
      className="px-3 py-3 flex flex-col items-start justify-center"
      style={{ borderLeft: '1px solid rgba(255,255,255,0.04)' }}
    >
      <div className="font-mono text-[9px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="font-display font-bold text-lg leading-none mt-1 tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="font-mono text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>
        {sub}
      </div>
    </div>
  )
}

// ── Sticky section nav · scroll-spy anchor bar ──────────────────
function SectionNav({
  sections, active, onJump,
}: {
  sections: Array<{ id: string; label: string; ownerOnly?: boolean }>
  active: string
  onJump: (id: string) => void
}) {
  return (
    <div
      className="sticky z-20 mb-8 -mx-6 px-6 py-2.5"
      style={{
        top: '64px',
        background: 'rgba(6,12,26,0.85)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="max-w-5xl mx-auto flex items-center gap-1 overflow-x-auto">
        {sections.map(s => {
          const isActive = active === s.id
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onJump(s.id)}
              className="font-mono text-[11px] tracking-widest uppercase px-3 py-1.5 transition-colors whitespace-nowrap flex items-center gap-1.5"
              style={{
                background: isActive ? 'rgba(240,192,64,0.14)' : 'transparent',
                color:      isActive ? 'var(--gold-500)' : 'var(--text-secondary)',
                border:     `1px solid ${isActive ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: '2px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--cream)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              {s.label}
              {s.ownerOnly && (
                <span className="font-mono text-[9px]" style={{ color: isActive ? 'var(--gold-500)' : 'var(--text-muted)' }}>
                  · you only
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SectionHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-4">
      <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
        // {label}
      </div>
      {hint && (
        <div className="font-mono text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}

// ── Description pullquote · editorial treatment ────────────────
const PULLQUOTE_CLAMP = 220   // chars before the fold
function DescriptionPullquote({ text, expanded, onToggle }: {
  text: string; expanded: boolean; onToggle: () => void
}) {
  const long = text.length > PULLQUOTE_CLAMP
  const shown = !long || expanded ? text : text.slice(0, PULLQUOTE_CLAMP).trimEnd() + '…'
  return (
    <blockquote
      className="mb-6 pl-5 pr-4 py-4"
      style={{
        borderLeft: '3px solid var(--gold-500)',
        background: 'rgba(240,192,64,0.04)',
        borderRadius: '0 2px 2px 0',
      }}
    >
      <p
        className="font-display"
        style={{
          color: 'var(--cream)',
          fontSize: '1.15rem',
          lineHeight: 1.55,
          letterSpacing: '-0.005em',
        }}
      >
        “{shown}”
      </p>
      {long && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-2 font-mono text-[11px] tracking-wide"
          style={{ background: 'transparent', color: 'var(--gold-500)', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {expanded ? 'Show less ↑' : 'Read more ↓'}
        </button>
      )}
    </blockquote>
  )
}

function EmptyBox({ label }: { label: string }) {
  return (
    <div
      className="font-mono text-xs flex items-center justify-center py-10 text-center"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px dashed rgba(255,255,255,0.08)',
        color: 'rgba(248,245,238,0.35)',
        borderRadius: '2px',
      }}
    >
      {label}
    </div>
  )
}
