// CommunityPulseStrip · 4-tile mini stats above the audit body.
//
// Surfaces social-signal weight on a project page that was previously
// 45%+ audit-detail-dominated. Each tile click opens a modal/drawer
// for its surface (scroll-to-section was the v1 behavior · replaced
// 2026-05-11 with direct list modals so owners can see WHO reacted,
// not just be CTA'd to react themselves).
//
// Live updates:
//   · Realtime subscribe to applauds / comments / votes for this
//     project_id · any insert refetches stats
//   · Listens for window 'commitshow:pulse-refresh' for own-action
//     immediate feedback (dispatched by Forecast/Applaud/Comment
//     handlers before the realtime echo arrives)
//   · On mount, calls track_project_view RPC to record this visit
//     (SPA navigation doesn't trigger CF middleware), then refetches
//     stats so the views tile reflects the new count. Daily-deduped
//     server-side.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PulseListModal } from './PulseListModal'

interface PulseStats {
  applauds:        number
  comments:        number
  forecasts:       number
  forecast_avg:    number | null
  views:           number
  viewer_involved: boolean
}

interface Props {
  projectId: string
  /** Owner sees the COMMENTS notification dot when new comments
   *  arrive; visitors don't (noise · they have no skin in the
   *  thread). Default false so the cleaner state is the
   *  conservative one if a caller forgets to pass. */
  isOwner?: boolean
}

// localStorage key for the "last seen comment count" per project ·
// drives the COMMENTS tile notification dot. Reset when the user
// opens the drawer (or any other surface that signals "I've read up
// to here"). One key per project so dots stay local to each page.
const SEEN_KEY = (projectId: string) => `commitshow:comments-seen:${projectId}`

function readSeen(projectId: string): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(SEEN_KEY(projectId))
    return raw ? Math.max(0, parseInt(raw, 10) || 0) : 0
  } catch { return 0 }
}

function writeSeen(projectId: string, count: number): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(SEEN_KEY(projectId), String(count)) } catch {}
}

