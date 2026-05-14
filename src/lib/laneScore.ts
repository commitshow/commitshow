// laneScore — single source of truth for "what score do we display?"
//
// commit.show audits run in three lanes (§15-E):
//   · platform      — member full audit (repo + brief)        · /50 audit pillar denominator
//   · walk_on       — anonymous CLI audit (repo, no brief)    · /50 audit pillar denominator
//   · url_fast_lane — anonymous URL-only audit (no repo)      · /26 URL polish denominator
//
// Why URL fast lane normalizes separately: 50pt audit pillar has ~30pt of
// repo-evidence slots (Production Maturity 12 · Source Hygiene 5 · Tech
// Diversity 3 · Brief Integrity 5 · plus tests/CI inside Lighthouse-equiv)
// that are STRUCTURALLY UNATTAINABLE without a repo. Reporting a URL audit
// as `26 / 100` reads as "this site is bad" when it actually means "URL
// signals are strong, repo signals unseen". Lane-local normalization fixes
// the denominator to what the lane can actually score against.
//
// The score_auto column on analysis_snapshots is the lane-agnostic absolute
// pillar (caps near 46 for URL lane because of the unattainable slots).
// score_total is currently the platform-lane normalization (auto/50*100).
// URL lane consumers should call `urlLanePolish(score_auto)` instead.

import type { Project } from './supabase'

export type AuditLane = 'platform' | 'walk_on' | 'url_fast_lane'

// URL lane denominator · Lighthouse 20 + Live URL Health 5 + Completeness 2 +
// Responsive 2 + runtime evidence 2 + soft bonuses headroom 2 = 33. Natural
// audit ceiling for a URL-only probe is ~31 score_auto (everything clean,
// no bot wall). Dividing by 33 means a perfect URL audit reads as ~94 — the
// "URL fast lane" lane caps below 100 by design so users can see at a
// glance the audit is partial. A 26 score_auto (meerkats class · LH 10 +
// Live 5 + completeness 2 + responsive 2 + runtime 2 + soft 5) prints 79.
// Bump in lockstep with audit-site-preview when new URL-observable slots
// are added.
export const URL_LANE_MAX = 33

/** Maps lane-agnostic score_auto into the URL lane's 100-point polish scale. */
export function urlLanePolish(scoreAuto: number | null | undefined): number {
  const a = scoreAuto ?? 0
  return Math.max(0, Math.min(100, Math.round((a / URL_LANE_MAX) * 100)))
}

/** Classifies a project row into the lane it was audited under.
 *  · `preview` status + no github_url + has live_url → URL fast lane
 *  · `preview` status + has github_url             → CLI walk-on
 *  · anything else                                 → platform audit
 *
 *  Accepts a partial Project shape so callers can pass whatever they have
 *  loaded (status alone is insufficient · need to inspect github_url).
 */
export function laneOf(
  project: Pick<Project, 'status' | 'github_url' | 'live_url'> | null | undefined,
): AuditLane {
  if (!project) return 'platform'
  if (project.status !== 'preview') return 'platform'
  if (project.github_url) return 'walk_on'
  if (project.live_url)   return 'url_fast_lane'
  // Edge case · preview row with neither github nor live URL. Treat as
  // walk_on rather than url_fast_lane so we don't divide raw scores by 26
  // (this row didn't go through URL probe scoring).
  return 'walk_on'
}

/** Display score · the number we put in big digits on score cards.
 *  URL lane gets lane-normalized polish, others get score_total as-is. */
export function displayScore(
  project: Pick<Project, 'status' | 'github_url' | 'live_url' | 'score_total' | 'score_auto'> | null | undefined,
): number {
  if (!project) return 0
  const lane = laneOf(project)
  if (lane === 'url_fast_lane') return urlLanePolish(project.score_auto)
  return project.score_total ?? 0
}

// ── Score band system · §1-A ⑥ vibe-coder shame mitigation (2026-05-15) ──
//
// Public surfaces (ladder · project cards · share cards · project detail for
// non-creator viewers) display BAND not digit. Reason: vibe coders abandon
// the audition step because the digit feels like a public verdict. Bands
// preserve the comparison signal (Encore beats Strong beats Building) while
// dropping the false precision of "82 vs 79" that drives shame.
//
// Digit stays visible to: creator (own project), admins, paid Patron Scouts
// (V1.5+ tier · sees digit early as part of premium · acts as a real
// gate vs the current "everyone-is-a-Scout" wide-open access). Once a
// project graduates with Encore (score >= 85 captured permanently), the
// digit auto-reveals to everyone — it becomes the trophy.

