// Thin client for the analyze-project Edge Function.
// All heavy lifting (PageSpeed · GitHub · Claude · scoring · DB writes) runs server-side.
// Client only passes a project_id and displays the summary it gets back.

import { supabase } from './supabase'

export interface LighthouseScores {
  performance: number
  accessibility: number
  bestPractices: number
  seo: number
}

export type AxisColor = 'blue' | 'indigo' | 'green' | 'emerald' | 'pink' | 'amber' | 'rose'
export type FindingAccent = 'green' | 'indigo' | 'blue' | 'amber' | 'rose'

export type TamperingSeverity = 'low' | 'medium' | 'high'

// Expert panel (v1.6). Four-persona qualitative review layered on top of
// the numeric score. Present on initial/resubmit/season_end snapshots; on
// weekly/applaud the panel is carried forward from the previous snapshot.
export type ExpertRole = 'staff_engineer' | 'security_officer' | 'designer' | 'ceo'
export type ExpertVerdictLabel = 'ship' | 'iterate' | 'block'

export interface ExpertVerdict {
  role:             ExpertRole
  display_name:     string
  verdict_label:    ExpertVerdictLabel
  verdict_summary:  string
  top_strength:     string
  top_issue:        string
  confidence:       number
}

// Scout-facing distilled bullets (v1.6.1). Creator sees the full analysis;
// scouts see this distilled form. Non-Platinum scouts see all 5 strengths but
// only the first 3 weaknesses — positions 4-5 are the deepest issues, locked
// behind Platinum tier (asymmetric visibility nudges scout upgrades).
export type ScoutBriefAxis = 'Security' | 'Infrastructure' | 'Code' | 'UX' | 'Product' | 'Web3' | 'Ops' | 'AI'

export interface ScoutBriefBullet {
  axis:   ScoutBriefAxis
  bullet: string
}

export interface ScoutBrief {
  strengths:  ScoutBriefBullet[]   // 5 items · all public to signed-in scouts
  weaknesses: ScoutBriefBullet[]   // 5 items · first 3 public, last 2 Platinum-only
}

export interface ScoreBreakdownItem {
  kind: 'baseline' | 'plus' | 'minus' | 'final'
  points: number
  label: string
  evidence?: string
}

export interface RichAnalysis {
  tldr: string
  headline: string
  role_title: { previous: string; current: string; reasoning: string }
  score: {
    previous_estimate: number
    current: number
    delta_reasoning: string
    breakdown?: ScoreBreakdownItem[]
  }
  headline_metrics: Array<{ label: string; value: string; sublabel: string }>
  axis_scores: Array<{
    axis: string
    current: number
    previous: number | null
    delta_label: string
    color_hint: AxisColor
  }>
  github_findings: Array<{ title: string; detail: string; accent: FindingAccent }>
  open_questions: Array<{ title: string; detail: string }>
  honest_evaluation: string
  tampering_signals: Array<{
    severity: TamperingSeverity
    signal: string
    detail: string
  }>
  expert_panel?: ExpertVerdict[]
  scout_brief?: ScoutBrief
}

export interface AnalysisResult {
  score_auto: number
  score_forecast: number
  score_community: number
  score_total: number
  score_total_delta: number | null             // v1.3 · null on initial snapshot
  delta_from_parent: Record<string, number> | null  // v1.3 · per-axis deltas
  creator_grade: string
  verdict: string
  insight: string
  tech_layers: string[]
  graduation_ready: boolean
  unlock_level: number
  lh: LighthouseScores
  github_ok: boolean
  rich: RichAnalysis | null
}

export type AnalysisTriggerType = 'initial' | 'resubmit' | 'applaud' | 'weekly' | 'season_end'

