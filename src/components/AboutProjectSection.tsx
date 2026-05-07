// AboutProjectSection · casual narrative card right below the project
// hero. Aggregates available signals (Phase 1 brief · Market Position ·
// tech_layers) into a Product-Hunt-style "about this project" block.
// Renders nothing when no signals exist · old projects that haven't
// filled anything stay clean.
//
// 2026-05-07 · sits above comments + section nav so a fresh visitor
// can read what the project IS in 10 seconds without scrolling into
// the audit. The section below (analysis · activity · brief) is for
// people who want to dig in.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface BriefRow {
  problem:        string | null
  features:       string | null      // free text · multi-line bullets
  target_user:    string | null
  ai_tools:       string | null      // free text · comma- or line-separated tool names
  one_liner:      string | null
  business_model: string | null
  stage:          string | null
}

/** Split free-text 'features' into clean bullets. Accepts newlines,
 *  bullets (-, *, ·), or numbered items. Empties + duplicates dropped. */
function parseFeatures(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(/\r?\n/)
    .map(s => s.replace(/^\s*[-*·•·▶◦]\s+/, '').replace(/^\s*\d+[\.\)]\s+/, '').trim())
    .filter(s => s.length > 0)
    .slice(0, 8)
}

function parseTools(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(/[,\n]/)
    .map(s => s.replace(/^\s*[-*·•]\s+/, '').trim())
    .filter(s => s.length > 0 && s.length <= 32)
    .slice(0, 6)
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
  unknown:       'Model not set yet',
}

const STAGE_LABELS: Record<string, string> = {
  idea:     'Idea',
  mvp:      'MVP',
  live:     'Live',
  traction: 'Traction',
  scaling:  'Scaling',
}

export function AboutProjectSection({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [row, setRow]         = useState<BriefRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('build_briefs')
        .select('problem, features, target_user, ai_tools, one_liner, business_model, stage')
        .eq('project_id', projectId)
        .maybeSingle()
      if (!alive) return
      setRow((data ?? null) as BriefRow | null)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [projectId])

  if (loading) return null
  if (!row) return null

  const featureList = parseFeatures(row.features)
  const tools       = parseTools(row.ai_tools)
  // Hide when there's nothing meaningful to say · old projects that
  // never filled brief or market position render nothing.
  const hasContent = !!(
    row.one_liner || row.problem || row.target_user ||
    featureList.length > 0 || tools.length > 0 ||
    row.business_model || row.stage
  )
  if (!hasContent) return null

  const headline    = row.one_liner?.trim() || row.problem?.trim().split('\n')[0]
  const bmodelLabel = row.business_model ? (BMODEL_LABELS[row.business_model] ?? row.business_model) : null
  const stageLabel  = row.stage          ? (STAGE_LABELS[row.stage]            ?? row.stage)          : null

  return (
    <div
      className="mb-6 p-5 md:p-6"
      style={{
        background:   'rgba(240,192,64,0.04)',
        border:       '1px solid rgba(240,192,64,0.22)',
        borderRadius: '2px',
      }}
    >
      <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
        // ABOUT THIS PROJECT
      </div>

      {headline && (
        <p className="font-display font-bold text-lg md:text-xl leading-snug mb-3" style={{ color: 'var(--cream)' }}>
          {headline}
        </p>
      )}

      {row.target_user && (
        <p className="font-light text-sm mb-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
          <span style={{ color: 'var(--text-muted)' }}>Built for </span>
          <span style={{ color: 'var(--cream)' }}>{row.target_user}</span>
          <span style={{ color: 'var(--text-muted)' }}>.</span>
        </p>
      )}

      {featureList.length > 0 && (
        <div className="mb-4">
          <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-label)' }}>
            WHAT IT DOES
          </div>
          <ul className="space-y-1.5">
            {featureList.map((f, i) => (
              <li key={i} className="font-light text-sm flex items-start gap-2" style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>
                <span style={{ color: 'var(--gold-500)', flexShrink: 0 }}>·</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(tools.length > 0 || bmodelLabel || stageLabel) && (
        <div className="flex flex-wrap gap-1.5 pt-3" style={{ borderTop: '1px solid rgba(240,192,64,0.12)' }}>
          {stageLabel && (
            <Chip tone="#00D4AA" label={`Stage · ${stageLabel}`} />
          )}
          {bmodelLabel && (
            <Chip tone="var(--gold-500)" label={bmodelLabel} />
          )}
          {tools.map((t, i) => (
            <Chip key={i} tone="rgba(248,245,238,0.5)" label={t} subtle />
          ))}
        </div>
      )}

      {/* Hide-empty fallback never reached when hasContent is true ·
          but the projectName ref keeps the prop wired for future
          per-name copy. */}
      {!headline && !row.target_user && featureList.length === 0 && (
        <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          The creator hasn't filled in {projectName}'s description yet.
        </p>
      )}
    </div>
  )
}

function Chip({ tone, label, subtle = false }: { tone: string; label: string; subtle?: boolean }) {
  return (
    <span
      className="font-mono text-[11px] px-2 py-0.5"
      style={{
        background:   subtle ? 'rgba(255,255,255,0.04)' : `${tone}15`,
        color:        subtle ? 'var(--text-secondary)'  : tone,
        border:       `1px solid ${subtle ? 'rgba(255,255,255,0.1)' : `${tone}40`}`,
        borderRadius: '2px',
      }}
    >
      {label}
    </span>
  )
}
