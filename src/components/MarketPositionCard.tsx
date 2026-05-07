// MarketPositionCard · read-only display of one_liner / business_model
// / stage on the project page. Fetches build_briefs row directly so it
// survives independent of the audit snapshot. Hides itself entirely
// when all 3 fields are NULL · old projects don't render an empty stub.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface MarketRow {
  one_liner:      string | null
  business_model: string | null
  stage:          string | null
}

const BMODEL_LABELS: Record<string, string> = {
  free:          'Free',
  open_source:   'Open source',
  freemium:      'Freemium',
  subscription:  'Subscription',
  paid_one_time: 'Paid · one-time',
  ad_supported:  'Ad-supported',
  marketplace:   'Marketplace',
  b2b:           'B2B',
  b2c:           'B2C',
  unknown:       'Not set yet',
}

const STAGE_LABELS: Record<string, string> = {
  idea:     'Idea',
  mvp:      'MVP',
  live:     'Live',
  traction: 'Traction',
  scaling:  'Scaling',
}

export function MarketPositionCard({ projectId }: { projectId: string }) {
  const [row, setRow]         = useState<MarketRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('build_briefs')
        .select('one_liner, business_model, stage')
        .eq('project_id', projectId)
        .maybeSingle()
      if (!alive) return
      setRow((data ?? null) as MarketRow | null)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [projectId])

  if (loading) return null
  if (!row) return null

  const bmodelLabel = row.business_model ? (BMODEL_LABELS[row.business_model] ?? row.business_model) : null
  const stageLabel  = row.stage          ? (STAGE_LABELS[row.stage]            ?? row.stage)          : null
  const hasAny = !!(row.one_liner || bmodelLabel || stageLabel)
  if (!hasAny) return null

  return (
    <div
      className="mb-5 p-4"
      style={{
        background:   'rgba(255,255,255,0.025)',
        border:       '1px solid rgba(240,192,64,0.18)',
        borderRadius: '2px',
      }}
    >
      <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
        // MARKET POSITION
      </div>
      {row.one_liner && (
        <p className="font-display font-bold text-base md:text-lg leading-snug mb-3" style={{ color: 'var(--cream)' }}>
          {row.one_liner}
        </p>
      )}
      <div className="flex flex-wrap gap-2 font-mono text-[11px]">
        {bmodelLabel && (
          <span className="px-2 py-0.5" style={{
            background:   'rgba(240,192,64,0.08)',
            color:        'var(--gold-500)',
            border:       '1px solid rgba(240,192,64,0.3)',
            borderRadius: '2px',
          }}>
            {bmodelLabel}
          </span>
        )}
        {stageLabel && (
          <span className="px-2 py-0.5" style={{
            background:   'rgba(0,212,170,0.06)',
            color:        '#00D4AA',
            border:       '1px solid rgba(0,212,170,0.3)',
            borderRadius: '2px',
          }}>
            Stage · {stageLabel}
          </span>
        )}
      </div>
    </div>
  )
}
