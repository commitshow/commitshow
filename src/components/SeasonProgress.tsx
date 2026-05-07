import { useEffect, useState } from 'react'
import type { Season } from '../lib/supabase'
import { computeSeasonProgress, loadCurrentSeason, type SeasonProgress as SP } from '../lib/season'

interface SeasonProgressBarProps {
  variant?: 'banner' | 'compact'
}

export function SeasonProgressBar({ variant = 'banner' }: SeasonProgressBarProps) {
  const [season, setSeason] = useState<Season | null>(null)
  const [progress, setProgress] = useState<SP | null>(null)

  useEffect(() => {
    loadCurrentSeason().then(s => {
      setSeason(s)
      if (s) setProgress(computeSeasonProgress(s))
    })
  }, [])

  // Refresh progress each minute so the day/phase rolls over without reload.
  useEffect(() => {
    if (!season) return
    const id = window.setInterval(() => setProgress(computeSeasonProgress(season)), 60_000)
    return () => window.clearInterval(id)
  }, [season])

  if (!season || !progress) return null

  if (variant === 'compact') {
    return (
      <div className="font-mono text-xs flex items-center gap-2" style={{ color: 'rgba(248,245,238,0.5)' }}>
        <span style={{ color: 'var(--gold-500)' }}>{season.name.replace(/_/g, ' ')}</span>
        <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
        <span>Day {Math.max(1, progress.dayNumber)} / {progress.totalDays}</span>
        <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
        <span style={{ color: 'var(--cream)' }}>{progress.phaseLabel}</span>
      </div>
    )
  }

  return (
    <div className="card-navy px-5 py-4" style={{ borderRadius: '2px' }}>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-y-1">
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // {season.name.replace(/_/g, ' ').toUpperCase()} · DAY {Math.max(1, progress.dayNumber)} / {progress.totalDays}
          </div>
          <div className="font-display font-bold text-lg mt-1" style={{ color: 'var(--cream)' }}>
            {progress.phaseLabel}
          </div>
        </div>
        <div className="font-mono text-xs tabular-nums text-right" style={{ color: 'rgba(248,245,238,0.5)' }}>
          {progress.daysRemaining > 0 ? (
            <>
              <div>{progress.daysRemaining} days</div>
              <div style={{ color: 'rgba(248,245,238,0.3)' }}>to season end</div>
            </>
          ) : (
            <div>Season closed</div>
          )}
        </div>
      </div>

      {/* Milestone track */}
      <div className="relative mb-3" style={{ height: '8px' }}>
        {/* base bar */}
        <div className="absolute inset-0" style={{
          background: 'rgba(15,32,64,0.8)',
          border: '1px solid rgba(240,192,64,0.15)',
          borderRadius: '2px',
        }} />
        {/* filled segment · glow removed 2026-05-07 per CEO feedback */}
        <div className="absolute inset-y-0 left-0" style={{
          width: `${progress.progressPct}%`,
          background: 'linear-gradient(90deg, #1E3A8A 0%, #4338CA 20%, #C026D3 45%, #F0C040 75%, #FFD96B 100%)',
          transition: 'width 500ms cubic-bezier(0.22, 1, 0.36, 1)',
          borderRadius: '2px',
        }} />
      </div>

      {/* Milestone markers */}
      <div className="grid grid-cols-5 gap-1 font-mono text-[10px]">
        {progress.milestones.map(m => {
          const pct = ((m.day - 1) / Math.max(1, progress.totalDays - 1)) * 100
          const reached = progress.dayNumber >= m.day
          return (
            <div key={m.day} className="text-center" style={{
              color: reached ? 'var(--gold-500)' : 'rgba(248,245,238,0.3)',
            }}>
              <div>Day {m.day}</div>
              <div style={{ color: reached ? 'var(--cream)' : 'rgba(248,245,238,0.25)' }}>{m.label}</div>
              <div style={{ marginTop: '2px', fontSize: '9px', color: 'rgba(248,245,238,0.2)' }}>
                {pct.toFixed(0)}%
              </div>
            </div>
          )
        })}
      </div>

      <div className="pl-3 py-2 pr-3 mt-3 font-mono text-xs"
        style={{
          borderLeft: '2px solid var(--gold-500)',
          background: 'rgba(240,192,64,0.04)',
          color: 'rgba(248,245,238,0.6)',
          lineHeight: 1.6,
        }}>
        {progress.phaseHint}
      </div>
    </div>
  )
}