export type ScoreBand = 'encore' | 'strong' | 'building' | 'early' | 'unknown'

/** Map a display score (0-100) to its band.
 *
 *  Thresholds match the four-band convention used in AuditionPromoteCard
 *  and elsewhere (encore 85+ · strong 70-84 · building 50-69 · early <50).
 *  Returns 'unknown' for null/undefined/0-or-below. */
export function scoreBand(displayScore: number | null | undefined): ScoreBand {
  if (displayScore == null || displayScore <= 0) return 'unknown'
  if (displayScore >= 85) return 'encore'
  if (displayScore >= 70) return 'strong'
  if (displayScore >= 50) return 'building'
  return 'early'
}

/** Human label for a band · used in chips, badges, share cards, alt text. */
export function bandLabel(band: ScoreBand): string {
  switch (band) {
    case 'encore':   return 'Encore'
    case 'strong':   return 'Strong'
    case 'building': return 'Building'
    case 'early':    return 'Early'
    case 'unknown':  return 'Pending'
  }
}

/** CSS color for a band (CSS var or hex) · matches the existing 4-band
 *  palette (gold / emerald / blue / scarlet / muted). Same values as the
 *  AuditionPromoteCard bandColor map so the visual system stays uniform. */
export function bandTone(band: ScoreBand): string {
  switch (band) {
    case 'encore':   return 'var(--gold-500)'
    case 'strong':   return '#00D4AA'
    case 'building': return '#60A5FA'
    case 'early':    return 'var(--scarlet)'
    case 'unknown':  return 'var(--text-muted)'
  }
}

/** Convenience · maps project (any lane) directly to its band. */
export function projectBand(
  project: Pick<Project, 'status' | 'github_url' | 'live_url' | 'score_total' | 'score_auto'> | null | undefined,
): ScoreBand {
  return scoreBand(displayScore(project))
}

// ── Viewer gating · who sees the raw digit ──
//
// Layers of access (most permissive → most restrictive):
//   1. Anonymous           → band only
//   2. Member (Bronze · free Scout default) → band only
//   3. Silver / Gold Scout (AP-based, free)   → band only
//   4. Paid Patron Scout (V1.5+ paid tier)    → digit visible
//   5. Project creator                        → digit visible (own only)
//   6. Admin                                  → digit visible (everyone's)
//   7. Encore graduate (status reflects)      → digit visible to everyone
//
// `paid_patron` field is reserved for the future paid Scout tier; today it
// resolves to `false` for every viewer. The predicate already routes on it
// so flipping the gate is a one-field change when the SKU lands.

export interface ViewerScope {
  member_id?:   string | null
  is_admin?:    boolean
  paid_patron?: boolean         // V1.5+ paid Scout tier · today always false
}

/** True when the given viewer should see the raw digit score for the project.
 *
 *  Encore-graduated projects always reveal the digit (trophy mechanic) — the
 *  shame mitigation only applies during audition. Projects with no creator
 *  (anonymous URL/CLI walk-on previews) only reveal to admins + Patrons since
 *  there's no creator to claim the audit.
 *
 *  Status field accepts plain string so LadderRow + ProjectStatus shapes
 *  both fit (we only compare to the literal 'preview'). */
export function viewerCanSeeDigit(
  project: { creator_id?: string | null; status?: string | null; score_total?: number | null } | null | undefined,
  viewer:  ViewerScope | null | undefined,
): boolean {
  if (!project) return false
  // 7. Encore graduate · digit becomes the trophy, reveal to everyone.
  if ((project.score_total ?? 0) >= 85 && project.status !== 'preview') return true
  if (!viewer) return false
  // 6. Admin · always.
  if (viewer.is_admin) return true
  // 4. Paid Patron Scout · always (V1.5+).
  if (viewer.paid_patron) return true
  // 5. Project creator · digit for own project only.
  if (viewer.member_id && project.creator_id && viewer.member_id === project.creator_id) return true
  // 1-3. Everyone else → band only.
  return false
}
