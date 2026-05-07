import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Project } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { projectSlug, projectShareUrl } from '../lib/projectSlug'
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
import { analyzeProject, CooldownError } from '../lib/analysis'
import { AnalysisResultCard } from '../components/AnalysisResultCard'
import { NotFoundPage } from './NotFoundPage'
import { AnalysisProgressModal } from '../components/AnalysisProgressModal'
import { ScoreTimeline } from '../components/ScoreTimeline'
import { VibeConcernsPanel } from '../components/VibeConcernsPanel'
import { NativeAppPanel, type NativeAppBreakdown, type NativeFootguns } from '../components/NativeAppPanel'
import { ForecastModal } from '../components/ForecastModal'
import { ApplaudButton } from '../components/ApplaudButton'
import { EditProjectModal } from '../components/EditProjectModal'
import { ProjectActionFooter } from '../components/ProjectActionFooter'
import { fetchAuditionStreak } from '../lib/auditionStreak'
import { recordProjectView } from '../lib/projectViews'
import { resolveCreatorName, resolveCreatorInitial } from '../lib/creatorName'
import { OwnerBriefPanel } from '../components/OwnerBriefPanel'
import { BackstagePanel } from '../components/BackstagePanel'
import { ProjectComments } from '../components/ProjectComments'
import { ShareToXModal } from '../components/ShareToXModal'
import { ShareOnXMenu, type ShareOption } from '../components/ShareOnXMenu'
import { MILESTONE_LABELS, type MilestoneRow } from '../components/MilestoneShareDropdown'
import { GraduationStanding } from '../components/GraduationStanding'
import { BadgeSnippet } from '../components/BadgeSnippet'
import { useAuth } from '../lib/auth'
import { computeSeasonProgress, loadCurrentSeason } from '../lib/season'
import type { Season } from '../lib/supabase'
import type { SeasonPhase, SeasonProgress } from '../lib/season'

