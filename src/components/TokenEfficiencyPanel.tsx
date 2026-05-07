// TokenEfficiencyPanel · per-project token spend + efficiency view.
//
// Reads project_token_summary RPC. When no receipt has been uploaded
// yet, renders a "bring your receipts" CTA pointing at
// `npx commitshow extract` instead of the empty card. Owner sees a
// path to upload via the TokenReceiptForm in the brief section.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Summary {
  project_id:        string
  total_tokens:      number
  input_tokens:      number
  output_tokens:     number
  cache_create:      number
  cache_read:        number
  cost_usd:          number
  source_count:      number
  any_verified:      boolean
  first_at:          string | null
  last_at:           string | null
  efficiency_score:  number | null
}

function fmtNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`
  return `$${n.toFixed(2)}`
}

export function TokenEfficiencyPanel({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      const { data, error } = await supabase.rpc('project_token_summary', { p_project_id: projectId })
      if (!alive) return
      if (error) { console.error('[TokenEfficiencyPanel]', error); setSummary(null) }
      else setSummary(((data ?? []) as Summary[])[0] ?? null)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [projectId])

  if (loading) return null
  // No receipt yet · render nothing. Owner already sees the
  // TokenReceiptForm in PRIVATE BRIEF · duplicating the CLI hint here
  // double-stacks the same message. Visitors see nothing either way.
  if (!summary || summary.total_tokens === 0) return null
  // Mark unused param to keep lint happy after empty-state removal.
  void isOwner

  const eff = summary.efficiency_score
  return (
    <div className="card-navy p-5 md:p-6" style={{ borderRadius: '2px', border: '1px solid rgba(240,192,64,0.22)' }}>
      <div className="flex items-baseline justify-between mb-4">
        <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
          // TOKEN USAGE · THIS PROJECT
        </div>
        {summary.any_verified && (
          <span className="font-mono text-[10px] tracking-wide px-2 py-0.5" style={{
            background:   'rgba(63,168,116,0.12)',
            color:        '#3FA874',
            border:       '1px solid rgba(63,168,116,0.45)',
            borderRadius: '2px',
          }}>
            ✓ verified
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="total"        value={fmtNumber(summary.total_tokens)} accent="var(--gold-500)" big />
        <Stat label="input"        value={fmtNumber(summary.input_tokens)} />
        <Stat label="output"       value={fmtNumber(summary.output_tokens)} />
        <Stat label="cache write"  value={fmtNumber(summary.cache_create)} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="cache read"   value={fmtNumber(summary.cache_read)} />
        <Stat label="cost (est.)"  value={fmtUsd(summary.cost_usd)} />
        <Stat label="sources"      value={String(summary.source_count)} />
        <Stat
          label="efficiency"
          value={eff !== null ? `${eff} pts/M` : '—'}
          accent={eff !== null ? '#3FA874' : undefined}
          big
        />
      </div>

      <p className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
        efficiency = score per 1M tokens · higher = more output per token spent · pairs with the audit score on this page
      </p>
    </div>
  )
}

function Stat({ label, value, accent, big = false }: { label: string; value: string; accent?: string; big?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span
        className={`tabular-nums ${big ? 'font-display font-bold text-lg' : 'font-mono text-sm'}`}
        style={{ color: accent ?? 'var(--cream)' }}
      >
        {value}
      </span>
    </div>
  )
}
