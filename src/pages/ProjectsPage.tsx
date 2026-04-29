import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { SeasonProgressBar } from '../components/SeasonProgress'
import { FeaturedLanes } from '../components/FeaturedLanes'
import { ProjectFilterBar, type ProjectFilters } from '../components/ProjectFilterBar'
import { ProjectsGrid } from '../components/ProjectsGrid'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// pump.fun-style dense browse. Drops page header, stat tiles, section
// headers, sticky Live Activity panel. Single compact top strip + direct
// grid. Spotlight lanes live inline above the grid for discoverability
// without a big section break.

export function ProjectsPage() {
  const { user } = useAuth()
  const [filters, setFilters] = useState<ProjectFilters>({ search: '', sort: 'newest' })
  const [totalFiltered, setTotalFiltered] = useState<number | null>(null)
  const [summary, setSummary] = useState<{ total: number; active: number; graduated: number } | null>(null)

  useEffect(() => {
    supabase
      .from('projects')
      .select('status', { count: 'exact', head: false })
      .then(({ data, count }) => {
        if (!data) return
        const active    = data.filter(p => p.status === 'active').length
        const graduated = data.filter(p => p.status === 'graduated' || p.status === 'valedictorian').length
        setSummary({ total: count ?? data.length, active, graduated })
      })
  }, [])

  return (
    <section className="relative z-10 pt-16 pb-12 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* ── Compact top strip · Season · stats · Apply ──
            Mobile stacks: SeasonProgress on its own row, then stats + MAP VIEW
            share one row (stats left, MAP VIEW right). Desktop keeps the
            single-row layout via md:flex-row + md:justify-between. */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-3 py-3 mb-4" style={{
          borderBottom: '1px solid rgba(240,192,64,0.12)',
        }}>
          <SeasonProgressBar variant="compact" />

          <div className="flex items-center justify-between gap-3 w-full md:w-auto md:flex-1 md:justify-end">
            {summary && (
              <div className="flex items-center gap-3 font-mono text-xs min-w-0">
                <span style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--cream)' }}>{summary.total}</span> audited
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: '#F0C040' }}>{summary.active}</span> live
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: '#00D4AA' }}>{summary.graduated}</span> grad
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 flex-shrink-0">
              <NavLink
                to="/ladder"
                className="font-mono text-[11px] tracking-wide px-3 py-1.5 whitespace-nowrap"
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '2px',
                  textDecoration: 'none',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'rgba(240,192,64,0.5)'
                  e.currentTarget.style.color = 'var(--gold-500)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
                  e.currentTarget.style.color = 'var(--text-secondary)'
                }}
              >
                LADDER →
              </NavLink>
              <NavLink
                to="/leaderboard"
                className="font-mono text-[10px] tracking-wide px-2 py-1.5 whitespace-nowrap hidden md:inline-block"
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '2px',
                  textDecoration: 'none',
                }}
                title="2D scatter map · Audit × Scout"
              >
                MAP
              </NavLink>
              {!user && (
                <NavLink
                  to="/submit"
                  className="font-mono text-[11px] font-medium tracking-wide px-3 py-1.5 whitespace-nowrap"
                  style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', textDecoration: 'none' }}
                >
                  AUDIT →
                </NavLink>
              )}
            </div>
          </div>
        </div>

        {/* ── Spotlight · horizontal scroll row · no big section header ── */}
        <div className="mb-4">
          <FeaturedLanes />
        </div>

        {/* ── Filter bar ── */}
        <ProjectFilterBar value={filters} onChange={setFilters} totalCount={totalFiltered} />

        {/* ── Dense grid ── */}
        <div className="mt-3">
          <ProjectsGrid filters={filters} onTotal={setTotalFiltered} />
        </div>
      </div>
    </section>
  )
}
