// RecentActivityCard · timeline of recent applauds + comments + votes
// for a project. Renders above the deep audit details so the social
// pulse of the page reads BEFORE the technical breakdown.
//
// Hides itself when there's zero activity (fresh audits with no
// community interaction yet).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface ActivityRow {
  kind:            'applaud' | 'comment' | 'forecast'
  actor_id:        string | null
  actor_name:      string | null
  actor_avatar:    string | null
  preview:         string | null
  vote_count:      number | null
  predicted_score: number | null
  created_at:      string
}

interface Props {
  projectId: string
  limit?:    number
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const s = Math.max(1, Math.floor(diffMs / 1000))
  if (s < 60)             return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)             return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)             return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7)              return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function RecentActivityCard({ projectId, limit = 8 }: Props) {
  const [rows, setRows]     = useState<ActivityRow[] | null>(null)

  useEffect(() => {
    let alive = true
    void supabase
      .rpc('project_recent_activity', { p_project_id: projectId, p_limit: limit })
      .then(({ data, error }) => {
        if (!alive || error) return
        setRows((data ?? []) as ActivityRow[])
      })
    return () => { alive = false }
  }, [projectId, limit])

  if (rows === null) return null
  if (rows.length === 0) return null

  return (
    <div className="mb-6" id="recent-activity">
      <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
        // RECENT ACTIVITY
      </div>
      <div className="card-navy" style={{ borderRadius: '2px' }}>
        {rows.map((r, i) => (
          <ActivityRowView key={`${r.kind}-${r.created_at}-${i}`} row={r} last={i === rows.length - 1} />
        ))}
      </div>
    </div>
  )
}

function ActivityRowView({ row, last }: { row: ActivityRow; last: boolean }) {
  const initial = (row.actor_name ?? '?').slice(0, 1).toUpperCase()
  const tone =
    row.kind === 'applaud'   ? 'var(--gold-500)' :
    row.kind === 'comment'   ? '#A78BFA'         :
    row.kind === 'forecast'  ? '#60A5FA'         :
                               'var(--text-muted)'

  const label =
    row.kind === 'applaud'  ? 'applauded'
  : row.kind === 'comment'  ? 'commented'
  : row.kind === 'forecast' ? (
      row.predicted_score != null
        ? `forecasted ${row.predicted_score}/100${row.vote_count && row.vote_count > 1 ? ` (×${row.vote_count})` : ''}`
        : 'forecasted'
    )
  : 'interacted'

  const actorBlock = (
    <span className="flex items-center justify-center font-mono text-[10px] font-bold overflow-hidden flex-shrink-0" style={{
      width: 28, height: 28,
      background: row.actor_avatar ? 'var(--navy-800)' : tone,
      color:      row.actor_avatar ? 'var(--cream)'   : 'var(--navy-900)',
      borderRadius: '2px',
    }}>
      {row.actor_avatar
        ? <img src={row.actor_avatar} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
        : initial}
    </span>
  )

  return (
    <div
      className="flex items-start gap-3 px-3 py-2.5"
      style={{
        borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.04)',
      }}
    >
      {row.actor_id ? (
        <Link to={`/creators/${row.actor_id}`} style={{ textDecoration: 'none' }}>
          {actorBlock}
        </Link>
      ) : (
        actorBlock
      )}

      <div className="flex-1 min-w-0">
        <div className="font-light text-xs" style={{ color: 'var(--cream)', lineHeight: 1.5 }}>
          <span style={{ color: 'var(--cream)', fontWeight: 600 }}>{row.actor_name ?? 'Someone'}</span>
          {' '}
          <span style={{ color: tone }}>{label}</span>
          {row.preview && (
            <span style={{ color: 'var(--text-secondary)' }}>
              {' · '}"{row.preview.length > 80 ? row.preview.slice(0, 80) + '…' : row.preview}"
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {timeAgo(row.created_at)}
        </div>
      </div>
    </div>
  )
}
