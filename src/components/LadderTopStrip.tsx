// Landing-page ribbon · Top 3 across the live ladder · §11-NEW.1.
// Reads ladder_rankings_mv directly. While the MV is missing or empty
// the component renders nothing (no broken state on landing).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, LADDER_CATEGORY_LABELS, type LadderCategory } from '../lib/supabase'
import { useViewer } from '../lib/useViewer'
import { scoreBand, bandLabel, bandTone, viewerCanSeeDigitOnList } from '../lib/laneScore'

interface TopRow {
  project_id:    string
  category:      LadderCategory
  rank:          number
  score_total:   number
  project_name:  string
  creator_name:  string | null
  creator_id:    string | null
  status:        string | null
}

export function LadderTopStrip() {
  const [rows, setRows] = useState<TopRow[]>([])
  const [loaded, setLoaded] = useState(false)
  // §1-A ⑥ band gate · landing-page ribbon respects the gate. Encore-tier
  // rows reveal the digit to everyone (trophy mechanic) but a Top 3 set
  // can include Strong/Building tier rows when no one's at Encore yet.
  const viewer = useViewer()

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Cross-category Top 3 by all-time rank · score_total desc.
      // Two-query path: PostgREST can't infer a FK from a materialized
      // view to projects (MVs don't carry FK constraints), so the
      // previous projects!inner(...) embed returned 400. Fetch the MV
      // rows first, then the matching projects rows by id.
      const { data: mvRows } = await supabase
        .from('ladder_rankings_mv')
        .select('project_id, category, rank_all_time, score_total')
        .order('score_total', { ascending: false })
        .limit(3)
      if (!alive) return
      setLoaded(true)
      if (!mvRows || mvRows.length === 0) return
      const ids = (mvRows as Array<{ project_id: string }>).map(r => r.project_id)
      const { data: projRows } = await supabase
        .from('projects')
        .select('id, project_name, creator_name, creator_id, status')
        .in('id', ids)
      if (!alive) return
      const projMap = new Map<string, { project_name: string; creator_name: string | null; creator_id: string | null; status: string | null }>()
      ;(projRows ?? []).forEach((p: { id: string; project_name: string; creator_name: string | null; creator_id: string | null; status: string | null }) =>
        projMap.set(p.id, { project_name: p.project_name, creator_name: p.creator_name, creator_id: p.creator_id, status: p.status }))
      type MvRow = { project_id: string; category: LadderCategory; rank_all_time: number; score_total: number }
      const top3: TopRow[] = (mvRows as unknown as MvRow[]).map((r, i) => ({
        project_id:   r.project_id,
        category:     r.category,
        rank:         i + 1,
        score_total:  r.score_total,
        project_name: projMap.get(r.project_id)?.project_name ?? '—',
        creator_name: projMap.get(r.project_id)?.creator_name ?? null,
        creator_id:   projMap.get(r.project_id)?.creator_id ?? null,
        status:       projMap.get(r.project_id)?.status ?? null,
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
            <Link to="/products" className="font-mono text-[11px] tracking-wide" style={{
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
                  {(() => {
                    const canSeeDigit = viewerCanSeeDigitOnList(r, viewer)
                    const band        = scoreBand(r.score_total)
                    return canSeeDigit ? (
                      <div className="flex-shrink-0 flex items-baseline gap-1">
                        <span className="font-display font-bold text-xl tabular-nums" style={{ color: 'var(--gold-500)' }}>
                          {r.score_total}
                        </span>
                        <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>/100</span>
                      </div>
                    ) : (
                      <div
                        className="flex-shrink-0 font-display font-bold text-base tracking-widest uppercase"
                        style={{ color: bandTone(band) }}
                        title="Public viewers see band · creator + admin + paid Patron see the digit · Encore reveals to all"
                      >
                        {bandLabel(band)}
                      </div>
                    )
                  })()}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
