// PreAuditionCoachSlot · adapter for the AuditCoachPanel · 2026-05-15.
//
// AuditCoachPanel needs a full Project row + the raw snapshot JSON
// columns (rich_analysis / lighthouse / github_signals) plus a working
// onReanalyze + onAuditioned. ProjectDetailPage already owns all that
// state. Other surfaces (SubmitForm step 5, future /me embeds) only
// hold a projectId — this slot fetches the rest, runs the re-audit
// pipeline, and stamps previousBand across re-audit firings so the
// band-climb prompt works the same way it does on the project page.
//
// Renders nothing while status != 'backstage' so the slot is a no-op
// once the project is on stage (or never was). Callers can drop it
// anywhere they have a projectId without status-checking themselves.
//
// Notes on the navigate-after-audition path:
//   · This surface is NOT /projects/<id> · so navigate() actually
//     remounts the destination · we let Coach's default fallback
//     (window.location.assign) fire by not passing onAuditioned, OR
//     we override with a SPA navigate via the navigateOnAuditioned
//     prop. SubmitForm passes the SPA flavor (already on /submit, so
//     /projects/<id> is a cross-route remount).

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuditCoachPanel } from './AuditCoachPanel'
import { supabase, type Project } from '../lib/supabase'
import { fetchProjectById } from '../lib/projectQueries'
import { analyzeProject, CooldownError } from '../lib/analysis'
import { scoreBand, displayScore } from '../lib/laneScore'

interface PreAuditionCoachSlotProps {
  projectId: string
  /** When true · after audition_project flips status active, the slot
   *  routes the user to /projects/<id> via react-router (SPA nav). When
   *  false (default) · the Coach panel just unmounts in place (status
   *  flips locally and the gate closes). SubmitForm wants the former
   *  to land the user on their public product page. */
  navigateOnAuditioned?: boolean
}

interface RawSnapshot {
  rich:          Record<string, unknown> | null
  lighthouse:    Record<string, unknown> | null
  githubSignals: Record<string, unknown> | null
}

export function PreAuditionCoachSlot({ projectId, navigateOnAuditioned = false }: PreAuditionCoachSlotProps) {
  const navigate = useNavigate()
  const [project,        setProject]        = useState<Project | null>(null)
  const [snap,           setSnap]           = useState<RawSnapshot | null>(null)
  const [rerunBusy,      setRerunBusy]      = useState(false)
  const [rerunError,     setRerunError]     = useState<string | null>(null)
  const [previousBand,   setPreviousBand]   = useState<ReturnType<typeof scoreBand> | null>(null)

  // Initial load · project row + latest snapshot raws in parallel.
  useEffect(() => {
    let alive = true
    void (async () => {
      const [p, s] = await Promise.all([
        fetchProjectById(projectId),
        supabase.from('analysis_snapshots')
          .select('rich_analysis, lighthouse, github_signals')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data }) => data ?? null),
      ])
      if (!alive) return
      if (p) setProject(p)
      if (s) setSnap({
        rich:          (s.rich_analysis  as Record<string, unknown>) ?? null,
        lighthouse:    (s.lighthouse     as Record<string, unknown>) ?? null,
        githubSignals: (s.github_signals as Record<string, unknown>) ?? null,
      })
    })()
    return () => { alive = false }
  }, [projectId])

  const handleReanalyze = async () => {
    if (!project || rerunBusy) return
    // Stamp band BEFORE the re-audit fires so post-audit currentBand
    // can diff against it · mirrors ProjectDetailPage.handleHeroReanalyze.
    setPreviousBand(scoreBand(displayScore(project)))
    setRerunBusy(true)
    setRerunError(null)
    try {
      await analyzeProject(projectId, 'resubmit')
      // Refetch project + new snapshot raws in parallel.
      const [refreshed, latest] = await Promise.all([
        fetchProjectById(projectId),
        supabase.from('analysis_snapshots')
          .select('rich_analysis, lighthouse, github_signals')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data }) => data ?? null),
      ])
      if (refreshed) setProject(refreshed)
      if (latest)   setSnap({
        rich:          (latest.rich_analysis  as Record<string, unknown>) ?? null,
        lighthouse:    (latest.lighthouse     as Record<string, unknown>) ?? null,
        githubSignals: (latest.github_signals as Record<string, unknown>) ?? null,
      })
    } catch (e) {
      if (e instanceof CooldownError) {
        setRerunError(`Re-audit available in ${e.retryAfterHours}h. The 24h cooldown prevents spam.`)
      } else {
        setRerunError(`Re-audit failed: ${(e as Error).message}`)
      }
    } finally {
      setRerunBusy(false)
    }
  }

  // Render gate · only show for owner's backstage projects. We don't
  // know the viewer's id here but the caller is responsible for only
  // dropping this on owner surfaces (SubmitForm step 5 is gated on
  // user.id === project.creator_id by the submit flow itself).
  if (!project || project.status !== 'backstage') return null
  // Snapshot raws are still loading · skip the Coach render so the
  // panel doesn't flash its empty state ("no quick wins left") while
  // detectQuickWins is running against all-null inputs. Returning null
  // here is fine UX-wise · the slot reappears within one round-trip
  // (~200ms typical) once the snapshot select resolves.
  if (snap === null) return null

  return (
    <>
      {rerunError && (
        <div
          className="mb-3 px-3 py-2 font-mono text-[11px]"
          style={{
            background: 'rgba(200,16,46,0.08)',
            border: '1px solid rgba(200,16,46,0.4)',
            borderRadius: '2px',
            color: 'var(--scarlet)',
          }}
        >
          {rerunError}
        </div>
      )}
      <AuditCoachPanel
        project={project}
        snapshotRich={snap?.rich          ?? null}
        lighthouse={snap?.lighthouse      ?? null}
        githubSignals={snap?.githubSignals ?? null}
        onReanalyze={handleReanalyze}
        reanalyzing={rerunBusy}
        previousBand={previousBand}
        onAuditioned={navigateOnAuditioned
          ? async () => {
              // SPA nav to the public product page · destination is a
              // different route so React Router remounts cleanly.
              setTimeout(() => navigate(`/projects/${projectId}`), 900)
            }
          : async () => {
              // Same-surface path · refetch project so status flips to
              // 'active' locally and the Coach's render gate closes.
              const refreshed = await fetchProjectById(projectId)
              if (refreshed) setProject(refreshed)
            }}
      />
    </>
  )
}
