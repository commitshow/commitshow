import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Project } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { projectSlug, projectShareUrl } from '../lib/projectSlug'
import {
  displayScore, laneOf, viewerCanSeeDigit, urlLanePolish,
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
import { PulseListModal } from '../components/PulseListModal'
import { AnalysisProgressModal } from '../components/AnalysisProgressModal'
import { ScoreTimeline } from '../components/ScoreTimeline'
import { VibeConcernsPanel } from '../components/VibeConcernsPanel'
import { NativeAppPanel, type NativeAppBreakdown, type NativeFootguns } from '../components/NativeAppPanel'
import { ForecastModal } from '../components/ForecastModal'
import { ApplaudButton } from '../components/ApplaudButton'
import { StageBadge } from '../components/StageBadge'
import { BackstageCurtainArt } from '../components/BackstageCurtainArt'
import { deleteProject } from '../lib/projectQueries'
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
  // 2026-05-19 · CEO 피드백 · pulse stats lifted from CommunityPulseStrip
  // into the hero engagement row. VIEWS / FORECASTS / APPLAUDS chips sit
  // next to the applaud toggle; clicking the FORECASTS or APPLAUDS count
  // opens PulseListModal (the comments tile is gone — comments preview
  // lives in its own block below).
  const [viewsCount, setViewsCount] = useState<number | null>(null)
  const [pulseModal, setPulseModal] = useState<'applauds' | 'forecasts' | null>(null)
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
  const [activeSection, setActiveSection] = useState<string>('analysis')
  // 2026-05-17 · once-per-mount guard so the backstage-owner Coach
  // auto-scroll fires exactly once after the snapshot loads. Without
  // it the effect would re-trigger on every snapshot update (re-audit
  // success · weekly refresh · etc) and steal scroll mid-interaction.
  const coachAutoScrolledRef = useRef(false)
  // 2026-05-19 · polish gate state dropped (CEO 피드백 · "분석 후부터
  // 바로 가능하게 하자"). Audit-then-stage is one click now; the
  // description/image polish form can still be reached via EDIT, just
  // not as a blocker on the audition path.
  // 2026-05-18 · banner-level audition flow (CEO 피드백 · PUT ON STAGE
  // 버튼이 실제 audition_project RPC 까지 실행되어야 한다 · polish 부족
  // 시 무엇이 빠졌는지 명시). Mirrors AuditCoachPanel's auditionNow
  // logic · separate state so the two surfaces don't fight each other.
  const [auditionBusy,    setAuditionBusy]    = useState(false)
  const [auditionError,   setAuditionError]   = useState<string | null>(null)
  // 2026-05-18 · Market edit modal · Market tab dropped from
  // OwnerToolsTabs · About section now carries the inline EDIT
  // affordance, this state opens MarketPositionForm in a modal.
  const [marketEditOpen,  setMarketEditOpen]  = useState(false)
  const [confirmRemove,   setConfirmRemove]   = useState(false)
  const [removeBusy,      setRemoveBusy]      = useState(false)
  const [removeError,     setRemoveError]     = useState<string | null>(null)
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

      // 2026-05-18 bugfix · these queries were keyed off the URL param
      // `id`, which is the slug ("10m") on the canonical-URL path.
      // analysis_snapshots.project_id / timeline / forecasts / applauds
      // are all UUID-keyed columns, so the slug never matched and the
      // page rendered as "no snapshots yet" even when the project had
      // a real audit on file. Coach gate (latestSnapRaw !== null) also
      // stayed false because of this · which was why /projects/10m
      // never showed the coaching panel. Switched to proj.id (the
      // resolved UUID from fetchProjectByIdOrSlug above).
      const [{ data: latest }, tlPts, fcRows, apRows] = await Promise.all([
        supabase
          .from('analysis_snapshots')
          .select('id, score_auto, score_total, score_total_delta, delta_from_parent, rich_analysis, lighthouse, github_signals, trigger_type, created_at')
          .eq('project_id', proj.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        fetchProjectTimeline(proj.id),
        fetchProjectForecasts(proj.id),
        fetchProjectApplauds(proj.id),
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
      // 2026-05-19 · CEO 피드백 · top engagement row needs view count.
      // Fire-and-forget track_project_view (daily-deduped server-side)
      // then refetch project_pulse_stats so the VIEWS chip reflects this
      // visit. Same pattern CommunityPulseStrip used before it was
      // dissolved into the hero row.
      void (async () => {
        try { await supabase.rpc('track_project_view', { p_project_id: proj.id }) } catch {}
        try {
          const { data: pulse } = await supabase.rpc('project_pulse_stats', { p_project_id: proj.id })
          if (pulse && typeof (pulse as { views?: number }).views === 'number') {
            setViewsCount((pulse as { views: number }).views)
          }
        } catch {}
      })()
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

  // ── Backstage banner audition handler · 2026-05-18 ──
  // CEO 피드백 · the banner's PUT ON STAGE button was a Link to
  // /backstage · users wanted it to actually run the audition right
  // here. 2026-05-19 CEO 피드백 · "분석 후부터 바로 가능하게 하자" —
  // dropped the description+image polish guard. Audit done is enough
  // to step on stage; the creator can polish the public card later
  // via EDIT. audition_project RPC runs directly; on no_ticket we
  // hand off to Stripe checkout (same as AuditionPromoteCard).
  const handleBannerAudition = async () => {
    if (!project || auditionBusy) return
    setAuditionError(null)
    setAuditionBusy(true)
    try {
      const { data, error } = await supabase.rpc('audition_project', { p_project_id: project.id })
      if (error) throw new Error(error.message)
      const result = data as { ok: boolean; reason?: string }
      if (result.ok) {
        window.dispatchEvent(new CustomEvent('commitshow:tickets-updated'))
        const refreshed = await fetchProjectById(project.id)
        if (refreshed) setProject(refreshed)
        setAuditionBusy(false)
        return
      }
      if (result.reason === 'no_ticket') {
        // Out of tickets · hand off to Stripe checkout · success_url
        // returns to /submit?payment=success&audition_target=<id>
        // where PostPaymentAuditionPromote finishes the promotion.
        const { data: sessionRes } = await supabase.auth.getSession()
        const token = sessionRes.session?.access_token
        if (!token) throw new Error('Sign in expired · refresh and try again.')
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
        const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ kind: 'audit_fee', audition_target: project.id }),
        })
        const body = await res.json()
        if (!res.ok || !body.url) throw new Error(body.error || `Checkout failed (${res.status})`)
        window.location.assign(body.url)
        return
      }
      throw new Error(result.reason ?? 'Audition failed')
    } catch (err) {
      setAuditionError((err as Error).message)
      setAuditionBusy(false)
    }
  }

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

  // ── Backstage-owner Coach surface · 2026-05-17 ──
  // When a backstage owner lands on /projects/<id> (typically via the
  // OPEN button on /backstage), scroll to the Coach panel so the
  // coaching loop is what they see first. Coach now sits under
  // "About this project" (moved 2026-05-17b) so it's also in the
  // natural reading flow — auto-scroll just removes the "did I land
  // on the right page" hesitation. Once-per-mount via a ref so a
  // re-audit success refetch doesn't yank scroll mid-session.
  useEffect(() => {
    if (!project || !latestSnapRaw) return
    if (project.status !== 'backstage') return
    const isOwn = !!(user && user.id === project.creator_id)
    if (!isOwn) return
    if (coachAutoScrolledRef.current) return
    coachAutoScrolledRef.current = true
    // Slight delay so the panel has painted before we scroll to it.
    window.setTimeout(() => {
      document.getElementById('audit-coach-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 120)
  }, [project, latestSnapRaw, user])

  // Scroll-spy · highlight the section nav chip that matches the viewport
  useEffect(() => {
    if (loading) return
    const ids = ['analysis', 'activity', 'backstage', 'brief', 'owner-utilities']
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
        title="Product not found"
        message="It may have been removed or the URL is wrong. Try the ladder for active products."
        homeHref="/products"
      />
    )
  }

  const canForecast = !!user && user.id !== project.creator_id
  const isOwner     = !!user && user.id === project.creator_id

  // 2026-05-18 · BACKSTAGE non-owner curtain page (CEO 피드백 ·
  // "백스테이지 = 리스트에 작성자/점수밴드/프로젝트 상세 내용 노출안함").
  // /products lists backstage rows now (RLS opened 2026-05-18) · clicking
  // through must keep the curtain. Render a minimal page with title +
  // thumbnail placeholder + StageBadge + curtain explanation · no
  // description, no audit report, no comments, no forecast/applaud,
  // no Coach. Owner viewing their own backstage gets the full
  // management hub (handled below the early return).
  if (project.status === 'backstage' && !isOwner) {
    return <BackstageCurtainPage project={project} />
  }
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
  // 2026-05-18 (CEO 피드백) · Overview tab removed · its content
  // moved into the top of Analysis. "Private brief" → "Creator's
  // notes" to match section heading.
  // 2026-05-18b · Activity + Backstage tabs hidden when project is
  // status='backstage' · those sections themselves are conditional
  // on the same gate (forecasts/applauds gated to on-stage; Phase 2
  // brief lock collapsible collides with the stage name when the
  // project is literally backstage). Owner gets Analysis +
  // Creator's notes only on a backstage project · cleaner.
  const sections: Array<{ id: string; label: string; ownerOnly?: boolean }> = [
    { id: 'analysis',  label: 'Analysis' },
  ]
  if (project.status !== 'backstage') {
    sections.push({ id: 'activity',  label: 'Activity' })
    sections.push({ id: 'backstage', label: 'Backstage' })
  }
  if (isOwner) sections.push({ id: 'brief', label: "Creator's notes", ownerOnly: true })

  // Audition delta badge · latest round change (reused in hero + scan strip)
  const latestSnap = timeline[timeline.length - 1]
  const roundDelta = latestSnap?.score_total_delta ?? null
  const roundCount = timeline.length

  // 2026-05-23 · CEO 피드백 · "환산점수(73)로 통일해서 보여줘야 한다".
  // URL fast lane stores score_auto (~24) which normalizes to 73 via
  // urlLanePolish, but project.score_total is the platform /50 mapping
  // (48). Every UI surface that shows a /100 number to the user must
  // read displayedScore, not project.score_total, or the page reads
  // 73 up top and 48 below. ScanStrip already lane-aware (line ~1190)
  // — the rest (share menu band · AnalysisResultCard headline ·
  // OwnerUtilities · ShareToXModal · ScoreTimeline last point) get
  // threaded the lane-normalized number too.
  const currentLane   = laneOf(project)
  const displayedScore = displayScore(project)

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-5xl mx-auto">
        {/* Back link · /projects redirects to /products · CEO 피드백
            2026-05-19 · label updated to canonical destination. */}
        <button
          onClick={() => navigate('/products')}
          className="mb-5 font-mono text-xs tracking-wide"
          style={{ background: 'transparent', color: 'rgba(248,245,238,0.5)', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,245,238,0.5)')}
        >
          ← BACK TO PRODUCTS
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

        {/* Backstage banner · status='backstage' (owner-only) ──
              2026-05-18 · Audition CTA promoted back into this banner
              after CEO 피드백 · "백스테이지에서 온스테이지로의 권유가
              현재 노출되지 않고 있는 상태". The audition button was
              buried inside the Coach panel's auto-audition prompt
              (which only fires after a band climb), so a backstage
              owner with a never-re-audited project had no visible
              path to "Put it on stage". Now the option is explicit
              at the top of every backstage owner page · the Coach
              handles the climb-first flow underneath. */}
        {project.status === 'backstage' && isOwner && (() => {
          // Polish check · what's missing before audition can fire.
          // Surfaced inline so the user sees WHY the button might
          // take them to the gate (not just "fix it somewhere"). The
          // button still works in both states · it expands the polish
          // gate when missing, otherwise fires the audition_project
          // RPC directly via handleBannerAudition.
          const hasDescription = !!(project.description && project.description.trim().length > 0)
          const hasImage       = Array.isArray(project.images) && project.images.length > 0
          const missing: string[] = []
          if (!hasDescription) missing.push('description')
          if (!hasImage)       missing.push('thumbnail image')
          const ready = missing.length === 0
          return (
            <div className="mb-4 p-4 flex flex-col gap-3" style={{
              background: 'rgba(240,192,64,0.07)',
              border: '1px solid rgba(240,192,64,0.35)',
              borderRadius: '2px',
            }}>
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
                    // BACKSTAGE · LISTED PUBLICLY · CREATOR + DETAILS HIDDEN
                  </div>
                  <div className="font-mono text-[11px] mt-1 max-w-2xl" style={{ color: 'rgba(248,245,238,0.65)', lineHeight: 1.6 }}>
                    Your project shows on /products as a curtain card · score, byline, description all sealed.
                    Climb the coach below for a higher score first, OR put it on stage now to open the full
                    card and start collecting forecasts.
                  </div>
                  {!ready && (
                    <div className="font-mono text-[11px] mt-2" style={{ color: 'var(--scarlet)', lineHeight: 1.55 }}>
                      Stage register requires: <strong>{missing.join(' + ')}</strong> · clicking PUT ON STAGE opens the gate.
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleBannerAudition}
                  disabled={auditionBusy}
                  className="font-mono text-xs font-medium tracking-widest px-4 py-2 whitespace-nowrap"
                  style={{
                    background:     ready ? 'var(--gold-500)' : 'rgba(240,192,64,0.5)',
                    color:          'var(--navy-900)',
                    border:         'none',
                    borderRadius:   '2px',
                    cursor:         auditionBusy ? 'wait' : 'pointer',
                    opacity:        auditionBusy ? 0.6 : 1,
                  }}
                  title={ready
                    ? 'Audition this project · fires audition_project RPC'
                    : `Missing: ${missing.join(', ')} · clicking opens the polish gate`}
                >
                  {auditionBusy
                    ? 'AUDITIONING…'
                    : ready
                      ? 'PUT ON STAGE →'
                      : 'COMPLETE POLISH →'}
                </button>
              </div>
              {auditionError && (
                <div className="font-mono text-[11px] px-3 py-2" style={{
                  background:   'rgba(200,16,46,0.08)',
                  border:       '1px solid rgba(200,16,46,0.4)',
                  borderRadius: '2px',
                  color:        'var(--scarlet)',
                }}>
                  {auditionError}
                </div>
              )}
            </div>
          )
        })()}


        {/* ── Pre-audition Coach · §16.2 (2026-05-15) ──
              Backstage-only owner surface. Lists 3-6 detected quick wins
              with how-to + checkbox + Re-audit CTA. Reuses the existing
              handleHeroReanalyze pipeline so a successful re-audit cycles
              the panel with fresh evidence + fires the soft audition
              prompt when the band climbs. Hidden once the project is on
              stage (status='active') — by then the audit + AnalysisResultCard
              already cover the same ground. */}
        {/* 2026-05-17 · Coach + Polish gate moved DOWN to right under
            the "About this project" section so they sit in the page's
            natural reading flow instead of floating above the hero
            header (CEO 피드백 · the user couldn't find the coaching).
            Backstage banner still sits up here so the privacy state
            is named at the top. */}

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
                <div className="mb-3 flex items-center gap-2 flex-wrap">
                  {/* StageBadge replaces the old PROJECT · STATUS eyebrow
                      (2026-05-17). Same source of truth used in Hero,
                      LadderRow, FeaturedLaneCard, ProfilePage. preview
                      rows (CLI walk-on, no creator) get no badge; their
                      banner above already explains the state. */}
                  <StageBadge project={project} size="md" />
                  {project.status === 'retry' && (
                    <span className="font-mono text-[10px] tracking-widest px-2 py-0.5" style={{
                      background: 'rgba(200,16,46,0.10)',
                      color: 'var(--scarlet)',
                      border: '1px solid rgba(200,16,46,0.35)',
                      borderRadius: '2px',
                    }}>
                      ROOKIE CIRCLE
                    </span>
                  )}
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
                  {/* Curtain treatment · §1-A ⑥. BACKSTAGE rows hide
                      the author byline + grade chip from non-owners so
                      the project reads as anonymous work-in-progress
                      until the creator auditions onto ON STAGE. Owners
                      always see their own byline so they don't get
                      disoriented by their own incognito card. */}
                  {project.status === 'backstage' && !isOwner ? (
                    <div className="flex items-center gap-2">
                      <div
                        aria-hidden="true"
                        className="flex items-center justify-center font-mono text-xs overflow-hidden"
                        style={{
                          width: '24px', height: '24px',
                          background: 'rgba(248,245,238,0.08)',
                          color: 'rgba(248,245,238,0.45)',
                          border: '1px solid rgba(248,245,238,0.18)',
                          borderRadius: '2px',
                        }}
                      >
                        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 4h16" />
                          <path d="M6 4v16c0-3 1.5-5 3-7" />
                          <path d="M18 4v16c0-3-1.5-5-3-7" />
                          <path d="M12 4v16" />
                        </svg>
                      </div>
                      <div className="font-mono text-xs italic" style={{ color: 'var(--text-muted)' }}>
                        behind the curtain · author not revealed until audition
                      </div>
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
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
                    title="Names the workspace dirs the scan actually traversed. Useful when a product is a monorepo — concerns may apply to a sub-app, not the whole org."
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
                  // §15-E lane-normalized · URL fast lane shows /33 polish,
                  // not raw score_total · share card and band must match
                  // what the user sees on the page (CEO 피드백 2026-05-23).
                  const score = displayedScore
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
                {/* Engagement chips · 2026-05-19 · CEO 피드백 ·
                    "박수 버튼은 아이콘과 숫자 분리해서 숫자 누르면
                    박수친 사람들 보여주게 · forecasts 버튼도 숫자와
                    분리해서 줘 · views 도 상단으로 이동". Owner and
                    visitor both see the chips · only the applaud toggle
                    itself is disabled for owner (can't applaud own
                    content). Forecast follows the same split layout:
                    🎯 icon (cast a forecast · gated to voting-phase
                    forecasters) + adjacent count pill (opens the
                    forecasters list modal). */}
                <ApplaudButton
                  targetType="product"
                  targetId={project.id}
                  viewerMemberId={user?.id ?? null}
                  isOwnContent={isOwner}
                  size="sm"
                  variant="emoji"
                  onChange={() => fetchProjectApplauds(project.id).then(setApplauds)}
                  onCountClick={applauds.length > 0 ? () => setPulseModal('applauds') : undefined}
                />

                {(() => {
                  const forecastN     = forecasts.length
                  const canCast       = canForecast && isVotingPhase
                  // Hide the whole forecast block when no action is
                  // available AND no forecasts exist yet (nothing to
                  // show · keeps the row tidy on fresh projects).
                  if (!canCast && forecastN === 0) return null
                  const predicted     = forecasts.filter(f => typeof f.predicted_score === 'number')
                  const avgPredicted  = predicted.length === 0
                    ? null
                    : Math.round(predicted.reduce((s, f) => s + (f.predicted_score ?? 0), 0) / predicted.length)
                  const iconTitle = canCast
                    ? (forecastN === 0
                        ? 'No forecasts yet · be the first to call it'
                        : 'Cast a forecast')
                    : (forecastN === 0
                        ? 'No forecasts yet'
                        : avgPredicted == null
                          ? `${forecastN} forecast${forecastN === 1 ? '' : 's'} · no predicted scores yet`
                          : `${forecastN} forecast${forecastN === 1 ? '' : 's'} · room is calling ${avgPredicted}/100 on average`)
                  const countTitle = `See ${forecastN} forecaster${forecastN === 1 ? '' : 's'}`
                                   + (avgPredicted != null ? ` · avg ${avgPredicted}/100` : '')
                  return (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4em' }}>
                      <button
                        type="button"
                        onClick={canCast ? () => setForecastOpen(true) : undefined}
                        disabled={!canCast}
                        title={iconTitle}
                        aria-label={iconTitle}
                        className="font-mono text-xs font-medium tracking-wide px-3 py-1.5 inline-flex items-center justify-center gap-1.5"
                        style={{
                          background:   canCast ? 'rgba(240,192,64,0.08)' : 'transparent',
                          color:        canCast ? 'var(--gold-500)' : 'var(--text-label)',
                          border:       `1px solid ${canCast ? 'rgba(240,192,64,0.3)' : 'rgba(255,255,255,0.12)'}`,
                          borderRadius: '2px',
                          cursor:       canCast ? 'pointer' : 'not-allowed',
                          opacity:      canCast ? 1 : 0.7,
                        }}
                      >
                        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>🎯</span>
                        <span>FORECAST</span>
                      </button>
                      {forecastN > 0 && (
                        <button
                          type="button"
                          onClick={() => setPulseModal('forecasts')}
                          title={countTitle}
                          aria-label={countTitle}
                          className="font-mono text-xs tracking-wide px-3 py-1.5 inline-flex items-center gap-1.5"
                          style={{
                            background:   'rgba(96,165,250,0.06)',
                            color:        'rgba(96,165,250,0.95)',
                            border:       '1px solid rgba(96,165,250,0.28)',
                            borderRadius: '2px',
                            cursor:       'pointer',
                          }}
                        >
                          <span className="tabular-nums" style={{ color: 'var(--cream)' }}>{forecastN}</span>
                        </button>
                      )}
                    </span>
                  )
                })()}
                {viewsCount != null && viewsCount > 0 && (
                  <span
                    title={`${viewsCount.toLocaleString()} unique view${viewsCount === 1 ? '' : 's'}`}
                    className="font-mono text-xs tracking-wide px-3 py-1.5 inline-flex items-center gap-1.5"
                    style={{
                      background:   'rgba(255,255,255,0.03)',
                      color:        'var(--text-secondary)',
                      border:       '1px solid rgba(255,255,255,0.10)',
                      borderRadius: '2px',
                    }}
                  >
                    <span style={{ opacity: 0.70 }}>VIEWS</span>
                    <span className="tabular-nums" style={{ color: 'var(--cream)' }}>{viewsCount.toLocaleString()}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* 2026-05-19 · CEO 피드백 · CommunityPulseStrip dissolved.
            VIEWS · FORECASTS · APPLAUDS moved into the hero engagement
            row above (click count → PulseListModal). Comments preview
            now sits in its own block below the score banner (rendered
            via <ProjectComments> with hidePreview unset · 2 recent
            inline + bottom-sheet drawer on tap). */}

        {/* Pulse list modal · shared trigger for the APPLAUDS / FORECASTS
            count chips up in the hero. */}
        {pulseModal && (
          <PulseListModal
            projectId={project.id}
            mode={pulseModal}
            onClose={() => setPulseModal(null)}
          />
        )}

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
          <AboutProjectSection
            projectId={project.id}
            projectName={project.project_name}
            isOwner={isOwner}
            onEditMarket={() => setMarketEditOpen(true)}
          />
        </div>

        {/* ── Coach + Polish gate · 2026-05-17 moved here from top of
              page (CEO 피드백 · the user kept missing it above the
              hero card). Sits right under "About this project" so a
              backstage owner reading down the page hits the
              actionable surface naturally instead of scrolling up to
              find it. Gated to status='backstage' + isOwner +
              snapshot loaded. */}
        {project.status === 'backstage' && isOwner && latestSnapRaw !== null && (
          <div id="audit-coach-panel" className="mt-4">
            <AuditCoachPanel
              project={project}
              snapshotRich={latestSnapRaw.rich}
              lighthouse={latestSnapRaw.lighthouse}
              githubSignals={latestSnapRaw.githubSignals}
              onReanalyze={handleHeroReanalyze}
              reanalyzing={heroRerunBusy}
              previousBand={preReauditBand}
              onAuditioned={async () => {
                const refreshed = await fetchProjectById(project.id)
                if (refreshed) setProject(refreshed)
              }}
            />
          </div>
        )}
        {/* 2026-05-19 · BackstagePolishGate inline render block dropped.
            Polish (description + images) is no longer a gate on the
            audition path — creators step on stage right after analysis
            and clean up the public card via EDIT later. */}

        {/* ── Owner coach · 'Next step' fix-prompt CTA, lifted out of the
              ANALYSIS section so the most actionable surface lands above
              the fold instead of after a scroll-past. Renders only when
              isOwner + has concerns + not yet dismissed. */}
        {isOwner && snapshotResult?.rich?.scout_brief && (
          <OwnerNextStepBanner
            projectName={project.project_name}
            githubUrl={project.github_url}
            scoreTotal={displayedScore}
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

        {/* ── 2026-05-19 · CEO 피드백 · CommunityPulseStrip dropped.
              The comments tile is now an inline preview card showing
              the 2 most recent comments. Tapping anywhere on the card
              opens the bottom-sheet drawer (slides up with a handle).
              VIEWS · FORECASTS · APPLAUDS chips relocated to the hero
              engagement row above. */}
        <ProjectComments
          projectId={project.id}
          viewerMemberId={member?.id ?? null}
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
          {/* ANALYSIS · 2026-05-18 · merged the standalone Overview
              section into Analysis (CEO 피드백 consolidation). The
              top of Analysis carries description pullquote +
              screenshots + ScoreTimeline + VibeConcerns + NativeApp
              panels (all the "what's the project + what did the
              audit find graphically" content), then the full
              AnalysisResultCard with the textual audit report. */}
          <section id="analysis" className="scroll-mt-28">
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

            <div className="grid gap-5 mb-8">
              <ScoreTimeline
                showAsBand={showAsBand}
                points={(() => {
                  if (timeline.length === 0) return timeline
                  // For URL fast lane the snapshots store score_total in
                  // the /50 platform mapping (e.g. 48). The page hero
                  // displays the /33 lane polish (e.g. 73). Re-map every
                  // timeline point through urlLanePolish so the chart
                  // reads the same number as the hero. CEO 피드백
                  // 2026-05-23 · 환산점수 통일.
                  const laneAdjusted = currentLane === 'url_fast_lane'
                    ? timeline.map(p => {
                        // Reverse the platform /50 mapping to recover the
                        // raw score_auto · urlLanePolish then renormalizes
                        // to /33. score_total = round(score_auto/50*100) →
                        // score_auto ≈ score_total*50/100 = score_total/2.
                        const recoveredAuto = Math.round((p.score_total ?? 0) / 2)
                        return { ...p, score_total: urlLanePolish(recoveredAuto) }
                      })
                    : timeline
                  const last = laneAdjusted[laneAdjusted.length - 1]
                  if (last.score_total === displayedScore) return laneAdjusted
                  const prevSnap = laneAdjusted.length >= 2 ? laneAdjusted[laneAdjusted.length - 2] : null
                  const liveDelta = prevSnap ? displayedScore - prevSnap.score_total : last.score_total_delta
                  return [
                    ...laneAdjusted.slice(0, -1),
                    { ...last, score_total: displayedScore, score_total_delta: liveDelta },
                  ]
                })()}
              />
            </div>

            {/* AI Coder 7 Frames · signature framework — sits between
                score timeline and full Analysis card so beginners see the
                most actionable failure-mode summary first.
                2026-05-23 · CEO 피드백 cross-check · source-pattern frames
                (CORS permissive · observability libs · webhook idempotency
                · hardcoded URLs etc.) emit PASS/FAIL on empty evidence,
                which is wrong when the source was never scanned. Two
                cases the panel must skip:
                  · URL fast lane — repo never attempted
                  · fallback scan — github fetch failed (rate-limited /
                    private / 404), evidence-arrays are empty by
                    accident not by cleanliness
                Runtime-detectable signals (security_headers · ACAO ·
                meta tags) live on the snapshot's rich_analysis and are
                surfaced elsewhere — those stay visible regardless. */}
            {vibeConcerns
              && currentLane !== 'url_fast_lane'
              && !(scannedScope ?? '').toLowerCase().startsWith('fallback')
              && (
              <div className="mb-8">
                <VibeConcernsPanel vibeConcerns={vibeConcerns} />
              </div>
            )}

            {/* Native-app surface · only when latest snapshot detected
                form_factor='native_app'. Shows store gates + native
                footguns + distribution evidence in lieu of Lighthouse
                / live URL probes. */}
            {nativeBreakdown && (
              <div className="mb-8">
                <NativeAppPanel breakdown={nativeBreakdown} footguns={nativeFootguns} />
              </div>
            )}

            {/* Analysis report header + AnalysisResultCard below */}
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
                result={{ ...snapshotResult, score_total: displayedScore }}
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
          {/* ACTIVITY hidden on status='backstage' (CEO 피드백 2026-05-18) ·
              backstage projects can't receive forecasts or applauds
              (those gates require on-stage status) so rendering "0
              forecasts · 0 applauds" is just noise on the page. */}
          {project.status !== 'backstage' && (
            <CollapsibleSection
              id="activity"
              label="ACTIVITY"
              hint="Forecasts and applauds on this product."
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
          )}

          {/* TOKEN USAGE · public · only renders when receipt exists */}
          <section className="scroll-mt-28">
            <TokenEfficiencyPanel projectId={project.id} isOwner={isOwner} />
          </section>

          {/* BACKSTAGE (Phase 2 brief lock) · hidden on status='backstage'
              (CEO 피드백 2026-05-18) · the project is literally backstage
              right now, so the "Sealed until Encore · public-facing Phase
              2 brief unlocks at score 84+" framing collides with the
              stage name and confuses the owner. Brief content for
              owners lives in CREATOR'S NOTES below; this collapsible
              is for visitors / on-stage projects to see "the brief
              opens after Encore". */}
          {project.status !== 'backstage' && (
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
          )}

          {/* CREATOR'S NOTES · owner only · the Phase 2 brief moat
              content (Failure Log · Decisions · Delegation · Next
              Blocker · Stack Fingerprint). 2026-05-18 (CEO 피드백 ·
              "분석과 PRIVATE BRIEF 가 여러면에서 겹친다") · was
              "PRIVATE BRIEF" with tab bar (Brief / Market / README /
              Token). Market dropped (now editable inline via About
              card's EDIT button). README badge + Token receipt
              demoted to a small Owner Utilities footer below ·
              brief tab is now just the brief panel itself, no tab
              wrapper · name updated to "CREATOR'S NOTES" to signal
              this is user-written content distinct from the
              engine-generated Analysis above. */}
          {isOwner && (
            <section id="brief" className="scroll-mt-28">
              <SectionHeader
                label="CREATOR'S NOTES"
                hint="Failures · decisions · delegation · next blocker · stack fingerprint. Your own write-up, distinct from the audit."
              />
              <OwnerBriefPanel projectId={project.id} />
            </section>
          )}

          {/* Owner Utilities · 2026-05-18 · README badge snippet +
              Token receipt extracted from the old OwnerToolsTabs bar
              (they're utility tools, not brief content, so they
              don't belong under CREATOR'S NOTES). Default collapsed
              · owner opens when they need either tool. */}
          {isOwner && (
            <CollapsibleSection
              id="owner-utilities"
              label="OWNER UTILITIES"
              hint="README badge snippet · Token receipt form. Optional tools."
              summary="Click to expand"
            >
              <OwnerUtilities
                projectId={project.id}
                projectName={project.project_name}
                projectSlug={project.slug}
                githubUrl={project.github_url}
                projectScore={displayedScore}
              />
            </CollapsibleSection>
          )}

          {/* Danger zone · owner-only · backstage-only. Deleting a
              project that's already auditioned would orphan scout
              votes, applauds, snapshots, ladder rank, encore
              certificates — so we only expose Remove while the
              project is still in the private backstage state. RLS
              enforces the same gate server-side (20260517 migration).
              Two-step confirm so a misclick can't wipe the audit. */}
          {isOwner && project.status === 'backstage' && (
            <section className="scroll-mt-28 mt-12">
              <SectionHeader label="DANGER ZONE" hint="Remove this audition entirely — backstage rows only · auditioned projects can't be deleted." />
              {removeError && (
                <div className="mb-3 px-3 py-2 font-mono text-xs" style={{
                  background: 'rgba(200,16,46,0.08)',
                  border: '1px solid rgba(200,16,46,0.4)',
                  borderRadius: '2px',
                  color: 'var(--scarlet)',
                }}>
                  {removeError}
                </div>
              )}
              <div className="card-navy p-4 flex items-center justify-between gap-3 flex-wrap" style={{
                border: '1px solid rgba(200,16,46,0.25)',
                borderRadius: '2px',
              }}>
                <div className="font-mono text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  Permanently delete this audition · snapshots, audit-token history,
                  and the thumbnail are removed too. Cannot be undone.
                </div>
                {confirmRemove ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[10px]" style={{ color: 'var(--scarlet)' }}>Sure?</span>
                    <button
                      type="button"
                      disabled={removeBusy}
                      onClick={async () => {
                        setRemoveBusy(true)
                        setRemoveError(null)
                        const { error: e } = await deleteProject(project.id)
                        if (e) {
                          setRemoveError(`Remove failed · ${e}`)
                          setRemoveBusy(false)
                          return
                        }
                        navigate('/backstage')
                      }}
                      className="px-3 py-1.5 font-mono text-[11px] font-medium tracking-wide"
                      style={{
                        background:   'var(--scarlet)',
                        color:        'var(--cream)',
                        border:       'none',
                        borderRadius: '2px',
                        cursor:       removeBusy ? 'wait' : 'pointer',
                        opacity:      removeBusy ? 0.6 : 1,
                      }}
                    >
                      {removeBusy ? 'REMOVING…' : 'REMOVE FOREVER'}
                    </button>
                    <button
                      type="button"
                      disabled={removeBusy}
                      onClick={() => setConfirmRemove(false)}
                      className="px-3 py-1.5 font-mono text-[11px] tracking-wide"
                      style={{
                        background:   'transparent',
                        color:        'var(--cream)',
                        border:       '1px solid rgba(248,245,238,0.2)',
                        borderRadius: '2px',
                        cursor:       'pointer',
                      }}
                    >
                      CANCEL
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    className="px-3 py-1.5 font-mono text-[11px] tracking-wide whitespace-nowrap"
                    style={{
                      background:   'transparent',
                      color:        'var(--scarlet)',
                      border:       '1px solid rgba(200,16,46,0.4)',
                      borderRadius: '2px',
                      cursor:       'pointer',
                    }}
                  >
                    Remove audition
                  </button>
                )}
              </div>
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

      {/* 2026-05-18 · Market position edit modal · MarketPositionForm
          lifted from the old "Market" tab inside OwnerToolsTabs ·
          About card now carries the EDIT button that opens this. */}
      {marketEditOpen && isOwner && (
        <MarketEditModal
          projectId={project.id}
          onClose={() => setMarketEditOpen(false)}
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
        score={shareJump?.score ?? displayedScore}
        delta={shareJump?.delta ?? 0}
        url={typeof window !== 'undefined' ? `${window.location.origin}/projects/${project.id}` : `/projects/${project.id}`}
        takeaway={shareJump?.takeaway ?? null}
      />
    </section>
  )
}

// Backstage non-owner curtain page · 2026-05-18 · CEO 피드백 · once
// /products started listing all backstage rows publicly, clicking
// through couldn't reveal the author or any project details. This
// is the minimum-info card a non-owner sees: title + thumbnail (or
// curtain placeholder) + StageBadge + a single sentence + a few
// safe teaser signals (audit count, category, tech stack chips,
// strength AXIS labels) so viewers have a reason to come back when
// it auditions. NO description, NO audit report, NO comments, NO
// forecast/applaud UI, NO bullet content (bullets can leak
// project-identifying details · axis labels are safe).
function BackstageCurtainPage({ project }: { project: Project }) {
  const [strengthAxes, setStrengthAxes] = useState<string[]>([])

  // Fetch only the AXIS labels of the project's strengths (e.g.
  // "Security · UX · Code") · the bullet text itself often names
  // specific files / line counts / framework versions that would
  // re-identify the project, so it stays curtained. Just the axis
  // tells the viewer "something is solid over there" without
  // unmasking what. Best-effort · UI tolerates an empty list.
  useEffect(() => {
    let alive = true
    supabase
      .from('analysis_snapshots')
      .select('rich_analysis')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return
        const strengths = (data.rich_analysis as { scout_brief?: { strengths?: unknown } } | null)?.scout_brief?.strengths
        if (!Array.isArray(strengths)) return
        const axes = Array.from(new Set(
          strengths.slice(0, 4).map(s => {
            if (s && typeof s === 'object' && 'axis' in s) return String((s as { axis?: unknown }).axis ?? '')
            return ''
          }).filter(Boolean),
        )).slice(0, 3)
        setStrengthAxes(axes)
      })
    return () => { alive = false }
  }, [project.id])

  const techLayers = Array.isArray(project.tech_layers) ? project.tech_layers.slice(0, 5) : []
  const categoryLabel = formatCategoryLabel(project.detected_category ?? project.business_category)
  const auditCount    = project.audit_count ?? 0

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-3xl mx-auto">
        <Link
          to="/products"
          className="inline-block mb-3 font-mono text-xs tracking-wide"
          style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
        >
          ← BACK TO PRODUCTS
        </Link>

        <div className="card-navy overflow-hidden" style={{ borderRadius: '2px' }}>
          {/* Hero image · falls back to the shared BackstageCurtainArt
              full-bleed theater curtain SVG (gold valance + tassels +
              pleats + spotlight + caption · same component the lane
              card uses). Creator can override by uploading a
              thumbnail. */}
          <div className="relative" style={{ aspectRatio: '1200 / 630', background: 'var(--navy-800)' }}>
            {project.thumbnail_url ? (
              <img src={project.thumbnail_url} alt="" loading="lazy" className="w-full h-full block" style={{ objectFit: 'cover' }} />
            ) : (
              <BackstageCurtainArt
                caption="BEHIND THE CURTAIN"
                subCaption="audition opens the card"
              />
            )}
          </div>

          <div className="p-5 md:p-7">
            <div className="mb-3">
              <StageBadge stage="backstage" size="md" />
            </div>
            <h1 className="font-display font-black text-2xl md:text-3xl leading-tight mb-3" style={{ color: 'var(--cream)' }}>
              {project.project_name || 'Untitled audition'}
            </h1>
            <p className="font-light text-sm md:text-base mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              This audition is behind the curtain. The creator hasn't put it on stage yet, so the
              audit report, the score, and the author are kept private. Here's what we can share
              without unmasking the project.
            </p>

            {/* ── Safe teaser strip · non-identifying signals only ──
                Axis labels (not bullet text) · category · tech chips ·
                iteration count. Gives a curtain-respecting taste of
                what's behind the curtain without revealing creator
                or audit specifics. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {strengthAxes.length > 0 && (
                <TeaserChip
                  label="Audit found strengths on"
                  tone="#00D4AA"
                >
                  {strengthAxes.join(' · ')}
                </TeaserChip>
              )}
              {categoryLabel && (
                <TeaserChip label="Category" tone="var(--gold-500)">
                  {categoryLabel}
                </TeaserChip>
              )}
              {techLayers.length > 0 && (
                <TeaserChip label="Stack" tone="var(--cream)">
                  {techLayers.join(' · ')}
                </TeaserChip>
              )}
              {auditCount > 0 && (
                <TeaserChip label="Iteration" tone="var(--cream)">
                  {auditCount} audit cycle{auditCount === 1 ? '' : 's'} run
                </TeaserChip>
              )}
            </div>

            <p className="font-mono text-[11px] mt-5" style={{ color: 'var(--text-muted)' }}>
              Browse other vibe coders' work →{' '}
              <Link to="/products" style={{ color: 'var(--gold-500)' }}>/products</Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

// Tiny presentational chip for the curtain page's teaser grid. Plain
// label-on-top / value-below card · gold/teal/cream tone for accent
// matches the rest of the stage palette.
function TeaserChip({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <div
      className="px-3 py-2.5"
      style={{
        background:    'rgba(255,255,255,0.02)',
        border:        '1px solid rgba(255,255,255,0.06)',
        borderRadius:  '2px',
      }}
    >
      <div className="font-mono text-[10px] tracking-widest uppercase mb-1" style={{ color: 'var(--text-label)' }}>
        {label}
      </div>
      <div className="font-mono text-[12px]" style={{ color: tone, lineHeight: 1.5 }}>
        {children}
      </div>
    </div>
  )
}

// Human-readable category label · maps the internal enum slugs
// (e.g. "niche_saas") to a "Niche SaaS" presentation. Unknown
// values pass through with a fallback transform. Returns null when
// no category is set so the chip hides cleanly.
function formatCategoryLabel(cat: string | null | undefined): string | null {
  if (!cat) return null
  const MAP: Record<string, string> = {
    productivity_personal: 'Productivity · Personal',
    niche_saas:            'Niche SaaS',
    creator_media:         'Creator · Media',
    dev_tools:             'Developer Tools',
    ai_agents_chat:        'AI Agents · Chat',
    consumer_lifestyle:    'Consumer · Lifestyle',
    games_playful:         'Games · Playful',
    other:                 'Other',
  }
  if (MAP[cat]) return MAP[cat]
  // Unknown enum: title-case the slug for a passable fallback.
  return cat.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
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

// 2026-05-18 · OwnerToolsTabs deleted (CEO 피드백 consolidation).
//   · Brief tab → became the CREATOR'S NOTES section (OwnerBriefPanel
//     rendered directly, no tab wrapper)
//   · Market tab → AboutProjectSection's inline EDIT button opens
//     MarketEditModal below (single editable surface)
//   · README badge + Token receipt → demoted to OwnerUtilities
//     (collapsed-by-default section at the bottom of the page)

// MarketEditModal · portal-mounted MarketPositionForm. Triggered by
// AboutProjectSection's EDIT button on owner view. Same form the old
// Market tab hosted · just lives in a modal instead of a tab now.
function MarketEditModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         100,
        background:     'rgba(6,12,26,0.78)',
        backdropFilter: 'blur(4px)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        padding:        '20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card-navy w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ borderRadius: '2px' }}
      >
        <div className="flex items-baseline justify-between mb-4 gap-3">
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // EDIT · MARKET POSITION
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[10px] tracking-widest px-2 py-1"
            style={{
              background:   'transparent',
              color:        'var(--text-secondary)',
              border:       '1px solid rgba(255,255,255,0.15)',
              borderRadius: '2px',
              cursor:       'pointer',
            }}
          >
            CLOSE
          </button>
        </div>
        <MarketPositionForm
          projectId={projectId}
          prefill={{}}
          onConfirmed={() => onClose()}
        />
      </div>
    </div>,
    document.body,
  )
}

// OwnerUtilities · README badge snippet + Token receipt form stacked
// vertically inside the new "OWNER UTILITIES" collapsible section.
// No tab bar · these are two small standalone tools, easier to scan
// when both are visible at once after the user opens the section.
function OwnerUtilities({
  projectId, projectName, projectSlug, githubUrl, projectScore,
}: {
  projectId:    string
  projectName:  string
  projectSlug:  string | null
  githubUrl:    string | null
  projectScore: number | null
}) {
  return (
    <div className="space-y-6">
      <div>
        <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-label)' }}>
          README BADGE · show the score on GitHub
        </div>
        <BadgeSnippet projectId={projectId} projectName={projectName} projectSlug={projectSlug} githubUrl={githubUrl} />
      </div>
      <div>
        <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-label)' }}>
          TOKEN RECEIPT · join the token leaderboard
        </div>
        <TokenReceiptForm
          projectId={projectId}
          projectScore={projectScore}
          projectGithubUrl={githubUrl}
        />
      </div>
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
