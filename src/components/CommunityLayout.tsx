// Shared layout for the Creator Community 4-menu section (§13-B).
// Owns the title strip + sticky tab navigation between build-logs / stacks /
// asks / office-hours. Each list page slots into the `{children}` area.

import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { countPostsByType } from '../lib/community'
import type { CommunityPostType } from '../lib/supabase'

interface Props {
  children: React.ReactNode
}

interface Tab {
  to:    string
  label: string
  type?: CommunityPostType
  hint:  string
}

const TABS: Tab[] = [
  { to: '/community/build-logs',   label: 'Build Logs',   type: 'build_log',    hint: 'Shipping journeys' },
  { to: '/community/stacks',       label: 'Stacks',       type: 'stack',        hint: 'Reusable recipes · prompts · tool reviews' },
  { to: '/community/asks',         label: 'Asks',         type: 'ask',          hint: 'Looking for · Available · Feedback' },
  { to: '/community/office-hours', label: 'Office Hours', type: 'office_hours', hint: 'Live sessions · AMAs · pair builds' },
]

export function CommunityLayout({ children }: Props) {
  const [counts, setCounts] = useState<Record<CommunityPostType, number> | null>(null)

  useEffect(() => {
    countPostsByType().then(setCounts).catch(() => setCounts(null))
  }, [])

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 min-h-screen">
      <div className="max-w-5xl mx-auto">
        {/* Title strip */}
        <header className="mb-6">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // CREATOR COMMUNITY
          </div>
          <h1 className="font-display font-black text-3xl sm:text-4xl md:text-5xl leading-tight mb-2" style={{ color: 'var(--cream)' }}>
            Build it in public
          </h1>
          <p className="font-light max-w-2xl" style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.65 }}>
            The space between leagues. Share shipping logs, reusable stacks, lightweight asks, and drop
            into Office Hours — this is where builders trade evidence without waiting for a season to open.
          </p>
        </header>

        {/* Sticky tab strip */}
        <div
          className="sticky z-20 mb-8 -mx-4 md:-mx-6 px-4 md:px-6 py-2.5"
          style={{
            top: '64px',
            background: 'rgba(6,12,26,0.85)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div className="max-w-5xl mx-auto flex items-center gap-1 overflow-x-auto">
            {TABS.map(t => (
              <NavLink
                key={t.to}
                to={t.to}
                className="font-mono text-[11px] tracking-widest uppercase px-3 py-1.5 transition-colors whitespace-nowrap flex items-center gap-2"
                style={({ isActive }) => ({
                  background: isActive ? 'rgba(240,192,64,0.14)' : 'transparent',
                  color:      isActive ? 'var(--gold-500)' : 'var(--text-secondary)',
                  border:     `1px solid ${isActive ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: '2px',
                  textDecoration: 'none',
                })}
              >
                {t.label}
                {counts && t.type && counts[t.type] > 0 && (
                  <span
                    className="font-mono text-[9px] tabular-nums px-1 py-0.5"
                    style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }}
                  >
                    {counts[t.type]}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        </div>

        {children}
      </div>
    </section>
  )
}
