// Landing-page ribbon · Top 3 across the live ladder · §11-NEW.1.
// Reads ladder_rankings_mv directly. While the MV is missing or empty
// the component renders nothing (no broken state on landing).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, LADDER_CATEGORY_LABELS, type LadderCategory } from '../lib/supabase'

interface TopRow {
  project_id:    string
  category:      LadderCategory
  rank:          number
  score_total:   number
  project_name:  string
  creator_name:  string | null
}

export function LadderTopStrip() {
  const [rows, setRows] = useState<TopRow[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Cross-category Top 3 by all-time rank · score_total desc.
      // We fetch broader (top 30) then trim, so a single "other" doesn't
      // dominate when other categories also have strong rows.
      const { data } = await supabase
        .from('ladder_rankings_mv')
        .select(`
          project_id, category, rank_all_time, score_total,
          projects!inner(project_name, creator_name)
        `)
        .order('score_total', { ascending: false })
        .limit(3)
      if (!alive) return
      setLoaded(true)
      if (!data) return
      type Raw = {
        project_id: string; category: LadderCategory
        rank_all_time: number; score_total: number
        projects: { project_name: string; creator_name: string | null } | null
      }
      const top3: TopRow[] = (data as unknown as Raw[]).map((r, i) => ({
        project_id:   r.project_id,
        category:     r.category,
        rank:         i + 1,                                // overall display rank
        score_total:  r.score_total,
        project_name: r.projects?.project_name ?? '—',
        creator_name: r.projects?.creator_name ?? null,
      }))
      setRows(top3)
    })()
    return () => { alive = false }
  }, [])

  if (!loaded || rows.length === 0) return null

  return (
    <section className="relative z-10 px-6 md:px-10 lg:px-24 xl:px-32 2xl:px-40 pt-2 pb-2">
      <div className="max-w-5xl mx-auto">
        <div className="card-navy" style={{ borderRadius: '2px' }}>
          <div className="px-4 md:px-5 py-3 flex items-center justify-between gap-3" style={{
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}>
            <div className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--gold-500)' }}>
              // ON THE LADDER · LIVE
            </div>
            <Link to="/ladder" className="font-mono text-[11px] tracking-wide" style={{
              color: 'var(--text-secondary)', textDecoration: 'none',
            }}>
              See full ladder →
            </Link>
          </div>
          <ol>
            {rows.map(r => (
              <li key={r.project_id}>
                <Link
                  to={`/projects/${r.project_id}`}
                  className="flex items-center gap-3 md:gap-4 px-4 md:px-5 py-3"
                  style={{ textDecoration: 'none' }}
                >
                  <span className="font-mono font-medium tabular-nums text-base flex-shrink-0 text-center" style={{
                    color: r.rank === 1 ? 'var(--gold-500)' : 'var(--text-secondary)', width: 24,
                  }}>
                    {r.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold text-base truncate" style={{ color: 'var(--cream)' }}>
                      {r.project_name}
                    </div>
                    <div className="font-mono text-[11px] mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                      {r.creator_name && <><span>by {r.creator_name}</span><span>·</span></>}
                      <span>{LADDER_CATEGORY_LABELS[r.category]}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 flex items-baseline gap-1">
                    <span className="font-display font-bold text-xl tabular-nums" style={{ color: 'var(--gold-500)' }}>
                      {r.score_total}
                    </span>
                    <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>/100</span>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
