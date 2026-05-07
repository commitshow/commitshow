// useRecentAudits — feeds the hero terminal with the highest-scoring
// audits across the platform.
//
// 2026-05-07 split-pool: two parallel queries, top 10 each, hard score
// floor 74. Platform-auditioned (status != 'preview') always seeds the
// rotation, walk-ons (CLI · status='preview') fill the tail.
//
// Pool query (per side):
//   - score_total >= 74  (demo-quality floor)
//   - has scout_brief.strengths[] (>= 2) and weaknesses[] (>= 1) so
//     the rendered transcript reads as a real audit
//   - project_name length <= 24 (won't break terminal width)
//   - dedupe by project_id keeping latest snapshot
//   - top 10 by score_total
//
// Falls back to a hardcoded shadcn-ui/ui demo if both pools are empty,
// API fails, or RLS blocks the read. The HeroTerminal component owns
// the fallback shape so we keep the lib small + framework-agnostic.

import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface AuditDemo {
  projectName: string
  slug:        string                // "owner/repo" for the prompt line
  score:       number                // walk-on /100 — used in big digit
  band:        'strong' | 'mid' | 'weak'
  auditPts:    number                // raw 0-45 audit pillar
  strengths:   string[]              // up to 3
  concerns:    string[]              // up to 2
  // 'platform' = creator submitted via web (status != 'preview') ·
  // 'walk_on'  = anonymous CLI audit (status = 'preview').
  // Hero pool ranks platform above walk-on so the highest-status
  // surface always seeds the rotation, with walk-ons filling out the
  // tail. The Hero terminal can also tag each demo with a small chip.
  source:      'platform' | 'walk_on'
}

interface RawSnapshot {
  project_id:     string
  created_at:     string
  score_total:    number
  score_auto:     number
  rich_analysis:  {
    scout_brief?: {
      strengths?:  Array<{ axis?: string | null; bullet?: string } | string>
      weaknesses?: Array<{ axis?: string | null; bullet?: string } | string>
    }
  } | null
  projects: {
    project_name: string
    github_url:   string | null
    status:       string
  } | null
}

const POOL_TTL_MS = 60_000

function bandFor(score: number): 'strong' | 'mid' | 'weak' {
  if (score >= 75) return 'strong'
  if (score >= 50) return 'mid'
  return 'weak'
}

function asBullet(item: unknown): string | null {
  if (typeof item === 'string') return item.trim() || null
  if (item && typeof item === 'object') {
    const r = item as { bullet?: unknown; finding?: unknown; text?: unknown }
    const v = r.bullet ?? r.finding ?? r.text ?? null
    return typeof v === 'string' ? v.trim() || null : null
  }
  return null
}

function slugFromGithub(url: string | null): string | null {
  if (!url) return null
  const m = url.match(/github\.com[:/]([^/\s?#]+)\/([^/\s?#]+?)(?:\.git)?\/?(?:[?#]|$)/i)
  if (!m) return null
  return `${m[1]}/${m[2]}`
}

function shortenBullet(s: string, max = 56): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
}

let memoCache: { ts: number; demos: AuditDemo[] } | null = null

const SCORE_FLOOR    = 74    // hard cutoff · '74점 이상' per CEO directive
const PER_BUCKET_TOP = 10    // top 10 platform + top 10 walk-on, both shown
const RAW_FETCH      = 120   // each query · room for dedupe and bullet-quality drops

// Build a normalized AuditDemo array from raw snapshot rows · same
// filters (project_name length, slug, ≥2 strengths, ≥1 concern), same
// dedupe (latest snapshot per project), capped at PER_BUCKET_TOP.
function buildDemoBucket(rawRows: RawSnapshot[], source: 'platform' | 'walk_on'): AuditDemo[] {
  // Dedupe by project_id keeping FIRST encountered = LATEST snapshot
  // (rows arrive ordered by created_at DESC). Without this an old
  // pre-calibration snapshot can outrank today's canonical score.
  const seen = new Set<string>()
  const latest: RawSnapshot[] = []
  for (const r of rawRows) {
    if (seen.has(r.project_id)) continue
    seen.add(r.project_id)
    latest.push(r)
  }
  // Re-rank by current score_total within the bucket.
  latest.sort((a, b) => (b.score_total ?? 0) - (a.score_total ?? 0))

  const out: AuditDemo[] = []
  for (const raw of latest) {
    const proj = raw.projects
    if (!proj) continue
    if (!proj.project_name || proj.project_name.length > 24) continue

    const slug = slugFromGithub(proj.github_url)
    if (!slug) continue

    const sBrief = raw.rich_analysis?.scout_brief
    const strengths = (sBrief?.strengths ?? [])
      .map(asBullet).filter((s): s is string => !!s).slice(0, 3).map(s => shortenBullet(s))
    const concerns = (sBrief?.weaknesses ?? [])
      .map(asBullet).filter((s): s is string => !!s).slice(0, 2).map(s => shortenBullet(s))
    if (strengths.length < 2 || concerns.length < 1) continue

    out.push({
      projectName: proj.project_name,
      slug,
      score:       raw.score_total,
      band:        bandFor(raw.score_total),
      auditPts:    raw.score_auto,
      strengths,
      concerns,
      source,
    })
    if (out.length >= PER_BUCKET_TOP) break
  }
  return out
}

export async function fetchRecentAuditDemos(): Promise<AuditDemo[]> {
  if (memoCache && Date.now() - memoCache.ts < POOL_TTL_MS) {
    return memoCache.demos
  }

  // Two parallel queries · platform-auditioned (status != 'preview')
  // and CLI walk-on (status = 'preview'). Each returns up to 10 demos
  // after dedupe + quality filters. Concat puts platform first so the
  // marquee slot always seeds from a real member submission.
  const baseSelect = `
    project_id, created_at, score_total, score_auto, rich_analysis,
    projects!inner(project_name, github_url, status)
  `
  const [platformRes, walkonRes] = await Promise.all([
    supabase
      .from('analysis_snapshots')
      .select(baseSelect)
      .gte('score_total', SCORE_FLOOR)
      .neq('projects.status', 'preview')
      .order('created_at', { ascending: false })
      .limit(RAW_FETCH),
    supabase
      .from('analysis_snapshots')
      .select(baseSelect)
      .gte('score_total', SCORE_FLOOR)
      .eq('projects.status', 'preview')
      .order('created_at', { ascending: false })
      .limit(RAW_FETCH),
  ])

  const platformRows = (platformRes.data ?? []) as unknown as RawSnapshot[]
  const walkonRows   = (walkonRes.data   ?? []) as unknown as RawSnapshot[]

  const platformDemos = buildDemoBucket(platformRows, 'platform')
  const walkonDemos   = buildDemoBucket(walkonRows,   'walk_on')

  const demos = [...platformDemos, ...walkonDemos]
  memoCache = { ts: Date.now(), demos }
  return demos
}

/** React hook · returns the demo pool. Initially [], populates async.
 *  Empty array means consumer should use its hardcoded fallback. */
export function useRecentAudits(): AuditDemo[] {
  const [demos, setDemos] = useState<AuditDemo[]>([])
  useEffect(() => {
    let live = true
    fetchRecentAuditDemos().then(d => {
      if (live) setDemos(d)
    }).catch(() => { /* silent · consumer falls back */ })
    return () => { live = false }
  }, [])
  return demos
}
