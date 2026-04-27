// Minimal Supabase REST client — no SDK, no dependencies.
//
// Design choice (CLAUDE.md §15-C.4): ship as a thin fetch wrapper to stay
// under the 1 MB bundle budget. We only hit PostgREST + Edge Functions, so
// the full @supabase/supabase-js isn't worth the weight.
//
// Anon-key access is enough for V0.1:
//   · projects (public read)
//   · analysis_snapshots (public read)
//   · season_standings view (public read)
// Write paths (submit / link / install with PR) require a member JWT and
// will be enabled when the device-flow endpoint lands.

import { readConfig } from './config.js'

// Baked-in defaults for the official commit.show instance. Self-hosters can
// override via `base_url` in ~/.commitshow/config.json.
const DEFAULT_BASE_URL  = 'https://tekemubwihsjdzittoqf.supabase.co'
const DEFAULT_ANON_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRla2VtdWJ3aWhzamR6aXR0b3FmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MzQ1NzUsImV4cCI6MjA5MjAxMDU3NX0.n2K-3lFVvlXQx-bV9evdNRSQCtG5oC4uQushxB2ja9Y'

function baseUrl(): string {
  return readConfig().base_url ?? DEFAULT_BASE_URL
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const cfg = readConfig()
  return {
    apikey:        DEFAULT_ANON_KEY,
    Authorization: `Bearer ${cfg.token ?? DEFAULT_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}/rest/v1${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers as Record<string, string> ?? {}) },
  })
  if (!res.ok) throw new Error(`API ${res.status} on ${path}: ${await res.text()}`)
  return res.json() as Promise<T>
}

// ── Domain types (narrow subset, just what the CLI renders) ─────────

export interface ProjectRow {
  id:              string
  project_name:    string
  github_url:      string | null
  live_url:        string | null
  score_total:     number
  score_auto:      number
  score_forecast:  number
  score_community: number
  status:          string
  creator_name:    string | null
  creator_grade:   string | null
  last_analysis_at: string | null
}

export interface ScoutBriefItem { axis?: string; bullet?: string }

// Server-side error envelope set on rich_analysis when the Claude call
// itself failed (vs the project just having a low score). CLI uses this
// to render a friendly explanation instead of empty findings.
export type AuditErrorType =
  | 'anthropic_quota_exceeded'
  | 'anthropic_rate_limited'
  | 'anthropic_overloaded'
  | 'anthropic_auth_error'
  | 'anthropic_other'
  | 'claude_returned_no_data'
  | 'network_error'

export interface AuditErrorEnvelope {
  type:                 AuditErrorType | string
  message?:             string
  http_status?:         number
  anthropic_error_type?: string | null
  retry_after_seconds?: number | null
}

export interface SnapshotRow {
  id:                   string
  project_id:           string
  created_at:           string
  trigger_type:         string
  score_total:          number
  score_auto:           number
  score_forecast:       number
  score_community:      number
  score_total_delta:    number | null
  rich_analysis:        {
    scout_brief?: {
      strengths?:  ScoutBriefItem[]
      weaknesses?: ScoutBriefItem[]
    }
    tldr?: string
    headline?: string
    error?: AuditErrorEnvelope          // NEW · set when Claude call failed
  } | null
}

export interface StandingRow {
  project_id:      string
  rank:            number
  total_in_season: number
  percentile:      number
  projected_tier:  string | null
  score_total:     number
}

// ── Lookups ──────────────────────────────────────────────────────────

// PostgREST rejects `SELECT *` when anon has per-column grants (our email-privacy
// migration · §18.2). We enumerate the public columns we actually render.
const PROJECT_COLS =
  'id,project_name,github_url,live_url,score_total,score_auto,score_forecast,' +
  'score_community,status,creator_name,creator_grade,last_analysis_at'

/** Find a project by its canonical GitHub URL. Returns the first match or null. */
export async function findProjectByGithubUrl(url: string): Promise<ProjectRow | null> {
  // DB stores some URLs with .git or trailing slash · match loosely with ilike on owner/repo.
  const canonical = url.replace(/\.git$/, '').replace(/\/+$/, '')
  const ilikePattern = `${canonical.replace(/\*/g, '')}%`
  const rows = await rest<ProjectRow[]>(
    `/projects?select=${PROJECT_COLS}&github_url=ilike.${encodeURIComponent(ilikePattern)}&limit=1`,
  )
  return rows[0] ?? null
}

export async function findProjectById(id: string): Promise<ProjectRow | null> {
  const rows = await rest<ProjectRow[]>(`/projects?select=${PROJECT_COLS}&id=eq.${id}&limit=1`)
  return rows[0] ?? null
}

export async function fetchLatestSnapshot(projectId: string): Promise<SnapshotRow | null> {
  const rows = await rest<SnapshotRow[]>(
    `/analysis_snapshots?project_id=eq.${projectId}&order=created_at.desc&limit=1`,
  )
  return rows[0] ?? null
}

export async function fetchStanding(projectId: string): Promise<StandingRow | null> {
  const rows = await rest<StandingRow[]>(`/season_standings?project_id=eq.${projectId}&limit=1`)
  return rows[0] ?? null
}

// ── Preview audit for unregistered repos ─────────────────────────────
//
// Calls the audit-preview Edge Function. Returns the same {project,snapshot,
// standing} envelope the CLI renders, plus `is_preview` and `cache_hit` hints.
// Full Claude audit depth is preserved — the difference from a real audition
// is that preview rows don't compete in a season, don't earn applauds, and
// don't show up on the leaderboard.

export interface QuotaTier {
  count:     number
  limit:     number
  remaining: number
}
export interface QuotaSnapshot {
  reset_at: string                                          // ISO 8601 · next reset
  ip:       QuotaTier & { tier: 'anon' | 'authed' }
  url:      QuotaTier
  global:   QuotaTier
}

export interface PreviewEnvelope {
  project:    ProjectRow
  snapshot:   SnapshotRow | null
  standing:   null
  is_preview: boolean
  cache_hit:  boolean
  quota?:     QuotaSnapshot
}

export interface PreviewPending {
  project_id:    string
  status:        'running'
  is_preview:    boolean
  cache_hit:     boolean
  poll_after_ms: number
  quota?:        QuotaSnapshot
}

export interface PreviewError {
  error:    string
  reason?:  'ip_cap' | 'url_cap' | 'global_cap'
  message?: string
  limit?:   number
  count?:   number
  quota?:   QuotaSnapshot
}

/** Kicks off (or returns cached) a preview audit. 202 → poll; 200 → done.
 *  force=true skips the 7-day cache and forces a fresh analyze-project run.
 *  Counts against IP + URL + global rate limits (real Claude spend). */
export async function runPreviewAudit(
  githubUrl: string,
  liveUrl?: string,
  opts: { force?: boolean } = {},
): Promise<PreviewEnvelope | PreviewPending | PreviewError> {
  const res = await fetch(`${baseUrl()}/functions/v1/audit-preview`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ github_url: githubUrl, live_url: liveUrl, force: opts.force === true }),
  })
  const body = await res.json().catch(() => ({ error: 'invalid_json' }))
  if (res.status === 202) return body as PreviewPending
  if (!res.ok) return body as PreviewError
  return body as PreviewEnvelope
}

/** Poll a preview job until the snapshot lands or we time out. */
export async function waitForPreviewSnapshot(
  projectId: string,
  timeoutMs = 180_000,
  intervalMs = 4_000,
): Promise<PreviewEnvelope | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const project = await findProjectById(projectId)
    if (project && project.last_analysis_at) {
      const snapshot = await fetchLatestSnapshot(projectId)
      return {
        project,
        snapshot,
        standing: null,
        is_preview: project.status === 'preview',
        cache_hit: false,
      }
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return null
}

// ── Trigger reaudit (requires member token · V1 backend) ─────────────

export async function triggerReaudit(projectId: string): Promise<SnapshotRow> {
  const cfg = readConfig()
  if (!cfg.token) {
    throw new Error('Re-audit requires login. Run `commitshow login` once device-flow is available.')
  }
  const res = await fetch(`${baseUrl()}/functions/v1/analyze-project`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ project_id: projectId, trigger_type: 'resubmit' }),
  })
  if (!res.ok) throw new Error(`Re-audit failed: ${res.status} · ${await res.text()}`)
  return res.json() as Promise<SnapshotRow>
}
