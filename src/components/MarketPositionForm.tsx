// MarketPositionForm · post-audit creator review step.
//
// Surfaces 3 light VC-perspective fields (one-liner · business model ·
// stage) the creator confirms before final registration. Pre-fills from
// the audit's rich_analysis + Phase 1 brief — no extra Claude call,
// no fabrication. When signals are missing (beginner project · no live
// URL · no README), fields stay blank and the user fills them in or
// skips entirely.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AnalysisResult } from '../lib/analysis'

const BUSINESS_MODELS = [
  { id: 'free',          label: 'Free' },
  { id: 'open_source',   label: 'Open source' },
  { id: 'freemium',      label: 'Freemium' },
  { id: 'subscription',  label: 'Subscription' },
  { id: 'paid_one_time', label: 'Paid · one-time' },
  { id: 'ad_supported',  label: 'Ad-supported' },
  { id: 'marketplace',   label: 'Marketplace' },
  { id: 'b2b',           label: 'B2B' },
  { id: 'b2c',           label: 'B2C' },
  { id: 'unknown',       label: 'Not sure yet' },
]

const STAGES = [
  { id: 'idea',     label: 'Idea',     hint: 'Sketch · proof-of-concept' },
  { id: 'mvp',      label: 'MVP',      hint: 'Working build · early users' },
  { id: 'live',     label: 'Live',     hint: 'Public · stable' },
  { id: 'traction', label: 'Traction', hint: 'Real usage · growing' },
  { id: 'scaling',  label: 'Scaling',  hint: 'Revenue · optimization' },
]

interface Prefill {
  one_liner?:      string
  business_model?: string
  stage?:          string
}

/** Stage heuristic from audit signals · honest fallbacks, no fabrication.
 *  Returns null when we can't confidently infer · UI leaves the field
 *  blank for the user to fill manually. */
export function inferStage(score: number | null, liveUrlOk: boolean | null): string | null {
  if (score == null) return null
  if (score >= 80 && liveUrlOk) return 'live'
  if (score >= 60 && liveUrlOk) return 'mvp'
  if (score >= 40)              return 'mvp'
  return 'idea'
}

/** Prefill builder · pulls signals from the freshest audit + brief data. */
export function buildPrefill(
  result: AnalysisResult | null,
  briefProblem: string | null,
  liveUrlOk: boolean,
): Prefill {
  if (!result) return {}
  const tldr  = result.rich?.tldr?.trim()
  const oneLiner = (tldr && tldr.length > 0)
    ? (tldr.length > 200 ? tldr.slice(0, 197) + '…' : tldr)
    : (briefProblem ?? '').trim().split('\n')[0].slice(0, 200) || undefined
  const stage = inferStage(result.score_total ?? null, liveUrlOk) ?? undefined
  return { one_liner: oneLiner, stage, business_model: undefined }
}

interface Props {
  projectId:    string
  prefill:      Prefill
  onConfirmed:  () => void
  onSkip?:      () => void
}

