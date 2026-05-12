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
