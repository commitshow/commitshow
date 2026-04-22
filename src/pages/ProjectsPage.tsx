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
    <section className="relative z-10 pt-16 pb-12 px-4 md:px-6 min-h-screen">
      <div className="max-w-[1600px] mx-auto">
        {/* ── Compact top strip · Season · stats · Apply ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap py-3 mb-4" style={{
          borderBottom: '1px solid rgba(240,192,64,0.12)',
        }}>
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <SeasonProgressBar variant="compact" />
            {summary && (
              <>
                <span style={{ color: 'rgba(255,255,255,0.12)' }}>·</span>
                <div className="flex items-center gap-3 font-mono text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--cream)' }}>{summary.total}</span> applicants
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ color: '#F0C040' }}>{summary.active}</span> live
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ color: '#00D4AA' }}>{summary.graduated}</span> grad
                  </span>
                </div>
              </>
            )}
          </div>
          {!user && (
            <NavLink
              to="/submit"
              className="font-mono text-[11px] font-medium tracking-wide px-3 py-1.5 flex-shrink-0"
              style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', textDecoration: 'none' }}
            >
              APPLY →
            </NavLink>
          )}
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
