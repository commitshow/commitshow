// WhatWeCatch · landing-page proof section #2.
//
// Pairs with AuditShowcase (real projects) by answering the next question:
// "ok the engine runs — what does it actually catch?"  Reads live prevalence
// from audit_frame_prevalence() RPC (the 14 AI-Coder vibe-concerns frames,
// counted across the latest snapshot of every non-preview project) and
// renders the 6 most-frequently-hit as a card grid.
//
// Constraints (CLAUDE.md §4):
//   · navy + gold tokens · 2px border-radius · no emoji · no trailing period
//     on headings · monospace labels
//   · prefers-reduced-motion safe (no animation here)
//   · hides itself when the RPC returns empty or every frame is calibrating

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface FrameRow {
  frame_key:       string
  label:           string
  hint:            string
  concerned_count: number
  total_count:     number
  prevalence_pct:  number
}

const SHOW_LIMIT             = 6      // top-N by prevalence
const MIN_PREVALENCE_PCT     = 10     // hide frames under this · either rare or sample too small
const MIN_SAMPLE_FOR_RENDER  = 5      // hide the whole section while we're calibrating

export function WhatWeCatch() {
  const [rows, setRows] = useState<FrameRow[] | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('audit_frame_prevalence')
        if (!live) return
        if (error) { console.error('[WhatWeCatch] rpc', error); setRows([]); return }
        setRows((data ?? []) as FrameRow[])
      } catch (err) {
        if (live) { console.error('[WhatWeCatch]', err); setRows([]) }
      }
    })()
    return () => { live = false }
  }, [])

  if (rows === null) return null   // first paint · don't flash
  if (rows.length === 0) return null
  // Total count is the same across all 14 rows (denominator = latest snapshot
  // per non-preview project). Pull it off row 0 to gate render.
  const totalAudited = rows[0]?.total_count ?? 0
  if (totalAudited < MIN_SAMPLE_FOR_RENDER) return null

  const visible = rows.filter(r => r.prevalence_pct >= MIN_PREVALENCE_PCT).slice(0, SHOW_LIMIT)
  if (visible.length === 0) return null

  return (
    <section
      className="relative z-10 py-20 px-6 md:px-10 lg:px-24 xl:px-32 2xl:px-40"
      style={{ borderTop: '1px solid rgba(240,192,64,0.08)' }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
          // WHAT WE CATCH · LIVE PREVALENCE
        </div>
        <h2 className="font-display font-black text-3xl sm:text-4xl md:text-5xl mb-4 leading-tight" style={{ color: 'var(--cream)' }}>
          The frames AI coders miss most
        </h2>
        <p className="font-light max-w-2xl mb-12" style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', lineHeight: 1.55 }}>
          Six concerns the engine surfaces most often, with the share of audited products that hit each one.
          Live across {totalAudited} audited projects · updates as new audits land.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map(r => <FrameCard key={r.frame_key} row={r} />)}
        </div>

        <div className="mt-8">
          <Link
            to="/rulebook#frames"
            className="font-mono text-xs tracking-widest"
            style={{ color: 'var(--gold-500)', textDecoration: 'none' }}
          >
            See all 14 frames →
          </Link>
        </div>
      </div>
    </section>
  )
}

function FrameCard({ row }: { row: FrameRow }) {
  // Severity tone · 50%+ reads as scarlet (room is on fire), 25-49% amber,
  // 10-24% cream (informational). Keeps the grid from being a wall of red.
  const tone = row.prevalence_pct >= 50 ? 'var(--scarlet)'
             : row.prevalence_pct >= 25 ? '#F0C040'
             :                            'var(--cream)'
  return (
    <div className="h-full p-5 flex flex-col" style={{
      background: 'rgba(15,32,64,0.45)',
      border: '1px solid rgba(248,245,238,0.10)',
      borderLeft: `4px solid ${tone}`,
      borderRadius: '2px',
    }}>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="font-display font-bold text-base leading-tight" style={{ color: 'var(--cream)' }}>
          {row.label}
        </div>
        <div className="text-right shrink-0">
          <div className="font-display font-black tabular-nums" style={{ color: tone, fontSize: '1.6rem', lineHeight: 1 }}>
            {row.prevalence_pct}<span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>%</span>
          </div>
        </div>
      </div>
      <div className="font-mono text-[10px] tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
        {row.concerned_count} of {row.total_count} audited
      </div>
      <div className="text-sm flex-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        {row.hint}
      </div>
    </div>
  )
}