interface EdgeResponse {
  ok: boolean
  snapshot_id?: string
  trigger_type?: AnalysisTriggerType
  score_auto: number
  score_total: number
  score_total_delta?: number | null
  delta_from_parent?: Record<string, number> | null
  breakdown: {
    lighthouse: { performance: number; accessibility: number; bestPractices: number; seo: number; total: number }
    github_pts: number
    tech: { pts: number; layers: string[] }
    brief: { pts: number; filled: number; of: number }
    health_pts: number
  }
  lh: LighthouseScores
  github: { accessible: boolean; language_pct?: Record<string, number> }
  rich: RichAnalysis | null
  health: { ok: boolean; status: number; elapsed_ms: number }
  error?: string
  message?: string
  retry_after_hours?: number
}

function gradeFromScore(auto: number, briefFilled: number): string {
  if (auto >= 40 && briefFilled >= 4) return 'Builder'
  if (auto >= 30) return 'Rookie'
  return 'Rookie'
}

export class CooldownError extends Error {
  retryAfterHours: number
  constructor(message: string, retryAfterHours: number) {
    super(message)
    this.name = 'CooldownError'
    this.retryAfterHours = retryAfterHours
  }
}

// Fetch the latest snapshot for a project and adapt it to AnalysisResult shape.
// Used as a recovery path when the edge function hits the 150s idle timeout:
// the server usually finishes writing the snapshot even though the gateway
// returned 504 to the client.
async function loadLatestSnapshotAsResult(projectId: string): Promise<AnalysisResult & { score_total_delta: number | null; delta_from_parent: Record<string, number> | null } | null> {
  const { data } = await supabase
    .from('analysis_snapshots')
    .select('score_auto, score_total, score_total_delta, delta_from_parent, lighthouse, rich_analysis')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null

  const { data: proj } = await supabase
    .from('projects')
    .select('creator_grade, verdict, claude_insight, tech_layers, github_accessible')
    .eq('id', projectId)
    .maybeSingle()

  const rich = (data.rich_analysis ?? null) as AnalysisResult['rich']
  const lh = (data.lighthouse ?? {}) as { performance?: number; accessibility?: number; bestPractices?: number; seo?: number }
  return {
    score_auto:        data.score_auto ?? 0,
    score_forecast:    0,
    score_community:   1,
    score_total:       data.score_total ?? 0,
    score_total_delta: data.score_total_delta ?? null,
    delta_from_parent: data.delta_from_parent ?? null,
    creator_grade:     proj?.creator_grade ?? 'Rookie',
    verdict:           rich?.tldr ?? rich?.headline ?? proj?.verdict ?? '',
    insight:           rich?.honest_evaluation ?? proj?.claude_insight ?? '',
    tech_layers:       proj?.tech_layers ?? [],
    graduation_ready:  (data.score_total ?? 0) >= 75,
    unlock_level:      0,
    lh: {
      performance:   lh.performance   ?? 0,
      accessibility: lh.accessibility ?? 0,
      bestPractices: lh.bestPractices ?? 0,
      seo:           lh.seo           ?? 0,
    },
    github_ok: !!proj?.github_accessible,
    rich,
  }
}

// After analyze-project returned 504 / network hiccup, give the server up to 90s
// to finish and land a snapshot. Polls every 4s. Returns null if nothing shows up.
async function pollForSnapshot(projectId: string, notBefore: number): Promise<AnalysisResult & { score_total_delta: number | null; delta_from_parent: Record<string, number> | null } | null> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const { data } = await supabase
      .from('analysis_snapshots')
      .select('created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data && new Date(data.created_at).getTime() >= notBefore - 5_000) {
      return await loadLatestSnapshotAsResult(projectId)
    }
    await new Promise(r => setTimeout(r, 4_000))
  }
  return null
}