export function CommunityPulseStrip({ projectId, isOwner = false }: Props) {
  const [stats, setStats] = useState<PulseStats | null>(null)
  const [modal, setModal] = useState<'applauds' | 'forecasts' | null>(null)
  const [seenComments, setSeenComments] = useState<number>(() => readSeen(projectId))

  const fetchStats = async (): Promise<void> => {
    const { data, error } = await supabase.rpc('project_pulse_stats', { p_project_id: projectId })
    if (error) return
    setStats(data as PulseStats)
  }

  useEffect(() => {
    let alive = true
    // Track this view via RPC (SPA nav doesn't trigger CF middleware,
    // so this is the only way to record /projects/<id> renders that
    // came from React Router transitions). Daily-deduped server-side.
    // Chain a refetch right after so the views tile reflects the
    // freshly-inserted row · single visible update, no flicker.
    void (async () => {
      try { await supabase.rpc('track_project_view', { p_project_id: projectId }) } catch {}
      if (alive) void fetchStats()
    })()

    // Realtime channel · any insert on this project's applauds /
    // comments / votes refetches stats.
    const channel = supabase
      .channel(`pulse-strip:${projectId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'applauds',
        filter: `target_id=eq.${projectId}`,
      }, () => { if (alive) void fetchStats() })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'comments',
        filter: `project_id=eq.${projectId}`,
      }, () => { if (alive) void fetchStats() })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'votes',
        filter: `project_id=eq.${projectId}`,
      }, () => { if (alive) void fetchStats() })
      .subscribe()

    // Own-action immediate feedback path: handlers fire this event
    // right after a successful insert so the user sees their +1
    // before the realtime echo arrives (~100-500ms later).
    const onPulseRefresh = () => { if (alive) void fetchStats() }
    window.addEventListener('commitshow:pulse-refresh', onPulseRefresh)

    return () => {
      alive = false
      void supabase.removeChannel(channel)
      window.removeEventListener('commitshow:pulse-refresh', onPulseRefresh)
    }
  // fetchStats is closure-stable enough · projectId is the real dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const onCommentsClick = () => {
    // ProjectComments listens for window hash '#comments' and opens
    // its right-side drawer · re-set hash so it triggers even when
    // already on the same URL.
    window.location.hash = ''
    window.location.hash = '#comments'
    // Mark current count as seen · dot clears.
    if (stats !== null) {
      writeSeen(projectId, stats.comments)
      setSeenComments(stats.comments)
    }
  }

  const displayedViews = stats === null ? '—' : stats.views

  // Notification dot · COMMENTS tile · owner + thread-involved.
  // The dot fires when:
  //   · viewer is the project owner, OR
  //   · viewer has at least one comment on this project (involved
  //     means "I might have a reply waiting")
  // AND new comments have arrived since the localStorage seen count.
  // Random visitors with no involvement see a clean tile · no noise.
  const eligibleForDot = isOwner || (stats?.viewer_involved ?? false)
  const hasNewComments = eligibleForDot && stats !== null && stats.comments > seenComments

  const tiles: Array<{
    label:  string
    value:  string | number
    sub?:   string
    onClick?: () => void
    accent: string
    dot?:   boolean
  }> = stats === null
    ? [
        { label: 'APPLAUDS',  value: '—', accent: 'var(--gold-500)' },
        { label: 'COMMENTS',  value: '—', accent: '#A78BFA' },
        { label: 'FORECASTS', value: '—', accent: '#60A5FA' },
        { label: 'VIEWS',     value: '—', accent: 'var(--text-muted)' },
      ]
    : [
        {
          label:   'APPLAUDS',
          value:   stats.applauds,
          onClick: stats.applauds > 0 ? () => setModal('applauds') : undefined,
          accent:  'var(--gold-500)',
        },
        {
          label:   'COMMENTS',
          value:   stats.comments,
          onClick: onCommentsClick,
          accent:  '#A78BFA',
          dot:     hasNewComments,
        },
        {
          label:   'FORECASTS',
          value:   stats.forecasts,
          sub:     stats.forecast_avg != null ? `avg ${stats.forecast_avg}/100` : undefined,
          onClick: stats.forecasts > 0 ? () => setModal('forecasts') : undefined,
          accent:  '#60A5FA',
        },
        {
          label:  'VIEWS',
          value:  displayedViews,
          accent: 'var(--text-muted)',
        },
      ]

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {tiles.map(t => (
          <button
            key={t.label}
            type="button"
            onClick={t.onClick}
            disabled={!t.onClick}
            className="relative p-3 text-left transition-all"
            style={{
              background:   'rgba(255,255,255,0.02)',
              border:       `1px solid ${t.accent}20`,
              borderRadius: '2px',
              cursor:       t.onClick ? 'pointer' : 'default',
            }}
            onMouseEnter={e => { if (t.onClick) e.currentTarget.style.borderColor = `${t.accent}66` }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = `${t.accent}20` }}
          >
            {t.dot && (
              <span
                aria-label="new"
                title="New since you last looked"
                className="absolute"
                style={{
                  top:    6,
                  right:  6,
                  width:  8,
                  height: 8,
                  background:   '#C8102E',
                  borderRadius: '50%',
                  boxShadow:    '0 0 0 2px rgba(6,12,26,1)',
                }}
              />
            )}
            <div className="font-mono text-[10px] tracking-widest mb-1.5" style={{ color: t.accent, opacity: 0.85 }}>
              {t.label}
            </div>
            <div className="font-display font-bold tabular-nums" style={{
              color:      t.value === '—' ? 'var(--text-muted)' : 'var(--cream)',
              fontSize:   '1.5rem',
              lineHeight: 1,
            }}>
              {t.value}
            </div>
            {t.sub && (
              <div className="font-mono text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {t.sub}
              </div>
            )}
          </button>
        ))}
      </div>

      {modal && (
        <PulseListModal
          projectId={projectId}
          mode={modal}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}
