// Encore · 2026-05-05 rebrand · single-threshold quality badge that
// replaced the 4-tier graduation system (valedictorian / honors /
// graduate / rookie_circle).
//
// Why the change: a continuous ladder has no "graduation event", so
// awarding tier labels at season-end was conceptually mismatched.
// Encore is just a badge on the project itself — the moment its
// `score_total` crosses the threshold the badge shows up; if it
// later regresses it disappears. No cron, no ceremony.
//
// Threshold lives in this file so adjusting it is one edit + redeploy.
// Pre-existing graduation_grade column is left in the DB for now
// (read by legacy components until they're swept) but new UI should
// only depend on the score-derived encore signal.

// 2026-05-05 · raised from 84 to 85. Hits a cleaner round-edge mark
// and ensures sub-85 climbers (e.g. score 76) don't get surfaced in
// any "Encore" lane / chart by accident.
export const ENCORE_THRESHOLD = 85

export function isEncoreScore(score: number | null | undefined): boolean {
  return typeof score === 'number' && score >= ENCORE_THRESHOLD
}
