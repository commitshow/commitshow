// PulseListModal · right-side drawer showing who applauded OR who
// forecasted a project. Triggered from CommunityPulseStrip tiles.
//
// Two modes share one shell (header copy + per-row meta differ):
//   · 'applauds'  → applauder list (avatar + name + time)
//   · 'forecasts' → forecaster list (avatar + name + count×score + time)

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface BaseRow {
  member_id:   string | null
  display_name: string | null
  avatar_url:   string | null
  created_at:   string
}

interface ApplaudRow extends BaseRow {}

interface ForecastRow extends BaseRow {
  vote_count:      number | null
  predicted_score: number | null
}

interface Props {
  projectId: string
  mode:      'applauds' | 'forecasts'
  onClose:   () => void
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const s = Math.max(1, Math.floor(diffMs / 1000))
  if (s < 60)  return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7)   return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function PulseListModal({ projectId, mode, onClose }: Props) {
  const [rows, setRows]   = useState<Array<ApplaudRow | ForecastRow> | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      if (mode === 'applauds') {
        const { data } = await supabase
          .from('applauds')
          .select('member_id, created_at, member:members!applauds_member_id_fkey(display_name, avatar_url)')
          .eq('target_type', 'product')
          .eq('target_id', projectId)
          .order('created_at', { ascending: false })
          .limit(100)
        if (!alive) return
        setRows(((data ?? []) as unknown as Array<{ member_id: string; created_at: string; member: { display_name: string | null; avatar_url: string | null } | null }>)
          .map(r => ({
            member_id:    r.member_id,
            display_name: r.member?.display_name ?? null,
            avatar_url:   r.member?.avatar_url ?? null,
            created_at:   r.created_at,
          } as ApplaudRow)))
      } else {
        const { data } = await supabase
          .from('votes')
          .select('member_id, vote_count, predicted_score, created_at, member:members!votes_member_id_fkey(display_name, avatar_url)')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(100)
        if (!alive) return
        setRows(((data ?? []) as unknown as Array<{ member_id: string; vote_count: number | null; predicted_score: number | null; created_at: string; member: { display_name: string | null; avatar_url: string | null } | null }>)
          .map(r => ({
            member_id:       r.member_id,
            display_name:    r.member?.display_name ?? null,
            avatar_url:      r.member?.avatar_url ?? null,
            vote_count:      r.vote_count,
            predicted_score: r.predicted_score,
            created_at:      r.created_at,
          } as ForecastRow)))
      }
    })()
    return () => { alive = false }
  }, [projectId, mode])

  const title = mode === 'applauds' ? '👏 Applauders' : '🎯 Forecasters'
  const accent = mode === 'applauds' ? 'var(--gold-500)' : '#60A5FA'
  const emptyLine = mode === 'applauds'
    ? 'No applauds yet · be the first to clap.'
    : 'No forecasts yet · be the first to call the trajectory.'

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(6,12,26,0.7)', backdropFilter: 'blur(6px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-md flex flex-col"
        style={{
          background: 'var(--navy-950)',
          borderLeft: `1px solid ${accent}40`,
          animation: 'pulseListSlideIn 220ms ease-out',
        }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <div className="font-mono text-[10px] tracking-widest" style={{ color: accent }}>
              // {mode === 'applauds' ? 'APPLAUDERS' : 'FORECASTERS'}
            </div>
            <div className="font-display font-bold text-lg" style={{ color: 'var(--cream)' }}>
              {title}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs px-2 py-1"
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '2px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
            aria-label="Close"
          >
            ESC ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {rows === null ? (
            <div className="px-5 py-8 text-center font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-12 text-center font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
              {emptyLine}
            </div>
          ) : (
            <ul>
              {rows.map((r, i) => {
                const initial = (r.display_name ?? '?').slice(0, 1).toUpperCase()
                return (
                  <li
                    key={`${r.member_id ?? 'anon'}-${i}`}
                    className="flex items-center gap-3 px-5 py-3"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    {r.member_id ? (
                      <Link to={`/creators/${r.member_id}`} onClick={onClose} style={{ textDecoration: 'none' }}>
                        <AvatarChip name={initial} url={r.avatar_url} accent={accent} />
                      </Link>
                    ) : (
                      <AvatarChip name={initial} url={r.avatar_url} accent={accent} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-sm truncate" style={{ color: 'var(--cream)' }}>
                        {r.display_name ?? 'Someone'}
                      </div>
                      {mode === 'forecasts' && 'predicted_score' in r && r.predicted_score != null && (
                        <div className="font-mono text-[11px]" style={{ color: accent }}>
                          forecasted {r.predicted_score}/100
                          {r.vote_count && r.vote_count > 1 && <> · ×{r.vote_count}</>}
                        </div>
                      )}
                    </div>
                    <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {timeAgo(r.created_at)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <style>{`
          @keyframes pulseListSlideIn {
            from { transform: translateX(100%); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
          }
        `}</style>
      </div>
    </div>,
    document.body,
  )
}

function AvatarChip({ name, url, accent }: { name: string; url: string | null; accent: string }) {
  return (
    <span
      className="flex items-center justify-center font-mono text-xs font-bold overflow-hidden flex-shrink-0"
      style={{
        width: 36, height: 36,
        background:   url ? 'var(--navy-800)' : accent,
        color:        url ? 'var(--cream)'   : 'var(--navy-900)',
        borderRadius: '2px',
      }}
    >
      {url
        ? <img src={url} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
        : name}
    </span>
  )
}
