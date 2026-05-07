// useRecentAudits — fetches the **highest-scoring audits across the
// platform** (any status, any time) for the CLI demo section so the hero
// terminal cycles through proven projects rather than time-windowed recency.
// Name kept for backwards compatibility — pool semantics changed.
//
// Why score-ranked instead of time-ranked: a 7-day recency window often
// produced a tiny pool (or all walk-ons of dubious quality). Ranking by
// score puts our strongest evaluations on the front page — which is what
// a vibe-coder actually wants to see ("here's what an 84 looks like").
//
// Pool query:
//   - score_total >= 70  (demo-quality floor — "strong" or near-strong)
//   - has scout_brief.strengths[] (>= 2) and weaknesses[] (>= 1) so
//     the rendered transcript reads as a real audit
//   - project_name length <= 24 (won't break terminal width)
//   - status: any (walk-ons + auditioning + graduated · all auditable)
//   - order by score_total DESC, take top 13 after dedupe by project_id
//
// Falls back to a hardcoded shadcn-ui/ui demo if the pool is empty,
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

export async function fetchRecentAuditDemos(): Promise<AuditDemo[]> {
  if (memoCache && Date.now() - memoCache.ts < POOL_TTL_MS) {
    return memoCache.demos
  }
  // Two-stage query: order by created_at DESC so dedupe keeps the
  // LATEST snapshot per project (not the historic high). Then re-sort
  // by score_total DESC and take top 13. Without this, an old snapshot
  // produced under previous calibration outranks today's recalibrated
  // version (e.g. anthropic-sdk 96 from 2026-04-28 pre walk-on max=95
  // beating today's 91, even though today's is the canonical score).
  const { data, error } = await supabase
    .from('analysis_snapshots')
    .select(`
      project_id, created_at, score_total, score_auto, rich_analysis,
      projects!inner(project_name, github_url, status)
    `)
    .gte('score_total', 70)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error || !data) return []

  // Stage A: dedupe by project_id keeping FIRST encountered = LATEST
  // snapshot per project (because query was ordered by created_at DESC).
  const seenProjects = new Set<string>()
  const latestPerProject: RawSnapshot[] = []
  for (const raw of data as unknown as RawSnapshot[]) {
    if (seenProjects.has(raw.project_id)) continue
    seenProjects.add(raw.project_id)
    latestPerProject.push(raw)
  }
  // Stage B · ranking: platform-auditioned projects (status != 'preview')
  // come FIRST regardless of score, then walk-on (CLI · status='preview')
  // fill the tail. Inside each bucket sort by score_total desc. This
  // ensures the hero rotation always seeds with the highest-status
  // surfaces — a member's auditioned product beats an anonymous CLI
  // audit for the marquee slot, even if the CLI score happens to be
  // higher this week. Walk-ons still appear, just behind.
  latestPerProject.sort((a, b) => {
    const aPreview = a.projects?.status === 'preview' ? 1 : 0
    const bPreview = b.projects?.status === 'preview' ? 1 : 0
    if (aPreview !== bPreview) return aPreview - bPreview
    return (b.score_total ?? 0) - (a.score_total ?? 0)
  })

  const demos: AuditDemo[] = []
  for (const raw of latestPerProject) {
    const proj = raw.projects
    if (!proj)                                            continue
    if (!proj.project_name || proj.project_name.length > 24) continue

    const slug = slugFromGithub(proj.github_url)
    if (!slug)                                            continue

    const sBrief = raw.rich_analysis?.scout_brief
    const strengths = (sBrief?.strengths ?? [])
      .map(asBullet).filter((s): s is string => !!s).slice(0, 3).map(s => shortenBullet(s))
    const concerns = (sBrief?.weaknesses ?? [])
      .map(asBullet).filter((s): s is string => !!s).slice(0, 2).map(s => shortenBullet(s))
    if (strengths.length < 2 || concerns.length < 1) continue   // not demo-worthy

    demos.push({
      projectName: proj.project_name,
      slug,
      score:       raw.score_total,
      band:        bandFor(raw.score_total),
      auditPts:    raw.score_auto,
      strengths,
      concerns,
      source:      proj.status === 'preview' ? 'walk_on' : 'platform',
    })
    if (demos.length >= 13) break
  }

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
