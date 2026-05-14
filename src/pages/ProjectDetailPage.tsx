import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Project } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { projectSlug, projectShareUrl } from '../lib/projectSlug'
import {
  displayScore, laneOf, viewerCanSeeDigit,
  scoreBand    as laneScoreBand,
  bandLabel    as laneBandLabel,
  bandTone     as laneBandTone,
} from '../lib/laneScore'
import { useViewer } from '../lib/useViewer'
import {
  fetchProjectById,
  fetchProjectByIdOrSlug,
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
import { TokenReceiptForm } from '../components/TokenReceiptForm'
import { TokenEfficiencyPanel } from '../components/TokenEfficiencyPanel'
import { OwnerNextStepBanner } from '../components/OwnerNextStepBanner'
import { MarketPositionForm } from '../components/MarketPositionForm'
import { AboutProjectSection } from '../components/AboutProjectSection'
import { MakerIntroBanner } from '../components/MakerIntroBanner'
import { CommunityPulseStrip } from '../components/CommunityPulseStrip'
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
import { AuditCoachPanel } from '../components/AuditCoachPanel'
import { ProjectComments } from '../components/ProjectComments'
import { ShareToXModal } from '../components/ShareToXModal'
import { ShareOnXMenu, type ShareOption } from '../components/ShareOnXMenu'
import { MILESTONE_LABELS, type MilestoneRow } from '../components/MilestoneShareDropdown'
import { GraduationStanding } from '../components/GraduationStanding'
import { BadgeSnippet } from '../components/BadgeSnippet'
import { MCPInstallBlock } from '../components/MCPInstallBlock'
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

// "owner/repo" extracted from a github_url for the MCPInstallBlock
// snippets. Returns null for URL fast-lane projects (no repo) so the
// block can degrade to MCP-only.
function ownerRepoSlug(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/github\.com[:/]([^/\s?#]+)\/([^/\s?#]+?)(?:\.git)?\/?(?:[?#]|$)/i)
  return m ? `${m[1]}/${m[2]}` : null
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
  // form_factor (app / library / scaffold / native_app / skill / unknown)
  // drives the inline 'Audited as X' badge so visitors interpret the
  // score in context. A library score of 85 ≠ an app score of 85 —
  // the rubric is form-aware (slot semantics shift) but the absolute
  // number alone can mislead.
  const [formFactor, setFormFactor] = useState<'app' | 'library' | 'scaffold' | 'native_app' | 'skill' | 'unknown' | null>(null)
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
  // §16.2 Coach · remember the band right BEFORE each re-audit so the
  // panel can detect "you climbed from Early → Building" and fire the
  // soft audition prompt. null on first paint · gets stamped at the
  // moment the re-audit kicks off, so the post-audit currentBand can
  // diff against it.
  const [preReauditBand, setPreReauditBand] = useState<ReturnType<typeof laneScoreBand> | null>(null)
  // §16.2 Coach · stash the raw snapshot JSON columns so the Coach
  // panel can read rich_analysis / lighthouse / github_signals without
  // forcing snapshotResult (the AnalysisResult shape) to grow. Set in
  // the initial fetch + on every re-audit.
  const [latestSnapRaw, setLatestSnapRaw] = useState<{
    rich:          Record<string, unknown> | null
    lighthouse:    Record<string, unknown> | null
    githubSignals: Record<string, unknown> | null
  } | null>(null)
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
      // Slug-aware lookup · accepts UUID or slug. If the caller hit
      // the UUID variant and the project has a slug, redirect to the
      // canonical /projects/<slug> URL so the address bar + cache key
      // settle on the friendlier form (SEO + share-card cleanliness).
      const { project: proj, matchedBy } = await fetchProjectByIdOrSlug(id)
      if (!proj) { setNotFound(true); setLoading(false); return }
      if (matchedBy === 'id' && proj.slug) {
        navigate(`/projects/${proj.slug}`, { replace: true })
        return
      }
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
          form_factor?: 'app' | 'library' | 'scaffold' | 'native_app' | 'skill' | 'unknown'
          vibe_concerns?: unknown
          scanned_scope?: string
          native_permissions_overreach?: NativeFootguns['permissions']
          native_secrets_in_bundle?:     NativeFootguns['secrets_in_bundle']
          has_privacy_manifest?:         boolean
          has_permissions_manifest?:     boolean
        }
        setVibeConcerns(ghSig.vibe_concerns ?? null)
        setScannedScope(ghSig.scanned_scope ?? null)
        setFormFactor(ghSig.form_factor ?? null)
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
        // §16.2 Coach raw snapshot · same set, kept verbatim so the
        // detection catalog reads the same shape the engine wrote.
        setLatestSnapRaw({
          rich:          (latest.rich_analysis as Record<string, unknown>) ?? null,
          lighthouse:    (latest.lighthouse    as Record<string, unknown>) ?? null,
          githubSignals: (latest.github_signals as Record<string, unknown>) ?? null,
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
    // Stamp the band BEFORE the re-audit so the Coach can detect a
    // band climb on the next render (after setProject has fired with
    // the new score). Doing it here in the handler — not on every
    // render — keeps the comparison stable.
    setPreReauditBand(laneScoreBand(displayScore(project)))
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
      // §16.2 Coach raw refresh · re-fetch the new snapshot's raw JSON
      // columns so detectQuickWins runs against fresh evidence. Cheap
      // single-row read; doesn't block the score sync above.
      void supabase
        .from('analysis_snapshots')
        .select('rich_analysis, lighthouse, github_signals')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return
          setLatestSnapRaw({
            rich:          (data.rich_analysis as Record<string, unknown>) ?? null,
            lighthouse:    (data.lighthouse    as Record<string, unknown>) ?? null,
            githubSignals: (data.github_signals as Record<string, unknown>) ?? null,
          })
        })
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

  // §15-E.6 wave 6 · hero-image policy
  //   1. owner-set thumbnail wins
  //   2. fall back to scraped og:image URL · two sources merged:
  //        a) Tier A inspectCompleteness.og_image_url (always runs · repo audits get this)
  //        b) Tier B deep_probe.meta_tags.og_image_url (URL fast lane only)
  //      Tier B preferred when both exist (sees post-hydration injected tags)
  //   3. for WALK-ON PREVIEW · UNCLAIMED with no image at all → collapse
  //      column (avoid "NO IMAGE" empty box on anonymous walk-ons)
  //   4. owned projects with no image still show placeholder (owner UX)
  const heroImageDecision = useMemo(() => {
    const richTyped = snapshotResult?.rich as {
      deep_probe?:           { meta_tags?: { og_image_url?: string | null } }
      completeness_signals?: { og_image_url?: string | null }
    } | null
    const ogTierB   = richTyped?.deep_probe?.meta_tags?.og_image_url ?? null
    const ogTierA   = richTyped?.completeness_signals?.og_image_url ?? null
    const ogImage   = ogTierB || ogTierA || null
    const heroImage = project?.thumbnail_url || ogImage || null
    const isWalkOnUnclaimed = project?.status === 'preview' && !project?.creator_id
    const hideImageColumn = !heroImage && !!isWalkOnUnclaimed
    return { heroImage, hideImageColumn }
  }, [project?.thumbnail_url, project?.status, project?.creator_id, snapshotResult])

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
  // §re-audit privacy · 2026-05-10 directive · initial-only audits
  // (audit_count <= 1) hide the score from non-owners until the creator
  // re-audits. Lets creators iterate before public reveal · the first
  // run is often unflattering before they fix the surfaced concerns.
  // Owner always sees their own score. URL Fast Lane (status='preview' ·
  // creator_id null) is unaffected — that's the anonymous walk-on lane
  // with separate Polish Score framing.
  const scoreHidden = !isOwner
                   && (project.status !== 'preview')
                   && ((project.audit_count ?? 0) <= 1)
  // §1-A ⑥ band gate · public viewers see band ('Strong' / 'Building'),
  // creator/admin/paid-Patron see digit. Encore-graduated projects reveal
  // digit to everyone. URL Fast Lane previews stay digit-visible (no
  // creator identity attached, audit was self-initiated).
  const viewer       = useViewer()
  const canSeeDigit  = project.status === 'preview' ? true : viewerCanSeeDigit(project, viewer)
  const showAsBand   = !scoreHidden && !canSeeDigit
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

        {/* ── Backstage banner · status='backstage' (owner-only · RLS) ──
              Audit-then-audition split (§16.2). Owners viewing their
              own backstage project get an explicit reminder that it's
              not on the league yet, plus a one-click promote affordance
              that lands them on /me where BackstageSection handles the
              audition flow with full ticket visibility. */}
        {project.status === 'backstage' && isOwner && (
          <div className="mb-4 p-4 flex items-baseline justify-between gap-3 flex-wrap" style={{
            background: 'rgba(240,192,64,0.07)',
            border: '1px solid rgba(240,192,64,0.35)',
            borderRadius: '2px',
          }}>
            <div>
              <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
                // BACKSTAGE · ONLY YOU CAN SEE
              </div>
              <div className="font-mono text-[11px] mt-1" style={{ color: 'rgba(248,245,238,0.65)' }}>
                Backstage is private. Climb the coach below first, then audition to share with the MVPs already on stage.
              </div>
            </div>
            <a
              href="/me"
              className="px-4 py-2 font-mono text-xs font-medium tracking-wide whitespace-nowrap"
              style={{
                background: 'var(--gold-500)',
                color: 'var(--navy-900)',
                border: 'none',
                borderRadius: '2px',
                textDecoration: 'none',
              }}
            >
              BRING IT ON STAGE →
            </a>
          </div>
        )}

        {/* ── Pre-audition Coach · §16.2 (2026-05-15) ──
              Backstage-only owner surface. Lists 3-6 detected quick wins
              with how-to + checkbox + Re-audit CTA. Reuses the existing
              handleHeroReanalyze pipeline so a successful re-audit cycles
              the panel with fresh evidence + fires the soft audition
              prompt when the band climbs. Hidden once the project is on
              stage (status='active') — by then the audit + AnalysisResultCard
              already cover the same ground. */}
        {project.status === 'backstage' && isOwner && (
          <AuditCoachPanel
            project={project}
            snapshotRich={latestSnapRaw?.rich ?? null}
            lighthouse={latestSnapRaw?.lighthouse ?? null}
            githubSignals={latestSnapRaw?.githubSignals ?? null}
            onReanalyze={handleHeroReanalyze}
            reanalyzing={heroRerunBusy}
            previousBand={preReauditBand}
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
              // Icon-only on 2026-05-14 — the OPEN LIVE text was eating the
              // top-right cluster's horizontal budget once owner buttons
              // (Re-audit · EDIT) joined the row. Square 30px button keeps
              // the gold tile recognizable as the primary 'go see it' CTA,
              // SR-only label + title for accessibility.
              <a href={project.live_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center"
                title="Open live site"
                aria-label="Open live site"
                style={{
                  width: 30, height: 30,
                  background: 'var(--gold-500)',
                  color: 'var(--navy-900)',
                  border: 'none',
                  borderRadius: '2px',
                  textDecoration: 'none',
                }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                     stroke="currentColor" strokeWidth="2.2"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 3h6v6" />
                  <path d="M10 14L21 3" />
                  <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                </svg>
                <span className="sr-only">Open live site</span>
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
          <div className={heroImageDecision.hideImageColumn ? 'grid grid-cols-1' : 'grid grid-cols-1 md:grid-cols-[260px_1fr]'}>
            {!heroImageDecision.hideImageColumn && (
              <div style={{ aspectRatio: '1200 / 630', background: 'var(--navy-800)', overflow: 'hidden' }}>
                {heroImageDecision.heroImage ? (
                  <img src={heroImageDecision.heroImage} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center font-mono text-xs" style={{ color: 'rgba(248,245,238,0.25)' }}>NO IMAGE</div>
                )}
              </div>
            )}
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
                    title="Creator career grade — based on cumulative Encores (§8)."
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

        {/* ── Community pulse · 4-tile mini stats (applauds · comments ·
              forecasts · views). Surfaces social signal weight before
              the deep audit body. Each tile scrolls to its section.
              isOwner gates the COMMENTS notification dot · visitors
              don't get it (no skin in the thread). */}
        <CommunityPulseStrip projectId={project.id} isOwner={isOwner} />

        {/* ── Scan strip · at-a-glance metrics ──
              URL fast lane projects (preview · no github_url) get the /33
              polish normalization instead of the platform-lane /50 →
              score_total. Same number shows on HeroUrlHook so paste-the-URL
              audits read the same regardless of which surface presented
              them. See laneScore.ts for the denominator rationale. */}
        <ScanStrip
          score={displayScore(project)}
          lane={laneOf(project)}
          roundCount={roundCount}
          roundDelta={roundDelta}
          dayNumber={seasonProgress?.dayNumber ?? null}
          totalDays={seasonProgress?.totalDays ?? 28}
          phaseLabel={seasonProgress?.phaseLabel ?? ''}
          scoreHidden={scoreHidden}
          showAsBand={showAsBand}
          formFactor={formFactor}
        />

        {/* §re-audit privacy banner · public viewers see one line so the
            "—" in the score cell isn't a mystery. Owner doesn't see this
            (they see their score normally + the Re-audit CTA). */}
        {scoreHidden && (
          <div
            className="mb-4 px-4 py-3 font-mono text-xs"
            style={{
              background: 'rgba(248,245,238,0.04)',
              border: '1px solid rgba(248,245,238,0.12)',
              borderRadius: '2px',
              color: 'var(--text-secondary)',
            }}
          >
            <span style={{ color: 'var(--text-muted)' }}>// </span>
            Score is hidden until the creator re-audits.
            <span style={{ color: 'var(--text-muted)' }}> First-run scores
              often catch surfacable concerns the creator hasn't had a chance
              to fix yet · the public view waits for round 2.</span>
          </div>
        )}

        {/* ── About this project · casual narrative card right under
              the score banner. Aggregates Phase 1 brief + Market
              Position + tools into a Product-Hunt-style 'what is this'
              block so a fresh visitor can read the project IS in 10
              seconds without scrolling into the audit. Hides itself
              when no signals exist. */}
        <div className="mt-4">
          <AboutProjectSection projectId={project.id} projectName={project.project_name} />
        </div>

        {/* ── Owner coach · 'Next step' fix-prompt CTA, lifted out of the
              ANALYSIS section so the most actionable surface lands above
              the fold instead of after a scroll-past. Renders only when
              isOwner + has concerns + not yet dismissed. */}
        {isOwner && snapshotResult?.rich?.scout_brief && (
          <OwnerNextStepBanner
            projectName={project.project_name}
            githubUrl={project.github_url}
            scoreTotal={project.score_total ?? null}
            scoreAuto={project.score_auto ?? null}
            scoreForecast={project.score_forecast ?? null}
            scoreCommunity={project.score_community ?? null}
            tldr={snapshotResult.rich.tldr ?? null}
            strengths={snapshotResult.rich.scout_brief.strengths ?? []}
            weaknesses={snapshotResult.rich.scout_brief.weaknesses ?? []}
          />
        )}

        {/* ── Maker's launch post draft · owner-only · auto-prefilled
              from brief + market position. Hides itself once the owner
              has commented on the project (or explicitly dismisses).
              Sits above the comments preview so the published intro
              becomes the first thing anyone sees in the thread.
              Hidden on backstage rows — there's no audience to launch
              to until the creator auditions onto the stage. */}
        {isOwner && project.creator_id && project.status !== 'backstage' && (
          <MakerIntroBanner
            projectId={project.id}
            projectName={project.project_name}
            ownerMemberId={project.creator_id}
          />
        )}

        {/* ── ProjectComments mounts the right-side drawer + #comments
              hash listener · the inline preview card is hidden
              (hidePreview) because CommunityPulseStrip's COMMENTS
              tile is the single entry point now. Drawer still opens
              when the tile is clicked (sets hash '#comments'). */}
        <ProjectComments
          projectId={project.id}
          viewerMemberId={member?.id ?? null}
          hidePreview
        />

        {/* RecentActivityCard removed 2026-05-11 · the pulse strip's
            APPLAUDS / FORECASTS tile modals already surface the same
            info on demand, so the always-rendered timeline below it
            felt premature for current volumes. Component file kept
            in src/components/ for future re-introduction. */}

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

            {/* MarketPositionCard removed from here 2026-05-08 · the
                AboutProjectSection above the section nav now carries
                the one-liner / model / stage chips alongside the rest
                of the casual narrative. OVERVIEW becomes pure
                description + screenshots. */}

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

            {/* GraduationStanding moved to end of ANALYSIS section ·
                'this score → which Encore tier' is the conclusion of
                score analysis, not an overview fact. Tier 1 page-tighten
                pass · 2026-05-07. */}
            <div className="grid gap-5">
              {/* Last timeline point reflects the live ladder total
                  (engagement-driven). Earlier points stay as audit-time
                  snapshots — you can't rewrite history. delta is recomputed
                  against the previous point so the chart's rightmost label
                  agrees with ScanStrip / AnalysisResultCard / Ladder. */}
              <ScoreTimeline
                showAsBand={showAsBand}
                points={(() => {
                  if (timeline.length === 0) return timeline
                  const last = timeline[timeline.length - 1]
                  if (last.score_total === project.score_total) return timeline
                  const prevSnap = timeline.length >= 2 ? timeline[timeline.length - 2] : null
                  const liveDelta = prevSnap ? project.score_total - prevSnap.score_total : last.score_total_delta
                  return [
                    ...timeline.slice(0, -1),
                    { ...last, score_total: project.score_total, score_total_delta: liveDelta },
                  ]
                })()}
              />
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
            {scoreHidden ? (
              <div
                className="px-5 py-6 font-mono text-xs"
                style={{
                  background: 'rgba(248,245,238,0.03)',
                  border: '1px dashed rgba(248,245,238,0.15)',
                  borderRadius: '2px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.7,
                }}
              >
                <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
                  // ANALYSIS LOCKED · ROUND 1
                </div>
                <p className="mb-2" style={{ color: 'var(--cream)' }}>
                  The full audit is hidden until the creator re-audits.
                </p>
                <p className="mb-0" style={{ color: 'var(--text-muted)' }}>
                  First-run scores often reflect concerns the creator hasn't
                  had time to address yet. The public report unlocks on
                  round 2 — strengths · concerns · axis breakdown · all of it.
                  Drop a forecast or applaud while you wait — those land on
                  the round 2 card too.
                </p>
              </div>
            ) : snapshotResult ? (
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
                showAsBand={showAsBand}
              />
            ) : (
              <EmptyBox label="No analysis yet — awaiting first round." />
            )}

            {/* Encore Standing · the 'so where does this score land?'
                conclusion. Lives at the END of ANALYSIS so the user has
                already seen what's wrong + what's right + the score
                breakdown before this card tells them how close they are
                to the Encore line.
                scoreHidden mirrors the ScanStrip privacy rule · initial-
                only audits (audit_count <= 1) blank the score from
                non-owners. */}
            <div className="mt-6">
              <GraduationStanding
                projectId={project.id}
                viewerMode={isOwner ? 'owner' : 'visitor'}
                scoreHidden={scoreHidden}
                showAsBand={showAsBand}
              />
            </div>
          </section>

          {/* ACTIVITY · collapsed by default · summary row shows counts,
              click to expand. Forecasts and applauds are nice context
              but not the headline — keeping them folded shortens the
              page for the 99% of visitors who don't need to read each
              row. (Tier 2 page-tighten · 2026-05-07.) */}
          <CollapsibleSection
            id="activity"
            label="ACTIVITY"
            hint="Forecasts and applauds on this project."
            summary={`${forecasts.length} forecast${forecasts.length === 1 ? '' : 's'} · ${applauds.length} applaud${applauds.length === 1 ? '' : 's'}`}
          >
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
          </CollapsibleSection>

          {/* TOKEN USAGE · public · only renders when receipt exists */}
          <section className="scroll-mt-28">
            <TokenEfficiencyPanel projectId={project.id} isOwner={isOwner} />
          </section>

          {/* BACKSTAGE · public · locked until Encore. Default-collapsed
              so the locked-state stub doesn't take 250px of column for
              the 80% of projects that haven't crossed yet. */}
          <CollapsibleSection
            id="backstage"
            label="BACKSTAGE"
            hint="Failures · decisions · delegation · the data nobody else captures."
            summary={scoreHidden
              ? 'Locked until re-audit'
              : (project.score_total ?? 0) >= 84
                ? '✓ Unlocked · Phase 2 brief visible'
                : 'Sealed until Encore'}
          >
            <BackstagePanel project={project} scoreHidden={scoreHidden} />
          </CollapsibleSection>

          {/* BRIEF · owner only · 3 tools as tabs (Brief edit · README badge · Token receipt) */}
          {isOwner && (
            <section id="brief" className="scroll-mt-28">
              <SectionHeader label="PRIVATE BRIEF" hint="Only you can see this — three creator tools, one tab at a time." />
              <OwnerToolsTabs
                projectId={project.id}
                projectName={project.project_name}
                projectSlug={project.slug}
                githubUrl={project.github_url}
                projectScore={project.score_total}
              />
            </section>
          )}
        </div>

        {/* Casual bottom action row — second chance for visitors to react.
              id="forecast" lets CommunityPulseStrip APPLAUDS/FORECASTS
              tiles scroll here directly. */}
        <div id="forecast">
          <ProjectActionFooter
            projectId={project.id}
            viewerMemberId={user?.id ?? null}
            isOwner={isOwner}
            seasonPhase={seasonPhase}
            onForecastClick={() => setForecastOpen(true)}
          />
        </div>

        {/* "Audit this from your tools" — surfaces the MCP / CLI /
            GitHub Action distribution to the people most likely to
            use them: someone already looking at an audit page. Slug
            extracted inline from project.github_url; URL fast-lane
            projects (no repo) fall back to MCP-only install. */}
        <MCPInstallBlock slug={ownerRepoSlug(project.github_url)} />
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
  score, lane, roundCount, roundDelta, dayNumber, totalDays, phaseLabel,
  scoreHidden, showAsBand, formFactor,
}: {
  score: number
  /** Which audit lane this project ran in · drives the sub-label so
   *  visitors read URL-only scores as "partial · URL signals only"
   *  instead of comparing them naively to platform /50 scores. */
  lane: 'platform' | 'walk_on' | 'url_fast_lane'
  roundCount: number
  roundDelta: number | null
  dayNumber: number | null
  totalDays: number
  phaseLabel: string
  /** §re-audit privacy · hides initial-only scores from non-owners.
   *  Owner sees score · public sees "—" + tooltip. Score reveals on
   *  re-audit (audit_count >= 2). */
  scoreHidden?: boolean
  /** §1-A ⑥ shame mitigation · render band chip ('Strong' / 'Building'
   *  / 'Early') instead of the raw digit. Parent computes this via
   *  viewerCanSeeDigit so creator/admin/paid-Patron still see digit
   *  and Encore graduates reveal globally. Δ Round cell also dims when
   *  band-only — delta arithmetic is meaningless without the absolute. */
  showAsBand?: boolean
  /** Audited form factor · changes the Score cell's sub-label so
   *  viewers read 'app · score 85' vs 'library · score 85' as
   *  different things. Rubric IS form-aware; the absolute number
   *  needs visible context. */
  formFactor?: 'app' | 'library' | 'scaffold' | 'native_app' | 'skill' | 'unknown' | null
}) {
  // ScanStrip sub-label · 'partial · URL signals only' for URL fast lane
  // (visitors need that context), plain 'out of 100' for everything else.
  // form_factor specifics removed 2026-05-12 · stays as internal B2B
  // taxonomy (still drives audit rubric server-side).
  const formLabel = lane === 'url_fast_lane' ? 'partial · URL signals only' : 'out of 100'
  const scoreColor = score >= 75 ? '#00D4AA' : score >= 50 ? '#F0C040' : '#C8102E'
  const deltaColor = roundDelta == null || roundDelta === 0 ? 'var(--text-muted)'
    : roundDelta > 0 ? '#00D4AA' : '#F88771'
  const deltaText  = roundDelta == null ? '—' : roundDelta === 0 ? '0' : (roundDelta > 0 ? `+${roundDelta}` : `${roundDelta}`)
  // Band-mode override · scoreHidden (privacy) still wins. Band tone uses
  // the same palette as the AuditionPromoteCard chip so the visual system
  // stays consistent across surfaces.
  const band       = laneScoreBand(score)
  const bandColor  = laneBandTone(band)
  const bandText   = laneBandLabel(band)
  return (
    <div
      className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-0 overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '2px',
      }}
    >
      <ScanCell
        label="Score"
        value={scoreHidden ? '—' : showAsBand ? bandText : `${score}`}
        sub={scoreHidden ? 'hidden until re-audit' : showAsBand ? 'band · creator sees digit' : formLabel}
        color={scoreHidden ? 'var(--text-muted)' : showAsBand ? bandColor : scoreColor}
        tooltip={
          scoreHidden ? 'Score is hidden from public until the creator re-audits. Visible to the owner only.'
        : showAsBand  ? 'Public surfaces show band only · creator + admin + paid Patron Scout see the raw digit · Encore graduates reveal to everyone'
        : undefined}
      />
      <ScanCell label="Round"     value={roundCount > 0 ? `${roundCount}` : '—'} sub="analyses" color="var(--cream)" />
      <ScanCell
        label="Δ Round"
        value={scoreHidden || showAsBand ? '—' : deltaText}
        sub={scoreHidden ? 'hidden' : showAsBand ? 'hidden in band view' : 'vs last round'}
        color={scoreHidden || showAsBand ? 'var(--text-muted)' : deltaColor}
      />
      {/* Forecasts + Applauds cells removed 2026-05-11 · duplicated
          the new CommunityPulseStrip tiles directly above. Score ·
          Round · Δ Round · Season remain because they're not on the
          pulse strip. */}
      <ScanCell label="Season"
        value={dayNumber != null ? `D ${dayNumber}/${totalDays}` : '—'}
        sub={phaseLabel || 'schedule'}
        color="var(--gold-500)"
      />
    </div>
  )
}

function ScanCell({ label, value, sub, color, tooltip }: { label: string; value: string; sub: string; color: string; tooltip?: string }) {
  return (
    <div
      className="px-3 py-3 flex flex-col items-start justify-center"
      style={{ borderLeft: '1px solid rgba(255,255,255,0.04)' }}
      title={tooltip}
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

// CollapsibleSection · default-collapsed wrapper for non-headline
// surfaces (Activity feed · Backstage Phase 2 · etc). Shows label +
// hint + a one-line summary closed; click to expand and see children.
function CollapsibleSection({
  id, label, hint, summary, defaultOpen = false, children,
}: {
  id?:          string
  label:        string
  hint?:        string
  summary?:     string
  defaultOpen?: boolean
  children:     React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section id={id} className="scroll-mt-28">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left mb-4"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
              // {label}
            </div>
            {hint && (
              <div className="font-mono text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {hint}
              </div>
            )}
          </div>
          <span className="font-mono text-[11px] flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            {summary && <span>{summary}</span>}
            <span style={{ color: 'var(--gold-500)' }}>{open ? '▲' : '▼'}</span>
          </span>
        </div>
      </button>
      {open && children}
    </section>
  )
}

// OwnerToolsTabs · 3 owner-only tools (Brief edit · README badge ·
// Token receipt) folded into a single tab bar so the page doesn't
// stack 3 heavy cards on top of each other. One tool visible at a
// time; sticky tab bar lets the owner switch between them.
function OwnerToolsTabs({
  projectId, projectName, projectSlug, githubUrl, projectScore,
}: {
  projectId:    string
  projectName:  string
  projectSlug:  string | null
  githubUrl:    string | null
  projectScore: number | null
}) {
  type Tab = 'brief' | 'market' | 'badge' | 'tokens'
  const [tab, setTab] = useState<Tab>('brief')

  const tabs: Array<{ id: Tab; label: string; sub: string }> = [
    { id: 'brief',  label: 'Brief',         sub: 'edit your build brief' },
    { id: 'market', label: 'Market',        sub: 'one-liner · model · stage' },
    { id: 'badge',  label: 'README badge',  sub: 'show the score on GitHub' },
    { id: 'tokens', label: 'Token receipt', sub: 'join the token leaderboard' },
  ]

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-4">
        {tabs.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="font-mono text-[11px] tracking-wide px-3 py-2 transition-colors"
              style={{
                background:   active ? 'rgba(240,192,64,0.12)' : 'transparent',
                color:        active ? 'var(--gold-500)'      : 'var(--text-secondary)',
                border:       `1px solid ${active ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: '2px',
                cursor:       'pointer',
                fontWeight:   active ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {tab === 'brief' && (
        <OwnerBriefPanel projectId={projectId} />
      )}
      {tab === 'market' && (
        <MarketPositionForm
          projectId={projectId}
          // Standalone edit · no audit context here, prefill comes from
          // current build_briefs row inside the form via useEffect.
          prefill={{}}
          onConfirmed={() => { /* stay on tab · success state handled inline */ }}
        />
      )}
      {tab === 'badge' && (
        <BadgeSnippet projectId={projectId} projectName={projectName} projectSlug={projectSlug} githubUrl={githubUrl} />
      )}
      {tab === 'tokens' && (
        <TokenReceiptForm
          projectId={projectId}
          projectScore={projectScore}
          projectGithubUrl={githubUrl}
        />
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
