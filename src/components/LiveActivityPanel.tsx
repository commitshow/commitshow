import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { IconForecast, IconApplaud } from './icons'

type ActivityKind = 'forecast' | 'applaud'

interface ActivityItem {
  id: string
  kind: ActivityKind
  created_at: string
  project_id: string
  project_name: string
  scout_tier: string | null
  detail: string | null
}

const MAX_ITEMS = 24

interface LiveActivityPanelProps {
  /**
   * Layout variant.
   *   - 'ticker' (default): horizontal scrolling row · sits inline in page flow
   *   - 'sidebar': vertical stacked list · for narrow right-side columns
   */
  variant?: 'ticker' | 'sidebar'
}

export function LiveActivityPanel({ variant = 'ticker' }: LiveActivityPanelProps) {
  const navigate = useNavigate()
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const [votesRes, applaudsRes] = await Promise.all([
        supabase.from('votes')
          .select('id, created_at, project_id, predicted_score, scout_tier, projects(project_name)')
          .order('created_at', { ascending: false })
          .limit(15),
        supabase.from('applauds')
          .select('id, created_at, project_id, applauded_axis, scout_tier, projects(project_name)')
          .order('created_at', { ascending: false })
          .limit(15),
      ])

      const merged: ActivityItem[] = []
      ;(votesRes.data ?? []).forEach((v: any) => merged.push({
        id: `v:${v.id}`,
        kind: 'forecast',
        created_at: v.created_at,
        project_id: v.project_id,
        project_name: v.projects?.project_name ?? 'Project',
        scout_tier: v.scout_tier,
        detail: v.predicted_score != null ? `Forecast ${v.predicted_score}/100` : 'Forecast cast',
      }))
      ;(applaudsRes.data ?? []).forEach((a: any) => merged.push({
        id: `a:${a.id}`,
        kind: 'applaud',
        created_at: a.created_at,
        project_id: a.project_id,
        project_name: a.projects?.project_name ?? 'Project',
        scout_tier: a.scout_tier,
        detail: a.applauded_axis ? `Applaud on ${a.applauded_axis}` : 'Applaud',
      }))

      merged.sort((a, b) => b.created_at.localeCompare(a.created_at))
      setItems(merged.slice(0, MAX_ITEMS))
      setLoading(false)
    })()
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('live-activity')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'votes' }, async (payload) => {
        const v = payload.new as any
        const { data } = await supabase.from('projects').select('project_name').eq('id', v.project_id).maybeSingle()
        const item: ActivityItem = {
          id: `v:${v.id}`,
          kind: 'forecast',
          created_at: v.created_at,
          project_id: v.project_id,
          project_name: data?.project_name ?? 'Project',
          scout_tier: v.scout_tier,
          detail: v.predicted_score != null ? `Forecast ${v.predicted_score}/100` : 'Forecast cast',
        }
        setItems(prev => [item, ...prev].slice(0, MAX_ITEMS))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'applauds' }, async (payload) => {
        const a = payload.new as any
        const { data } = await supabase.from('projects').select('project_name').eq('id', a.project_id).maybeSingle()
        const item: ActivityItem = {
          id: `a:${a.id}`,
          kind: 'applaud',
          created_at: a.created_at,
          project_id: a.project_id,
          project_name: data?.project_name ?? 'Project',
          scout_tier: a.scout_tier,
          detail: a.applauded_axis ? `Applaud on ${a.applauded_axis}` : 'Applaud',
        }
        setItems(prev => [item, ...prev].slice(0, MAX_ITEMS))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  if (variant === 'sidebar') {
    return <SidebarList items={items} loading={loading} onClick={id => navigate(`/projects/${id}`)} />
  }
  return <Ticker items={items} loading={loading} onClick={id => navigate(`/projects/${id}`)} />
}

// ── Ticker (horizontal · inline) ────────────────────────────
function Ticker({ items, loading, onClick }: { items: ActivityItem[]; loading: boolean; onClick: (id: string) => void }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
        <span className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
          LIVE ACTIVITY
        </span>
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Forecasts and applauds across the league · updates in real time
        </span>
      </div>

      {loading ? (
        <div className="font-mono text-xs py-6 text-center" style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', borderRadius: '2px' }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="font-mono text-xs py-6 text-center" style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', borderRadius: '2px' }}>
          Nothing yet. Be the first Scout.
        </div>
      ) : (
        <div
          className="flex gap-2 overflow-x-auto pb-1"
          style={{ scrollbarWidth: 'thin' }}
        >
          {items.slice(0, 14).map(item => (
            <TickerPill key={item.id} item={item} onClick={() => onClick(item.project_id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function TickerPill({ item, onClick }: { item: ActivityItem; onClick: () => void }) {
  const accent = item.kind === 'forecast' ? 'var(--gold-500)' : '#A78BFA'
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-shrink-0 flex items-center gap-2 px-3 py-2 font-mono text-[11px] transition-colors"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeft: `2px solid ${accent}`,
        borderRadius: '2px',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        minWidth: '240px',
        maxWidth: '280px',
        textAlign: 'left',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
    >
      <span style={{ color: accent, flexShrink: 0, display: 'inline-flex' }}>
        {item.kind === 'forecast' ? <IconForecast size={11} /> : <IconApplaud size={11} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium" style={{ color: 'var(--cream)' }}>
            {item.project_name}
          </span>
          <span className="flex-shrink-0" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
            {formatRelative(item.created_at)}
          </span>
        </div>
        <div className="truncate" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
          {item.scout_tier ?? 'Bronze'} · {item.detail}
        </div>
      </div>
    </button>
  )
}

// ── Sidebar (vertical · for narrow columns) ─────────────────
function SidebarList({ items, loading, onClick }: { items: ActivityItem[]; loading: boolean; onClick: (id: string) => void }) {
  return (
    <div className="card-navy p-4" style={{ borderRadius: '2px' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
        <span className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
          LIVE ACTIVITY
        </span>
      </div>

      {loading ? (
        <div className="font-mono text-xs py-6 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div className="font-mono text-xs py-6 text-center" style={{ color: 'var(--text-muted)' }}>
          Nothing yet. Be the first Scout.
        </div>
      ) : (
        <ul className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
          {items.map(item => (
            <li
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => onClick(item.project_id)}
              onKeyDown={e => { if (e.key === 'Enter') onClick(item.project_id) }}
              className="group font-mono text-xs px-2 py-1.5 cursor-pointer transition-colors"
              style={{
                background: 'rgba(255,255,255,0.01)',
                border: '1px solid rgba(255,255,255,0.03)',
                borderLeft: `2px solid ${item.kind === 'forecast' ? 'var(--gold-500)' : '#A78BFA'}`,
                borderRadius: '2px',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.01)')}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate" style={{ color: 'var(--cream)', maxWidth: '190px' }}>
                  {item.project_name}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{formatRelative(item.created_at)}</span>
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {item.scout_tier ?? 'Bronze'} · {item.detail}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatRelative(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60)     return `${Math.floor(s)}s`
  if (s < 3600)   return `${Math.floor(s / 60)}m`
  if (s < 86400)  return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
