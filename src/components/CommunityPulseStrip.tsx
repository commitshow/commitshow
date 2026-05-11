// CommunityPulseStrip · 4-tile mini stats above the audit body.
//
// Surfaces social-signal weight on a project page that was previously
// 45%+ audit-detail-dominated. Click any tile to scroll to its
// dedicated section (Forecast/Applaud footer · comments thread ·
// scout list · view-source-rubric).
//
// Single round-trip via project_pulse_stats RPC.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface PulseStats {
  applauds:     number
  comments:     number
  forecasts:    number
  forecast_avg: number | null
  views:        number
}

interface Props {
  projectId: string
  /** Optional CSS scroll target ids. Defaults match ProjectDetailPage. */
  commentsAnchor?:  string  // 'comments' by default
  forecastAnchor?:  string  // 'forecasts' by default
}

export function CommunityPulseStrip({
  projectId,
  commentsAnchor = 'comments',
  forecastAnchor = 'forecast',
}: Props) {
  const [stats, setStats] = useState<PulseStats | null>(null)

  useEffect(() => {
    let alive = true
    void supabase.rpc('project_pulse_stats', { p_project_id: projectId }).then(({ data, error }) => {
      if (!alive || error) return
      setStats(data as PulseStats)
    })
    return () => { alive = false }
  }, [projectId])

  const tiles: Array<{
    label:  string
    value:  string | number
    sub?:   string
    anchor?: string
    accent: string
  }> = stats === null
    ? [
        { label: 'APPLAUDS',  value: '—', accent: 'var(--gold-500)' },
        { label: 'COMMENTS',  value: '—', accent: '#A78BFA' },
        { label: 'FORECASTS', value: '—', accent: '#60A5FA' },
        { label: 'VIEWS',     value: '—', accent: 'var(--text-muted)' },
      ]
    : [
        { label: 'APPLAUDS',  value: stats.applauds,  anchor: forecastAnchor, accent: 'var(--gold-500)' },
        { label: 'COMMENTS',  value: stats.comments,  anchor: commentsAnchor, accent: '#A78BFA' },
        {
          label: 'FORECASTS',
          value: stats.forecasts,
          sub: stats.forecast_avg != null ? `avg ${stats.forecast_avg}/100` : undefined,
          anchor: forecastAnchor,
          accent: '#60A5FA',
        },
        { label: 'VIEWS',     value: stats.views,     accent: 'var(--text-muted)' },
      ]

  const scrollTo = (anchor?: string) => {
    if (!anchor) return
    const el = document.getElementById(anchor)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
      {tiles.map(t => (
        <button
          key={t.label}
          type="button"
          onClick={() => scrollTo(t.anchor)}
          disabled={!t.anchor}
          className="p-3 text-left transition-all"
          style={{
            background:     'rgba(255,255,255,0.02)',
            border:         `1px solid ${t.accent}20`,
            borderRadius:   '2px',
            cursor:         t.anchor ? 'pointer' : 'default',
          }}
          onMouseEnter={e => { if (t.anchor) e.currentTarget.style.borderColor = `${t.accent}66` }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = `${t.accent}20` }}
        >
          <div className="font-mono text-[10px] tracking-widest mb-1.5" style={{ color: t.accent, opacity: 0.85 }}>
            {t.label}
          </div>
          <div className="font-display font-bold tabular-nums" style={{
            color:    t.value === '—' ? 'var(--text-muted)' : 'var(--cream)',
            fontSize: '1.5rem',
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
  )
}
