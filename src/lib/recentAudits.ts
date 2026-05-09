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
  projectId:   string
  projectName: string
  slug:        string                // "owner/repo" for the prompt line
  score:       number                // walk-on /100 — used in big digit
  band:        'strong' | 'mid' | 'weak'
  auditPts:    number                // raw 0-45 audit pillar
  strengths:   string[]              // up to 3
  concerns:    string[]              // up to 2
  githubUrl:   string | null
  liveUrl:     string | null
  // 'platform'      = creator submitted via web (status != 'preview') ·
  // 'walk_on'       = anonymous CLI audit (status = 'preview' AND github_url IS NOT NULL) ·
  // 'url_fast_lane' = anonymous URL-only audit (status = 'preview' AND github_url IS NULL · §15-E).
  // Hero pool order: platform → walk_on → url_fast_lane so highest-status
  // surface always seeds the rotation. Each variant gets its own caption
  // chip + prompt line so viewers see the three entry surfaces side by side.
  source:      'platform' | 'walk_on' | 'url_fast_lane'
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
    live_url:     string | null
    status:       string
    audit_count:  number | null
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

// Pulls the bare host out of a live URL · used as the "slug" for url_fast_lane
// rows so the Hero terminal can render `npx commitshow audit yoursite.com`.
function hostFromLiveUrl(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).host.toLowerCase().replace(/^www\./, '') }
  catch { return null }
}

function shortenBullet(s: string, max = 56): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
}

let memoCache: { ts: number; demos: AuditDemo[] } | null = null

const SCORE_FLOOR    = 74    // hard cutoff · '74점 이상' per CEO directive
const PER_BUCKET_TOP = 10    // top 10 platform + top 10 walk-on, both shown
const RAW_FETCH      = 120   // each query · room for dedupe and bullet-quality drops

// §15-E URL fast lane uses a separate /26 polish scale. The DB column
// `score_total` is the raw absolute pillar (caps near 46 because most
// repo-evidence slots are structurally unattainable for URL audits). The
// number users see on the detail page is `score_auto / URL_LANE_MAX × 100`.
// Hero must compare against that polish number — comparing the floor (74)
// against raw 46 means URL lane never surfaces, even when polish is 88+
// (apple.com / google.com case).
const URL_LANE_MAX = 26
function urlLanePolish(scoreAuto: number): number {
  return Math.max(0, Math.min(100, Math.round((scoreAuto / URL_LANE_MAX) * 100)))
}
// SQL-side prefilter for the url_fast_lane query · score_auto >= 20 maps
// to polish ≥ ~77 with the URL_LANE_MAX=26 scale. We re-apply the exact
// 74 floor in JS after polish conversion below.
const URL_LANE_AUTO_FLOOR = Math.ceil((SCORE_FLOOR * URL_LANE_MAX) / 100)  // ~20