// Compact relative-time string · "today · yesterday · 3d ago · 2w ago · ...".
// Inline-local because the project has multiple timeAgo helpers in
// neighboring components but no shared lib export yet.
function relativeTimeShort(iso: string): string {
  const ms  = Date.now() - new Date(iso).getTime()
  const day = Math.floor(ms / 86_400_000)
  if (day < 1)   return 'today'
  if (day === 1) return 'yesterday'
  if (day < 7)   return `${day}d ago`
  if (day < 30)  return `${Math.floor(day / 7)}w ago`
  if (day < 365) return `${Math.floor(day / 30)}mo ago`
  return `${Math.floor(day / 365)}y ago`
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, member } = useAuth()

  const [project, setProject] = useState<Project | null>(null)
  const [snapshotResult, setSnapshotResult] = useState<AnalysisResult | null>(null)
  const [vibeConcerns, setVibeConcerns] = useState<any>(null)
  // Scanned-scope transparency · for monorepo audits, names the workspace
  // dirs that were actually traversed. Disarms the "you said our service
  // fails X" trap when the scan only saw a sub-app of a big monorepo
  // (apps/studio in supabase/supabase, etc.).
  const [scannedScope, setScannedScope] = useState<string | null>(null)
  const [nativeBreakdown, setNativeBreakdown] = useState<NativeAppBreakdown | null>(null)
  const [nativeFootguns,  setNativeFootguns]  = useState<NativeFootguns | null>(null)
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [forecasts, setForecasts] = useState<ForecastRow[]>([])
  const [applauds, setApplauds] = useState<ApplaudRow[]>([])
  const [loading, setLoading] = useState(true)
  const [forecastOpen, setForecastOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  // Hero-level Re-audit state. Lives here (not inside AnalysisResultCard)
  // so the Re-audit affordance can sit in the title block alongside EDIT
  // — most owners want to act on it from the top of the page, not after
  // scrolling past Activity.
  const [heroRerunBusy, setHeroRerunBusy] = useState(false)
  const [heroRerunError, setHeroRerunError] = useState<string | null>(null)
  // Score-jump share prompt · opens after a re-audit lands a delta ≥
  // SHARE_PROMPT_THRESHOLD. Captures the post-audit number so the modal
  // shows the new score even if `project` is mid-refresh.
  const [shareJump, setShareJump] = useState<{ score: number; delta: number; takeaway: string | null } | null>(null)
  const [streakClimbs, setStreakClimbs] = useState(0)
  // All ladder_milestones rows for this project · drives the
  // 'Share milestone ▼' dropdown. Empty when no milestone yet (common
  // for new audits). Sorted desc by achieved_at so newest is first.
  const [milestones, setMilestones] = useState<MilestoneRow[]>([])
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
        const ghSig = (latest.github_signals ?? {}) as {
          vibe_concerns?: unknown
          scanned_scope?: string
          native_permissions_overreach?: NativeFootguns['permissions']
          native_secrets_in_bundle?:     NativeFootguns['secrets_in_bundle']
          has_privacy_manifest?:         boolean
          has_permissions_manifest?:     boolean
        }
        setVibeConcerns(ghSig.vibe_concerns ?? null)
        setScannedScope(ghSig.scanned_scope ?? null)
        // Native-app distribution + permissions block (only present when
        // form_factor='native_app'). Pulled from rich_analysis.breakdown.
        const richBreakdown = (latest.rich_analysis as { breakdown?: NativeAppBreakdown } | null)?.breakdown ?? null
        const isNative = !!(richBreakdown && richBreakdown.is_native_app)
        setNativeBreakdown(isNative ? richBreakdown : null)
        // Native footguns surface (extension · 2026-04-30) · only render
        // when the project IS native. Source of truth = github_signals
        // (denormalized so UI doesn't have to walk rich_analysis).
        setNativeFootguns(isNative ? {
          permissions:              ghSig.native_permissions_overreach ?? null,
          secrets_in_bundle:        ghSig.native_secrets_in_bundle ?? null,
          has_privacy_manifest:     !!ghSig.has_privacy_manifest,
          has_permissions_manifest: !!ghSig.has_permissions_manifest,
        } : null)
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
      // All milestones for this project · drives the dropdown. Cap 20
      // to bound payload (single project rarely hits more than 6 distinct
      // milestone types anyway · ladder_milestones UNIQUE constraint
      // (project_id, milestone_type) prevents dup rows).
      void supabase
        .from('ladder_milestones')
        .select('milestone_type, category, achieved_at')
        .eq('project_id', proj.id)
        .order('achieved_at', { ascending: false })
        .limit(20)
        .then(({ data }) => {
          const rows: MilestoneRow[] = (data ?? []).map(r => ({
            type:       r.milestone_type,
            label:      MILESTONE_LABELS[r.milestone_type] ?? r.milestone_type,
            category:   r.category,
            achievedAt: r.achieved_at,
          }))
          setMilestones(rows)
        })
      setLoading(false)
    })()
  }, [id])

  // Hero-level Re-audit handler · same pipeline as the AnalysisResultCard
  // version (lib/analysis::analyzeProject 'resubmit' trigger + ladder cache
  // invalidation + on-success snapshot/project sync), just plumbed off the
  // top-of-page button instead of the SCOUT BRIEF header.
  const handleHeroReanalyze = async () => {
    if (!project || heroRerunBusy) return
    setHeroRerunBusy(true)
    setHeroRerunError(null)
    try {
      const next = await analyzeProject(project.id, 'resubmit')
      void import('../lib/ladder').then(m => m.invalidateLadderCache())
      // Same in-render sync as the existing onReanalyzed flow on AnalysisResultCard.
      setSnapshotResult(next)
      setProject(prev => prev ? {
        ...prev,
        score_total:     next.score_total ?? prev.score_total,
        score_auto:      next.score_auto ?? prev.score_auto,
        score_forecast:  next.score_forecast ?? prev.score_forecast,
        score_community: next.score_community ?? prev.score_community,
      } : prev)
      const [refreshed, tl, ap] = await Promise.all([
        fetchProjectById(project.id),
        fetchProjectTimeline(project.id),
        fetchProjectApplauds(project.id),
      ])
      if (refreshed) setProject(refreshed)
      setTimeline(tl)
      setApplauds(ap)
      window.setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'auto' })
      }, 0)

      // Score-jump share prompt · only on positive delta ≥ threshold so
      // we don't nag on small wiggles. takeaway pulls the first strength
      // bullet from the fresh snapshot for tweet body context.
      const SHARE_PROMPT_THRESHOLD = 5
      const delta = next.score_total_delta ?? 0
      if (delta >= SHARE_PROMPT_THRESHOLD) {
        const strengths = next.rich?.scout_brief?.strengths
        const firstStrength = Array.isArray(strengths) && strengths.length > 0
          ? (typeof strengths[0] === 'string' ? strengths[0] : strengths[0]?.bullet ?? null)
          : null
        setShareJump({
          score: next.score_total ?? project.score_total,
          delta,
          takeaway: firstStrength,
        })
      }
    } catch (e) {
      if (e instanceof CooldownError) {
        setHeroRerunError(`Re-audit available in ${e.retryAfterHours}h. The 24h cooldown prevents spam.`)
      } else {
        setHeroRerunError(`Re-audit failed: ${(e as Error).message}`)
      }
    } finally {
      setHeroRerunBusy(false)
    }
  }

  // Record a project_views row · once per page load. Skip when the viewer
  // is the project's own creator so the Community pillar never reflects
  // self-traffic. The helper handles its own StrictMode/double-mount guard.
  useEffect(() => {
    if (!project?.id) return
    if (project.creator_id && user?.id && project.creator_id === user.id) return
    void recordProjectView(project.id)
  }, [project?.id, project?.creator_id, user?.id])

  // Scroll-spy · highlight the section nav chip that matches the viewport
  useEffect(() => {
    if (loading) return
    const ids = ['overview', 'analysis', 'activity', 'backstage', 'brief']
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
    // NotFoundPage injects <meta robots noindex> so Google's crawler
    // doesn't classify missing-project URLs as Soft 404 in the index.
    return (
      <NotFoundPage
        title="Project not found"
        message="It may have been removed or the URL is wrong. Try the ladder for active products."
        homeHref="/products"
      />
    )
  }

  const canForecast = !!user && user.id !== project.creator_id
  const isOwner     = !!user && user.id === project.creator_id
  // Forecast ballots are only accepted during the 3 active weeks (§11.2).
  const isVotingPhase = seasonPhase === 'week_1' || seasonPhase === 'week_2' || seasonPhase === 'week_3'

  // ── Section nav config (order = scroll order) ───────────────
  const sections: Array<{ id: string; label: string; ownerOnly?: boolean }> = [
    { id: 'overview',  label: 'Overview' },
    { id: 'analysis',  label: 'Analysis' },
    { id: 'activity',  label: 'Activity' },
    { id: 'backstage', label: 'Backstage' },
  ]
  if (isOwner) sections.push({ id: 'brief', label: 'Private brief', ownerOnly: true })

  // Audition delta badge · latest round change (reused in hero + scan strip)
  const latestSnap = timeline[timeline.length - 1]
  const roundDelta = latestSnap?.score_total_delta ?? null
  const roundCount = timeline.length

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
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

        {/* ── Walk-on preview banner · status='preview' + creator_id=null ──
              CLI / web preview audits create a public projects row so the
              cache and shareable URL keep working, but the repo owner
              hasn't claimed the entry. Make that obvious so a viewer who
              found the URL doesn't read it as an endorsed audition, and
              give the owner an obvious path to upgrade. */}
        {project.status === 'preview' && !project.creator_id && (
          <UnclaimedPreviewBanner
            githubUrl={project.github_url}
            projectName={project.project_name}
          />
        )}

        {/* ── Compact Hero (description moved to Overview pullquote) ── */}
        <header className="card-navy overflow-hidden mb-4 relative" style={{ borderRadius: '2px' }}>
          {/* Top-right cluster · Open Live (everyone) + owner controls
              (Re-audit / EDIT). 2026-05-05 · pulled OPEN LIVE out of
              the inline action row so the action row could shrink to
              just Forecast + Applaud (the engagement primitives).
              flex-wrap-reverse keeps Open Live at the top-right edge
              when wrapping; owner buttons fall to the second line. */}
          <div className="absolute top-3 right-3 z-10 flex flex-wrap-reverse justify-end items-center gap-1.5 max-w-[calc(100%-1.5rem)]">
            {project.live_url && (
              <a href={project.live_url} target="_blank" rel="noopener noreferrer"
                className="font-mono text-[11px] tracking-wide px-3 py-1.5"
                style={{
                  background: 'var(--gold-500)',
                  color: 'var(--navy-900)',
                  border: 'none',
                  borderRadius: '2px',
                  textDecoration: 'none',
                  fontWeight: 600,
                }}>
                OPEN LIVE ↗
              </a>
            )}
            {isOwner && (
              <>
                <button
                  type="button"
                  onClick={handleHeroReanalyze}
                  disabled={heroRerunBusy}
                  className="font-mono text-[11px] tracking-wide px-3 py-1.5"
                  style={{
                    background:   heroRerunBusy ? 'rgba(240,192,64,0.25)' : 'rgba(6,12,26,0.8)',
                    color:        heroRerunBusy ? 'var(--text-muted)' : 'var(--gold-500)',
                    border:       '1px solid rgba(240,192,64,0.4)',
                    borderRadius: '2px',
                    cursor:       heroRerunBusy ? 'wait' : 'pointer',
                    backdropFilter: 'blur(4px)',
                  }}
                  aria-label="Re-audit this build"
                >
                  {heroRerunBusy ? 'Auditing 60–120s…' : 'Re-audit →'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="font-mono text-[11px] tracking-wide px-3 py-1.5"
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
              </>
            )}
          </div>
          {isOwner && heroRerunError && (
            <div className="absolute top-12 right-3 z-10 font-mono text-[10px] tracking-wide px-2 py-1"
                 style={{
                   maxWidth: '320px',
                   textAlign: 'right',
                   color: '#F87871',
                   background: 'rgba(200,16,46,0.08)',
                   borderLeft: '2px solid var(--scarlet)',
                   borderRadius: '2px',
                 }}>
              {heroRerunError}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-[260px_1fr]">
            <div style={{ aspectRatio: '1200 / 630', background: 'var(--navy-800)', overflow: 'hidden' }}>
              {project.thumbnail_url ? (
                <img src={project.thumbnail_url} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-mono text-xs" style={{ color: 'rgba(248,245,238,0.25)' }}>NO IMAGE</div>
              )}
            </div>
            <div className="p-4 sm:p-6 flex flex-col gap-4 justify-between">
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
                {/* letter-spacing intentionally unspecified · CLAUDE.md §4
                    rule for h1 3xl/4xl Playfair (browser default · prevents
                    serif character collisions). */}
                <h1 className="font-display font-black text-3xl md:text-4xl leading-tight mb-2" style={{ color: 'var(--cream)' }}>
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
                          resolveCreatorInitial({ display_name: creator.display_name, creator_name: project.creator_name })
                        )}
                      </div>
                      <div className="font-mono text-xs" style={{ color: 'var(--cream)' }}>
                        by <strong>{resolveCreatorName({ display_name: creator.display_name, creator_name: project.creator_name })}</strong>
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

                {/* Scanned-scope · transparency for monorepo audits.
                    For supabase / vercel / cal.com style big monorepos,
                    states what was actually traversed so a reader doesn't
                    interpret apps/studio findings as core-service issues.
                    Only renders when github_signals reports it (newer
                    snapshots · older audits stay quiet rather than
                    surfacing a stale empty value). */}
                {scannedScope && (
                  <div
                    className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] px-2 py-1"
                    style={{
                      background: 'rgba(96,165,250,0.08)',
                      color: 'rgba(96,165,250,0.95)',
                      border: '1px solid rgba(96,165,250,0.30)',
                      borderRadius: '2px',
                    }}
                    title="Names the workspace dirs the scan actually traversed. Useful when a project is a monorepo — concerns may apply to a sub-app, not the whole org."
                  >
                    <span style={{ opacity: 0.7 }}>SCANNED · </span>
                    <span>{scannedScope}</span>
                  </div>
                )}
              </div>

              {/* Action row · 2026-05-05 trimmed to engagement primitives only.
                  Open Live / GitHub / Re-audit / EDIT moved up to the
                  hero card's top-right cluster. Owner Share menu kept
                  here because it's contextual to the project state
                  (audit/graduation/milestone options). */}
              <div className="flex flex-wrap gap-2">
                {/* Owner unified Share on X menu · single entry point that
                    expands to the right picker based on project state.
                    Audit always available · graduation when graduated ·
                    one row per milestone the project has hit. Order in
                    the menu mirrors prestige (graduation first, then
                    milestones desc by recency, then audit). */}
                {isOwner && (() => {
                  const score = project.score_total ?? 0
                  const band  = score >= 80 ? 'strong' : score >= 60 ? 'mid' : 'early'
                  const ghMatch = (project.github_url ?? '').match(/github\.com\/([^/]+)\/([^/?#]+)/i)
                  const owner       = ghMatch?.[1] ?? 'owner'
                  const repoName    = ghMatch?.[2]?.replace(/\.git$/, '') ?? project.project_name ?? 'repo'
                  const weaknesses  = snapshotResult?.rich?.scout_brief?.weaknesses ?? []
                  const strengths   = snapshotResult?.rich?.scout_brief?.strengths  ?? []
                  const firstConcernBullet  = weaknesses.length > 0 ? weaknesses[0]?.bullet ?? '' : ''
                  const firstStrengthBullet = strengths.length  > 0 ? strengths[0]?.bullet  ?? '' : ''
                  // Slug + owner name surfacing for share templates · {project_slug}
                  // becomes /project/<slug> URL, {owner_name} reads the creator
                  // display_name from the loaded project row (fallback to repo
                  // owner login when display_name isn't set).
                  const projectSlugStr = projectSlug(project.project_name ?? repoName)
                  const ownerName      = (project.creator_name ?? owner ?? '').trim()
                  const projectUrl     = projectShareUrl(project.project_name ?? repoName, project.id)

                  const options: ShareOption[] = []
                  if (project.graduation_grade) {
                    options.push({
                      key:        'encore',
                      label:      `encore · ${project.graduation_grade}`,
                      sub:        `final score ${score}/100`,
                      emphasis:   'primary',
                      templateId: 'encore',
                      slots: {
                        project_name:    project.project_name ?? repoName,
                        project_slug:    projectSlugStr,
                        owner_name:      ownerName,
                        grade:           project.graduation_grade,
                        score,
                        rank:            '',
                        total_in_season: '',
                        project_id:      project.id,
                      },
                    })
                  }
                  for (const m of milestones) {
                    options.push({
                      key:        `milestone:${m.type}`,
                      label:      `milestone · ${m.label}`,
                      sub:        relativeTimeShort(m.achievedAt) + (m.category ? ` · ${m.category}` : ''),
                      templateId: 'milestone',
                      slots: {
                        project_name:    project.project_name ?? repoName,
                        project_slug:    projectSlugStr,
                        owner_name:      ownerName,
                        milestone_label: m.label,
                        rank:            project.audit_count ?? '',
                        category:        m.category ?? project.business_category ?? '',
                        project_id:      project.id,
                      },
                    })
                  }
                  options.push({
                    key:        'audit',
                    label:      `audit · ${score}/100`,
                    sub:        `band ${band}`,
                    templateId: 'audit_complete',
                    slots: {
                      score,
                      band,
                      owner,
                      owner_name:     ownerName,
                      project_slug:   projectSlugStr,
                      project_name:   repoName,
                      project_id:     project.id,
                      top_concern_1:  firstConcernBullet,
                      top_strength_1: firstStrengthBullet,
                    },
                  })

                  return <ShareOnXMenu options={options} url={projectUrl} />
                })()}
                {/* Forecast + Applaud — §4 emoji CTA carve-out.
                    Forecast button surfaces participation count + avg
                    of all submitted predicted_score values so a viewer
                    sees what the room is calling before tapping in. */}
                {canForecast && isVotingPhase && (() => {
                  const predicted    = forecasts.filter(f => typeof f.predicted_score === 'number')
                  const forecastN    = forecasts.length
                  const avgPredicted = predicted.length === 0
                    ? null
                    : Math.round(predicted.reduce((s, f) => s + (f.predicted_score ?? 0), 0) / predicted.length)
                  return (
                    <button
                      onClick={() => setForecastOpen(true)}
                      className="font-mono text-xs font-medium tracking-wide px-3 py-1.5"
                      style={{ background: 'rgba(240,192,64,0.08)', color: 'var(--gold-500)', border: '1px solid rgba(240,192,64,0.3)', borderRadius: '2px', cursor: 'pointer' }}
                      title={forecastN === 0
                        ? 'No forecasts yet · be the first to call it'
                        : avgPredicted == null
                          ? `${forecastN} forecast${forecastN === 1 ? '' : 's'} · no predicted scores yet`
                          : `${forecastN} forecast${forecastN === 1 ? '' : 's'} · room is calling ${avgPredicted}/100 on average`}
                    >
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>🎯</span>
                        <span>FORECAST</span>
                        {forecastN > 0 && (
                          <span className="font-mono text-[10px] tabular-nums" style={{ color: 'var(--gold-500)', opacity: 0.8 }}>
                            · {forecastN}
                            {avgPredicted != null && <> · avg {avgPredicted}</>}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })()}
                {!isOwner && (
                  <ApplaudButton
                    targetType="product"
                    targetId={project.id}
                    viewerMemberId={user?.id ?? null}
                    isOwnContent={isOwner}
                    size="sm"
                    variant="emoji"
                    onChange={() => fetchProjectApplauds(project.id).then(setApplauds)}
                  />
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

        {/* ── Comments preview · standalone box right under the score area ──
              YouTube-mobile pattern applied to ALL viewports: collapsed by
              default with up to 3 recent comments, tap anywhere to open
              the full thread in a modal (full-screen on phones, centered
              dialog on desktop). Lives outside the section grid so it's
              not buried under tabs. */}
        <div className="mt-4 mb-6">
          <ProjectComments projectId={project.id} viewerMemberId={member?.id ?? null} />
        </div>

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
        {/* grid-cols-1 + min-w-0: explicit single-column 1fr so any
            child with unbounded intrinsic width (e.g. <pre whitespace:pre>
            in BadgeSnippet) can't push the column wider than the
            parent · earlier symptom: own-project view layout broke
            on the right because of the badge snippet pre. */}
        <div className="grid grid-cols-1 gap-10 min-w-0">
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
                      aspectRatio: '1200 / 630',
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
              <GraduationStanding projectId={project.id} viewerMode={isOwner ? 'owner' : 'visitor'} />
              {/* Last timeline point reflects the live ladder total
                  (engagement-driven). Earlier points stay as audit-time
                  snapshots — you can't rewrite history. delta is recomputed
                  against the previous point so the chart's rightmost label
                  agrees with ScanStrip / AnalysisResultCard / Ladder. */}
              <ScoreTimeline points={(() => {
                if (timeline.length === 0) return timeline
                const last = timeline[timeline.length - 1]
                if (last.score_total === project.score_total) return timeline
                const prevSnap = timeline.length >= 2 ? timeline[timeline.length - 2] : null
                const liveDelta = prevSnap ? project.score_total - prevSnap.score_total : last.score_total_delta
                return [
                  ...timeline.slice(0, -1),
                  { ...last, score_total: project.score_total, score_total_delta: liveDelta },
                ]
              })()} />
            </div>

            {/* AI Coder 7 Frames · signature framework — sits between
                score timeline and full Analysis card so beginners see the
                most actionable failure-mode summary first. */}
            {vibeConcerns && (
              <div className="mt-8">
                <VibeConcernsPanel vibeConcerns={vibeConcerns} />
              </div>
            )}

            {/* Native-app surface · only when latest snapshot detected
                form_factor='native_app'. Shows store gates + native
                footguns + distribution evidence in lieu of Lighthouse
                / live URL probes. */}
            {nativeBreakdown && (
              <div className="mt-8">
                <NativeAppPanel breakdown={nativeBreakdown} footguns={nativeFootguns} />
              </div>
            )}
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
                // The snapshot froze score_total at audit time; engagement
                // triggers (votes/applauds/comments) lift projects.score_total
                // afterward. The card's headline must match the live ladder
                // total — anything else surfaces two different "Score" numbers
                // on the same page, which we just had to debug. axis_scores +
                // strengths + concerns stay snapshot-frozen (those ARE point-
                // in-time audit outputs).
                result={{ ...snapshotResult, score_total: project.score_total }}
                projectId={isOwner ? project.id : undefined}
                onReanalyzed={isOwner ? async (next) => {
                  // 1) Latest analysis snapshot — drives the bottom card.
                  setSnapshotResult(next)
                  // 2) Mirror the new totals into the in-memory project so
                  //    Hero + ScanStrip + GraduationStanding (which read
                  //    project.score_total / forecast / community) update
                  //    in the same render — no flicker between top and
                  //    bottom while waiting for a refetch.
                  setProject(prev => prev ? {
                    ...prev,
                    score_total:     next.score_total ?? prev.score_total,
                    score_auto:      next.score_auto ?? prev.score_auto,
                    score_forecast:  next.score_forecast ?? prev.score_forecast,
                    score_community: next.score_community ?? prev.score_community,
                  } : prev)
                  // 3) Re-fetch project + timeline + applauds so derived
                  //    fields (audit_count · last_analysis_at · timeline
                  //    delta) settle without a full reload.
                  const [refreshed, tl, ap] = await Promise.all([
                    fetchProjectById(project.id),
                    fetchProjectTimeline(project.id),
                    fetchProjectApplauds(project.id),
                  ])
                  if (refreshed) setProject(refreshed)
                  setTimeline(tl)
                  setApplauds(ap)
                } : undefined}
                viewerMode={isOwner ? 'owner' : 'visitor'}
                seasonPhase={seasonPhase}
                viewerTier={member?.tier ?? null}
                hideReanalyzeButton
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

              <ActivityList title="APPLAUDS" emptyLabel="No applauds yet." accent="var(--gold-500)">
                {applauds.map(a => (
                  <ActivityRow
                    key={a.id}
                    primary="Applauded"
                    detail=""
                    secondary=""
                    time={a.created_at}
                  />
                ))}
              </ActivityList>
            </div>
          </section>

          {/* BACKSTAGE · public · locked until graduation per CLAUDE.md §12 */}
          <section id="backstage" className="scroll-mt-28">
            <SectionHeader
              label="BACKSTAGE"
              hint="Failures · decisions · delegation · the data nobody else captures. Sealed until graduation."
            />
            <BackstagePanel project={project} />
          </section>

          {/* BRIEF · owner only */}
          {isOwner && (
            <section id="brief" className="scroll-mt-28">
              <SectionHeader label="PRIVATE BRIEF" hint="Only you can see this — editor + integrity score." />
              <OwnerBriefPanel projectId={project.id} />
              <div className="mt-6">
                <BadgeSnippet projectId={project.id} projectName={project.project_name} />
              </div>
            </section>
          )}
        </div>

        {/* Casual bottom action row — second chance for visitors to react */}
        <ProjectActionFooter
          projectId={project.id}
          viewerMemberId={user?.id ?? null}
          isOwner={isOwner}
          seasonPhase={seasonPhase}
          onForecastClick={() => setForecastOpen(true)}
        />
      </div>

      {forecastOpen && (
        <ForecastModal project={project} onClose={() => setForecastOpen(false)} onCast={() => {
          // reload forecasts + project score after cast
          fetchProjectForecasts(project.id).then(setForecasts)
          fetchProjectById(project.id).then(p => p && setProject(p))
        }} />
      )}

      {editOpen && isOwner && (
        <EditProjectModal
          project={project}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => { setProject(updated); setEditOpen(false) }}
        />
      )}

      {/* Hero Re-audit progress overlay — same shared modal AnalysisResultCard
          uses; rendered at the page level so it sits above everything while
          the audit runs. */}
      <AnalysisProgressModal
        open={heroRerunBusy}
        variant="reanalyze"
        completed={false}
      />

      <ShareToXModal
        open={!!shareJump}
        onClose={() => setShareJump(null)}
        projectName={project.project_name ?? 'this build'}
        score={shareJump?.score ?? project.score_total}
        delta={shareJump?.delta ?? 0}
        url={typeof window !== 'undefined' ? `${window.location.origin}/projects/${project.id}` : `/projects/${project.id}`}
        takeaway={shareJump?.takeaway ?? null}
      />
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
      className="sticky z-20 mb-8 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 py-2.5"
      style={{
        top: '64px',
        background: 'rgba(6,12,26,0.85)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="max-w-5xl mx-auto flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
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

// Walk-on preview · projects row created by the CLI / web preview audit
// without an account. The page works (so the URL stays shareable for the
// person who triggered the audit), but a visitor needs to know:
//   1. This is not an endorsed audition — the owner hasn't claimed it.
//   2. The owner can claim and turn it into a real audition in one click.
// Also installs a robots noindex meta on the document so this page doesn't
// surface in search results — direct URL still works, but a Google query
// for the repo name shouldn't pull up an unclaimed walk-on score.
function UnclaimedPreviewBanner({
  githubUrl, projectName,
}: { githubUrl: string | null; projectName: string }) {
  useEffect(() => {
    // Owner-claim path expects the github URL as a query param.
    const id = 'cs-noindex-meta'
    let meta = document.querySelector<HTMLMetaElement>(`meta[name="robots"]#${id}`)
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'robots'
      meta.id = id
      document.head.appendChild(meta)
    }
    meta.content = 'noindex,nofollow'
    return () => { meta?.remove() }
  }, [])

  const claimHref = githubUrl
    ? `/submit?repo=${encodeURIComponent(githubUrl)}`
    : '/submit'

  return (
    <div
      className="card-navy mb-4 px-4 py-3 flex items-start gap-3 flex-wrap"
      style={{
        borderRadius: '2px',
        background: 'rgba(240,192,64,0.06)',
        border: '1px solid rgba(240,192,64,0.35)',
      }}
    >
      <div className="flex-1 min-w-[220px]">
        <div className="font-mono text-[11px] tracking-widest mb-1" style={{ color: 'var(--gold-500)' }}>
          WALK-ON PREVIEW · UNCLAIMED
        </div>
        <div className="font-light text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>
          This audit was triggered from the CLI on a public repo before
          {' '}<span className="font-mono">{projectName}</span>'s owner registered.
          The score is real, but it isn't an endorsed audition until claimed.
        </div>
      </div>
      <a
        href={claimHref}
        className="font-mono text-xs font-medium tracking-wide px-3 py-1.5 whitespace-nowrap shrink-0 self-center"
        style={{
          background: 'var(--gold-500)',
          color: 'var(--navy-900)',
          border: 'none',
          borderRadius: '2px',
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        Claim this repo →
      </a>
    </div>
  )
}