export function MarketPositionForm({ projectId, prefill, onConfirmed, onSkip }: Props) {
  const [oneLiner, setOneLiner]     = useState<string>(prefill.one_liner ?? '')
  const [bmodel, setBmodel]         = useState<string>(prefill.business_model ?? '')
  const [stage, setStage]           = useState<string>(prefill.stage ?? '')
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState<string | null>(null)

  // Track which prefill source each field came from · helps render
  // 'auto' vs 'blank · fill in if you know' affordances.
  const initial = useMemo(() => prefill, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const ranges = {
    oneLinerCap: 200,
  }

  useEffect(() => {
    // If prefill arrives async (after first paint), seed empty fields
    // — but never overwrite user edits.
    if (!oneLiner && initial.one_liner)         setOneLiner(initial.one_liner)
    if (!stage    && initial.stage)             setStage(initial.stage)
    if (!bmodel   && initial.business_model)    setBmodel(initial.business_model)
  }, [initial.one_liner, initial.stage, initial.business_model])  // eslint-disable-line react-hooks/exhaustive-deps

  // Standalone edit mode (Market tab on owner brief section): the
  // submit-flow prefill is empty, so load whatever's already in
  // build_briefs and seed the form. One-shot · doesn't refetch on
  // every keystroke.
  useEffect(() => {
    const noPrefill = !prefill.one_liner && !prefill.business_model && !prefill.stage
    if (!noPrefill) return
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('build_briefs')
        .select('one_liner, business_model, stage')
        .eq('project_id', projectId)
        .maybeSingle()
      if (!alive || !data) return
      const r = data as { one_liner: string | null; business_model: string | null; stage: string | null }
      if (r.one_liner)      setOneLiner(r.one_liner)
      if (r.business_model) setBmodel(r.business_model)
      if (r.stage)          setStage(r.stage)
    })()
    return () => { alive = false }
  }, [projectId])  // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true); setError(null)
    const payload = {
      one_liner:      oneLiner.trim() || null,
      business_model: bmodel || null,
      stage:          stage || null,
    }
    const { error } = await supabase
      .from('build_briefs')
      .update(payload)
      .eq('project_id', projectId)
    setBusy(false)
    if (error) { setError(error.message); return }
    onConfirmed()
  }

  const allEmpty = !oneLiner.trim() && !bmodel && !stage
  const blanksCount = (oneLiner.trim() ? 0 : 1) + (bmodel ? 0 : 1) + (stage ? 0 : 1)

  return (
    <div className="card-navy p-5 md:p-6 max-w-2xl mx-auto" style={{ borderRadius: '2px', border: '1px solid rgba(240,192,64,0.32)' }}>
      <div className="font-mono text-xs tracking-widest mb-1" style={{ color: 'var(--gold-500)' }}>
        // MARKET POSITION · review
      </div>
      <h3 className="font-display font-bold text-xl mt-1" style={{ color: 'var(--cream)' }}>
        Confirm what your build is and who it's for
      </h3>
      <p className="font-light text-sm mt-1 mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        We pre-filled what we could from your audit. Edit, complete, or skip — every field is optional.
        {blanksCount > 0 && (
          <>
            {' '}<span style={{ color: 'var(--text-muted)' }}>
              {blanksCount} field{blanksCount === 1 ? '' : 's'} blank · fill in if you know.
            </span>
          </>
        )}
      </p>

      {/* One-liner */}
      <div className="mb-5">
        <div className="flex items-baseline justify-between mb-1">
          <label className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>
            ONE-LINER · WHAT IT DOES
          </label>
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {oneLiner.length}/{ranges.oneLinerCap}
          </span>
        </div>
        <textarea
          value={oneLiner}
          onChange={e => setOneLiner(e.target.value.slice(0, ranges.oneLinerCap))}
          rows={2}
          placeholder="A Stripe-style payments dashboard for indie devs."
          className="w-full font-mono text-sm p-3"
          style={{
            background:    'var(--navy-950)',
            color:         'var(--cream)',
            border:        '1px solid rgba(255,255,255,0.12)',
            borderRadius:  '2px',
            resize:        'vertical',
            lineHeight:    1.5,
          }}
        />
        {prefill.one_liner && oneLiner === prefill.one_liner && (
          <p className="font-mono text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
            ✓ auto-filled from your audit · edit if it's off
          </p>
        )}
      </div>

      {/* Business model */}
      <div className="mb-5">
        <label className="font-mono text-[10px] tracking-widest mb-1.5 block" style={{ color: 'var(--text-label)' }}>
          BUSINESS MODEL · HOW IT MAKES MONEY (OR WILL)
        </label>
        <div className="flex flex-wrap gap-1.5">
          {BUSINESS_MODELS.map(b => {
            const active = bmodel === b.id
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setBmodel(active ? '' : b.id)}
                className="font-mono text-[11px] tracking-wide px-2.5 py-1.5"
                style={{
                  background:   active ? 'rgba(240,192,64,0.14)' : 'transparent',
                  color:        active ? 'var(--gold-500)'      : 'var(--text-secondary)',
                  border:       `1px solid ${active ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '2px',
                  cursor:       'pointer',
                  fontWeight:   active ? 600 : 400,
                }}
              >
                {b.label}
              </button>
            )
          })}
        </div>
        {!bmodel && (
          <p className="font-mono text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
            Blank · Pick if you've decided · 'Not sure yet' is fine.
          </p>
        )}
      </div>

      {/* Stage */}
      <div className="mb-6">
        <label className="font-mono text-[10px] tracking-widest mb-1.5 block" style={{ color: 'var(--text-label)' }}>
          STAGE · WHERE IS IT NOW
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {STAGES.map(s => {
            const active = stage === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStage(active ? '' : s.id)}
                className="text-left px-3 py-2"
                style={{
                  background:   active ? 'rgba(240,192,64,0.10)' : 'rgba(255,255,255,0.02)',
                  color:        active ? 'var(--cream)'         : 'var(--text-secondary)',
                  border:       `1px solid ${active ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: '2px',
                  cursor:       'pointer',
                }}
              >
                <div className="font-mono text-xs" style={{ color: active ? 'var(--gold-500)' : 'var(--text-secondary)' }}>{s.label}</div>
                <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.hint}</div>
              </button>
            )
          })}
        </div>
        {prefill.stage && stage === prefill.stage && (
          <p className="font-mono text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
            ✓ auto-inferred from your score · change if it doesn't match
          </p>
        )}
      </div>

      {error && (
        <p className="font-mono text-[11px] mb-3" style={{ color: 'rgba(248,120,113,0.85)' }}>
          // {error}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="font-mono text-xs tracking-wide px-5 py-3"
          style={{
            background:   busy ? 'rgba(240,192,64,0.25)' : 'var(--gold-500)',
            color:        busy ? 'var(--text-muted)'    : 'var(--navy-900)',
            border:       'none',
            borderRadius: '2px',
            cursor:       busy ? 'wait' : 'pointer',
            fontWeight:   700,
          }}
        >
          {busy ? 'Saving…' : (allEmpty ? 'Continue without setting →' : 'Confirm and finish →')}
        </button>
        {onSkip && !busy && (
          <button
            type="button"
            onClick={onSkip}
            className="font-mono text-xs tracking-wide px-3 py-2"
            style={{
              background:    'transparent',
              color:         'var(--text-muted)',
              border:        '1px solid rgba(255,255,255,0.12)',
              borderRadius:  '2px',
              cursor:        'pointer',
            }}
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  )
}