export async function analyzeProject(
  projectId: string,
  triggerType: AnalysisTriggerType = 'initial',
): Promise<AnalysisResult & { score_total_delta: number | null; delta_from_parent: Record<string, number> | null }> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  const requestStart = Date.now()

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-project`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify({
        project_id: projectId,
        trigger_type: triggerType,
        triggered_by: sess.session?.user?.id ?? null,
      }),
    })
  } catch (e) {
    // Network-level failure — server may still be running. Poll for snapshot.
    const polled = await pollForSnapshot(projectId, requestStart)
    if (polled) return polled
    throw new Error(`Network error contacting analyzer: ${(e as Error).message}`)
  }

  if (res.status === 429) {
    const body = (await res.json()) as EdgeResponse
    throw new CooldownError(body.message ?? 'Cooldown in effect', body.retry_after_hours ?? 24)
  }

  // 504 / 524 / similar = gateway timeout. Server likely finished the snapshot
  // anyway — recover by polling the DB for the new row.
  if (res.status === 504 || res.status === 524 || res.status === 408) {
    const polled = await pollForSnapshot(projectId, requestStart)
    if (polled) return polled
    throw new Error(`Analyzer timed out after 150s and no snapshot landed within 90s. Try again in a minute.`)
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`analyze-project ${res.status}: ${body}`)
  }
  const data = (await res.json()) as EdgeResponse & { partial?: boolean; post_error?: string }

  // Salvage path · engine had a post-snapshot crash and returned the
  // minimal `{ ok, partial, snapshot_id, score_total, post_error }`
  // shape without breakdown/lh/github fields. The snapshot itself
  // landed cleanly though · reconstruct the full AnalysisResult by
  // reading the snapshot back from the DB (same recovery used for
  // 504 timeouts). 2026-05-16 · fixes the runtime TypeError
  // 'Cannot read properties of undefined (reading brief)' that
  // surfaced as 'Submission blocked: Analysis failed'.
  // Defense in depth · ANY non-canonical shape (partial salvage, missing
  // breakdown, missing rich, missing lh) falls through to the snapshot-
  // reload recovery path. The snapshot is the source of truth · the
  // edge response is just an in-memory mirror. If the mirror's
  // incomplete, read the truth.
  const incomplete = data.partial
                  || !data.breakdown
                  || !data.lh
                  || typeof data.score_auto !== 'number'
  if (incomplete) {
    console.warn('[analyze-project] non-canonical response · falling back to snapshot read', {
      partial:        data.partial,
      hasBreakdown:   !!data.breakdown,
      hasLh:          !!data.lh,
      scoreAutoType:  typeof data.score_auto,
      postError:      data.post_error,
    })
    const snap = await loadLatestSnapshotAsResult(projectId)
    if (snap) return snap
    // Snapshot reload ALSO failed · genuine pipeline crash before
    // snapshot INSERT. Throw a friendly message · SubmitForm's
    // friendlyAnalyzeError() maps this to retryable copy.
    throw new Error('snapshot unavailable · the audit didn\'t land. try again in a minute.')
  }

  // All happy-path accesses use optional chaining + sensible fallbacks
  // so a future engine shape change can never recur as a TypeError.
  // The cost of `?? 0` / `?? []` / `?? false` here is invisible · the
  // benefit is a silent TypeError can't crash the user's submission.
  const lh = data.lh ?? { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 }
  return {
    score_auto:        data.score_auto ?? 0,
    score_forecast:    0,
    score_community:   1,
    score_total:       data.score_total ?? (data.score_auto ?? 0) + 1,
    score_total_delta: data.score_total_delta ?? null,
    delta_from_parent: data.delta_from_parent ?? null,
    creator_grade:     gradeFromScore(data.score_auto ?? 0, data.breakdown?.brief?.filled ?? 0),
    verdict:           data.rich?.tldr ?? data.rich?.headline ?? '',
    insight:           data.rich?.honest_evaluation ?? '',
    tech_layers:       data.breakdown?.tech?.layers ?? [],
    graduation_ready:  (data.score_total ?? data.score_auto ?? 0) >= 75,
    unlock_level:      0,
    lh,
    github_ok:         data.github?.accessible ?? false,
    rich:              data.rich ?? null,
  }
}

// Fire-and-forget MD discovery (v1.4 §15.6). Runs in its own edge function
// so it doesn't push analyze-project past the 150s idle timeout. The Discovery
// panel picks up inserted rows via polling/realtime on md_discoveries.
export async function triggerMDDiscovery(projectId: string): Promise<void> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/discover-mds`
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify({ project_id: projectId }),
    })
  } catch {
    // Silent — discovery is best-effort; UI will just show no candidates.
  }
}
