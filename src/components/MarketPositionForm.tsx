// MarketPositionForm · post-audit polish step (renamed 2026-05-16).
//
// Submit flow split: Step 1 collects only what the engine needs to
// ANALYZE (name · email · github · optional live_url + form_factor +
// category). This step is where the creator adds the public-card
// polish (description · images) AND the positioning context (one-
// liner · business model · stage) before going on stage. All five
// fields are optional · the creator can skip and edit later from
// /me or the project detail page.
//
// Pre-fills from the audit's rich_analysis + Phase 1 brief where
// signals exist — no extra Claude call, no fabrication.

import { useEffect, useMemo, useState } from 'react'
import { supabase, type ProjectImage } from '../lib/supabase'
import type { AnalysisResult } from '../lib/analysis'
import { ProjectImagesPicker } from './ProjectImagesPicker'

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
  // Polish fields moved here from Step 1 (2026-05-16). Description
  // shows on the public card · images render in the project hero +
  // /products feed. Prefilled by the dedicated useEffect below from
  // projects.description / projects.images (existing rows that were
  // submitted before this refactor still carry these).
  const [description, setDescription] = useState<string>('')
  const [images, setImages]           = useState<ProjectImage[]>([])
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
  // every keystroke. Also pulls projects.description / projects.images
  // for the polish fields moved into this step (2026-05-16).
  useEffect(() => {
    const noPrefill = !prefill.one_liner && !prefill.business_model && !prefill.stage
    let alive = true
    ;(async () => {
      const [briefRes, projRes] = await Promise.all([
        noPrefill
          ? supabase.from('build_briefs')
              .select('one_liner, business_model, stage')
              .eq('project_id', projectId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('projects')
          .select('description, images')
          .eq('id', projectId)
          .maybeSingle(),
      ])
      if (!alive) return
      if (briefRes.data) {
        const r = briefRes.data as { one_liner: string | null; business_model: string | null; stage: string | null }
        if (r.one_liner)      setOneLiner(r.one_liner)
        if (r.business_model) setBmodel(r.business_model)
        if (r.stage)          setStage(r.stage)
      }
      if (projRes.data) {
        const r = projRes.data as { description: string | null; images: ProjectImage[] | null }
        if (r.description && !description) setDescription(r.description)
        if (Array.isArray(r.images) && r.images.length > 0 && images.length === 0) {
          setImages(r.images)
        }
      }
    })()
    return () => { alive = false }
  }, [projectId])  // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true); setError(null)
    // Two-table write · build_briefs for market position context +
    // projects for the public-card polish (description · images).
    // Run in parallel · either succeeding leaves the row better than
    // before, so we don't roll back the other on partial failure ·
    // just surface the error.
    const briefPayload = {
      one_liner:      oneLiner.trim() || null,
      business_model: bmodel || null,
      stage:          stage || null,
    }
    const projectPayload = {
      description: description.trim() || null,
      images,
    }
    const [briefRes, projRes] = await Promise.all([
      supabase.from('build_briefs').update(briefPayload).eq('project_id', projectId),
      supabase.from('projects').update(projectPayload).eq('id', projectId),
    ])
    setBusy(false)
    if (briefRes.error || projRes.error) {
      setError((briefRes.error ?? projRes.error)!.message)
      return
    }
    onConfirmed()
  }

  const allEmpty = !oneLiner.trim() && !bmodel && !stage && !description.trim() && images.length === 0
  const blanksCount = (description.trim() ? 0 : 1) + (images.length > 0 ? 0 : 1)
                    + (oneLiner.trim() ? 0 : 1) + (bmodel ? 0 : 1) + (stage ? 0 : 1)

  return (
    <div className="card-navy p-5 md:p-6 max-w-2xl mx-auto" style={{ borderRadius: '2px', border: '1px solid rgba(240,192,64,0.32)' }}>
      <div className="font-mono text-xs tracking-widest mb-1" style={{ color: 'var(--gold-500)' }}>
        // STAGE CARD · POLISH
      </div>
      <h3 className="font-display font-bold text-xl mt-1" style={{ color: 'var(--cream)' }}>
        Polish your stage card
      </h3>
      <p className="font-light text-sm mt-1 mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Description + image show on your public card. One-liner / business model / stage add positioning context.
        Everything is optional · skip and you can fill these in any time from your profile.
        {blanksCount > 0 && (
          <>
            {' '}<span style={{ color: 'var(--text-muted)' }}>
              {blanksCount} field{blanksCount === 1 ? '' : 's'} blank.
            </span>
          </>
        )}
      </p>

      {/* Description · public-card primary text (moved from Step 1 ·
          2026-05-16). One sentence on what the product does · this is
          the snippet shown under the project name on /products and in
          search snippets. */}
      <div className="mb-5">
        <label className="block font-mono text-[10px] tracking-widest mb-1" style={{ color: 'var(--text-label)' }}>
          ONE-LINE DESCRIPTION
        </label>
        <input
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What does your project do?"
          maxLength={200}
          className="w-full font-mono text-sm p-3"
          style={{
            background:   'var(--navy-950)',
            color:        'var(--cream)',
            border:       '1px solid rgba(255,255,255,0.12)',
            borderRadius: '2px',
          }}
        />
      </div>

      {/* Images · public-card visuals (moved from Step 1). Up to 3 ·
          first one is the hero shot used as og:image fallback. */}
      <div className="mb-5">
        <label className="block font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-label)' }}>
          IMAGES · UP TO 3
        </label>
        <ProjectImagesPicker value={images} onChange={setImages} max={3} />
      </div>

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
