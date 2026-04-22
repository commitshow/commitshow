import { useEffect, useState } from 'react'
import type { Project } from '../lib/supabase'
import {
  fetchProjectsFiltered,
  fetchCreatorsByIds,
  fetchApplaudCounts,
  GRID_PAGE_SIZE,
  type CreatorIdentity,
} from '../lib/projectQueries'
import type { ProjectFilters } from './ProjectFilterBar'
import { ProjectCardEditorial } from './ProjectCardEditorial'
import { ProjectPreviewModal } from './ProjectPreviewModal'

interface Props {
  filters: ProjectFilters
  onTotal?: (total: number | null) => void
}

export function ProjectsGrid({ filters, onTotal }: Props) {
  const [rows, setRows] = useState<Project[]>([])
  const [creators, setCreators] = useState<Record<string, CreatorIdentity>>({})
  const [applauds, setApplauds] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [previewTarget, setPreviewTarget] = useState<Project | null>(null)

  const hydrateSideData = async (projects: Project[], merge = false) => {
    const creatorIds = projects.map(p => p.creator_id).filter((x): x is string => !!x)
    const projectIds = projects.map(p => p.id)
    const [creatorMap, applaudMap] = await Promise.all([
      fetchCreatorsByIds(creatorIds),
      fetchApplaudCounts(projectIds),
    ])
    setCreators(prev => merge ? { ...prev, ...creatorMap } : creatorMap)
    setApplauds(prev => merge ? { ...prev, ...applaudMap } : applaudMap)
  }

  // Reset pagination when filters change.
  useEffect(() => {
    setLoading(true)
    setPage(0)
    fetchProjectsFiltered(filters, 0).then(async ({ rows, hasMore, total }) => {
      setRows(rows)
      setHasMore(hasMore)
      onTotal?.(total)
      await hydrateSideData(rows)
      setLoading(false)
    })
  }, [filters.search, filters.status, filters.grade, filters.minScore, filters.sort])

  const loadMore = async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const next = page + 1
    const { rows: more, hasMore: nextHasMore } = await fetchProjectsFiltered(filters, next)
    setRows(prev => [...prev, ...more])
    setPage(next)
    setHasMore(nextHasMore)
    await hydrateSideData(more, true)
    setLoadingMore(false)
  }

  if (loading) return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 md:gap-6">
      {Array.from({ length: Math.min(GRID_PAGE_SIZE, 6) }).map((_, i) => (
        <div key={i} style={{
          background: 'rgba(15,32,64,0.35)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '2px',
        }}>
          <div style={{ aspectRatio: '3 / 2', background: 'rgba(255,255,255,0.02)' }} />
          <div className="px-6 pt-5 pb-6">
            <div className="h-2.5 w-1/3 mb-4" style={{ background: 'rgba(240,192,64,0.15)', borderRadius: '2px' }} />
            <div className="h-5 w-5/6 mb-2" style={{ background: 'rgba(255,255,255,0.07)', borderRadius: '2px' }} />
            <div className="h-5 w-3/5 mb-4" style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }} />
            <div className="h-3 w-full mb-1" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }} />
            <div className="h-3 w-4/5" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }} />
          </div>
        </div>
      ))}
    </div>
  )

  if (rows.length === 0) return (
    <div className="card-navy p-12 text-center" style={{ borderRadius: '2px' }}>
      <div className="font-display text-xl font-bold mb-2" style={{ color: 'var(--text-muted)' }}>
        Nothing here yet.
      </div>
      <p className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>
        Try broadening the filters — remove the grade, lower the score band,
        or switch to <strong style={{ color: 'var(--text-secondary)' }}>All</strong>.
      </p>
    </div>
  )

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 md:gap-6">
        {rows.map(p => (
          <ProjectCardEditorial
            key={p.id}
            project={p}
            creator={p.creator_id ? creators[p.creator_id] : undefined}
            applaudCount={applauds[p.id] ?? 0}
            onOpen={setPreviewTarget}
          />
        ))}
      </div>

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-6 py-2 font-mono text-xs tracking-wide"
            style={{
              background: loadingMore ? 'rgba(240,192,64,0.08)' : 'rgba(240,192,64,0.12)',
              color: 'var(--gold-500)',
              border: '1px solid rgba(240,192,64,0.3)',
              borderRadius: '2px',
              cursor: loadingMore ? 'wait' : 'pointer',
            }}
          >
            {loadingMore ? 'LOADING…' : 'LOAD MORE'}
          </button>
        </div>
      )}

      {previewTarget && (
        <ProjectPreviewModal
          project={previewTarget}
          onClose={() => setPreviewTarget(null)}
          creator={previewTarget.creator_id ? creators[previewTarget.creator_id] : undefined}
          applaudCount={applauds[previewTarget.id] ?? 0}
        />
      )}
    </>
  )
}