// Build a normalized AuditDemo array from raw snapshot rows · same
// filters (project_name length, slug, ≥2 strengths, ≥1 concern), same
// dedupe (latest snapshot per project), capped at PER_BUCKET_TOP.
function buildDemoBucket(rawRows: RawSnapshot[], source: 'platform' | 'walk_on' | 'url_fast_lane'): AuditDemo[] {
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
  // Compute the display score per row (URL lane = polish, others = raw
  // score_total) and rank by that. Without the polish conversion, URL lane
  // rows are ranked by raw score_total which has a different ceiling.
  const isUrlLane = source === 'url_fast_lane'
  const displayScoreOf = (r: RawSnapshot): number =>
    isUrlLane ? urlLanePolish(r.score_auto ?? 0) : (r.score_total ?? 0)
  latest.sort((a, b) => displayScoreOf(b) - displayScoreOf(a))

  const out: AuditDemo[] = []
  for (const raw of latest) {
    const proj = raw.projects
    if (!proj) continue
    if (!proj.project_name || proj.project_name.length > 24) continue

    // Apply the 74 floor on the user-facing polish score for URL lane,
    // raw score_total for others — keeps the bar consistent with what
    // visitors see on the detail page.
    const display = displayScoreOf(raw)
    if (display < SCORE_FLOOR) continue

    // Slug source depends on bucket · github slug for repo lanes,
    // bare host for the URL fast lane. Both feed the same `slug` field
    // so consumers stay simple — HeroTerminal switches the prompt line
    // based on `source` instead of guessing from the slug shape.
    const slug = source === 'url_fast_lane'
      ? hostFromLiveUrl(proj.live_url)
      : slugFromGithub(proj.github_url)
    if (!slug) continue

    const sBrief = raw.rich_analysis?.scout_brief
    const strengths = (sBrief?.strengths ?? [])
      .map(asBullet).filter((s): s is string => !!s).slice(0, 3).map(s => shortenBullet(s))
    const concerns = (sBrief?.weaknesses ?? [])
      .map(asBullet).filter((s): s is string => !!s).slice(0, 2).map(s => shortenBullet(s))
    if (strengths.length < 2 || concerns.length < 1) continue

    out.push({
      projectId:   raw.project_id,
      projectName: proj.project_name,
      slug,
      score:       display,
      band:        bandFor(display),
      auditPts:    raw.score_auto,
      strengths,
      concerns,
      githubUrl:   proj.github_url,
      liveUrl:     proj.live_url,
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

  // Three parallel queries (§15-E 3-stream Hero):
  //   1. platform      · status != 'preview'                              (member full audit)
  //   2. walk_on       · status = 'preview' AND github_url IS NOT NULL    (CLI repo audit)
  //   3. url_fast_lane · status = 'preview' AND github_url IS NULL        (URL-only audit)
  //
  // Each capped at PER_BUCKET_TOP after dedupe + bullet-quality filters.
  // Concat order = display priority: platform first, walk_on next,
  // url_fast_lane tail. The Hero rotation reveals all three over the
  // 14-stage cycle so viewers see "real members" → "CLI walk-ons" →
  // "URL fast lane" in sequence.
  const baseSelect = `
    project_id, created_at, score_total, score_auto, rich_analysis,
    projects!inner(project_name, github_url, live_url, status, audit_count)
  `
  const [platformRes, walkonRes, urlLaneRes] = await Promise.all([
    supabase
      .from('analysis_snapshots')
      .select(baseSelect)
      .gte('score_total', SCORE_FLOOR)
      .neq('projects.status', 'preview')
      .gte('projects.audit_count', 2)   // §re-audit privacy · round-1 only
                                          // projects don't surface in showcase
                                          // until creator re-audits
      .order('created_at', { ascending: false })
      .limit(RAW_FETCH),
    supabase
      .from('analysis_snapshots')
      .select(baseSelect)
      .gte('score_total', SCORE_FLOOR)
      .eq('projects.status', 'preview')
      .not('projects.github_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(RAW_FETCH),
    supabase
      .from('analysis_snapshots')
      .select(baseSelect)
      // URL lane uses the polish scale (/26 → /100) not raw score_total,
      // so prefilter on score_auto instead. score_auto >= URL_LANE_AUTO_FLOOR
      // (~20) is the SQL-side proxy for polish ≥ 74; final 74 floor is
      // re-applied on the polish value in buildDemoBucket.
      .gte('score_auto', URL_LANE_AUTO_FLOOR)
      .eq('projects.status', 'preview')
      .is('projects.github_url', null)
      .order('created_at', { ascending: false })
      .limit(RAW_FETCH),
  ])

  const platformRows = (platformRes.data ?? []) as unknown as RawSnapshot[]
  const walkonRows   = (walkonRes.data   ?? []) as unknown as RawSnapshot[]
  const urlLaneRows  = (urlLaneRes.data  ?? []) as unknown as RawSnapshot[]

  const platformDemos = buildDemoBucket(platformRows, 'platform')
  const walkonDemos   = buildDemoBucket(walkonRows,   'walk_on')
  const urlLaneDemos  = buildDemoBucket(urlLaneRows,  'url_fast_lane')

  const demos = [...platformDemos, ...walkonDemos, ...urlLaneDemos]
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
