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
  to:        string
  label:     string
  type?:     CommunityPostType
  hint:      string
  /** V1 launch · only Open Mic is interactive. The other four are pinned
   *  in the tab strip so users see the roadmap, but the labels render
   *  greyed-out and the link is a no-op. Removed in V1.5 when the rest
   *  light up. */
  disabled?: boolean
}

const TABS: Tab[] = [
  { to: '/community/open-mic',     label: 'Open Mic',     type: 'open_mic',     hint: 'Drop a one-liner · what you shipped, what tripped you up' },
  { to: '/community/build-logs',   label: 'Build Logs',   type: 'build_log',    hint: 'Shipping journeys',                                       disabled: true },
  { to: '/community/stacks',       label: 'Stacks',       type: 'stack',        hint: 'Reusable recipes · prompts · tool reviews',                disabled: true },
  { to: '/community/asks',         label: 'Asks',         type: 'ask',          hint: 'Looking for · Available · Feedback',                       disabled: true },
  { to: '/community/office-hours', label: 'Office Hours', type: 'office_hours', hint: 'Live sessions · AMAs · pair builds',                       disabled: true },
]

export function CommunityLayout({ children }: Props) {
  const [counts, setCounts] = useState<Record<CommunityPostType, number> | null>(null)

  useEffect(() => {
    countPostsByType().then(setCounts).catch(() => setCounts(null))
  }, [])

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Title strip */}
        <header className="mb-6">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // CREATOR COMMUNITY
          </div>
          <h1 className="font-display font-black text-3xl sm:text-4xl md:text-5xl leading-tight mb-2" style={{ color: 'var(--cream)' }}>
            Build it in public
          </h1>
          <p className="font-light max-w-md" style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.65 }}>
            Between leagues. Builders trade evidence year-round.
          </p>
        </header>

        {/* Sticky tab strip */}
        <div
          className="sticky z-20 mb-8 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 py-2.5"
          style={{
            top: '64px',
            background: 'rgba(6,12,26,0.85)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div className="max-w-7xl mx-auto flex items-center gap-1 overflow-x-auto">
            {TABS.map(t => {
              if (t.disabled) {
                // V1 launch · render as a non-interactive chip with a
                // 'soon' caption so the future roadmap is visible but
                // un-clickable.
                return (
                  <span
                    key={t.to}
                    className="font-mono text-[11px] tracking-widest uppercase px-3 py-1.5 whitespace-nowrap flex items-center gap-2"
                    style={{
                      background: 'transparent',
                      color: 'var(--text-faint)',
                      border: '1px solid rgba(255,255,255,0.04)',
                      borderRadius: '2px',
                      cursor: 'not-allowed',
                      opacity: 0.6,
                    }}
                    title={`${t.hint} · coming soon`}
                  >
                    {t.label}
                    <span
                      className="font-mono text-[9px] tabular-nums px-1 py-0.5"
                      style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.03)', borderRadius: '2px' }}
                    >
                      soon
                    </span>
                  </span>
                )
              }
              return (
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
              )
            })}
          </div>
        </div>

        {children}
      </div>
    </section>
  )
}
