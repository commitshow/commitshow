// Shared builder for the "Copy fix prompt" payload — used by both
// OwnerNextStepBanner (top-of-page coach) and the inline ScoutBriefSection
// header button. Single source of truth so the prose stays in sync.

import type { ScoutBriefBullet } from './analysis'

export interface FixPromptArgs {
  projectName:    string | null
  githubUrl:      string | null
  scoreTotal:     number | null
  scoreAuto:      number | null
  scoreForecast:  number | null
  scoreCommunity: number | null
  tldr:           string | null
  strengths:      ScoutBriefBullet[]
  weaknesses:     ScoutBriefBullet[]
}

export function buildFixPrompt(a: FixPromptArgs): string {
  const target = a.projectName && a.githubUrl
    ? `${a.projectName} (${a.githubUrl})`
    : (a.projectName || a.githubUrl || 'this project')
  const slug = (() => {
    if (!a.githubUrl) return null
    const m = a.githubUrl.match(/github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?$/i)
    return m ? `${m[1]}/${m[2].replace(/\.git$/, '')}` : null
  })()
  const lines: string[] = []

  lines.push('# commit.show audit · fix request')
  lines.push('')
  lines.push(`**Project**: ${target}`)
  if (a.scoreTotal !== null) {
    const breakdown: string[] = []
    if (a.scoreAuto      !== null) breakdown.push(`audit ${a.scoreAuto}/50`)
    if (a.scoreForecast  !== null) breakdown.push(`scout ${a.scoreForecast}/30`)
    if (a.scoreCommunity !== null) breakdown.push(`community ${a.scoreCommunity}/20`)
    const tail = breakdown.length > 0 ? ` (${breakdown.join(' · ')})` : ''
    lines.push(`**Current score**: ${a.scoreTotal}/100${tail}`)
  }
  if (a.tldr) {
    const trimmed = a.tldr.length > 280 ? a.tldr.slice(0, 277) + '…' : a.tldr
    lines.push(`**Engine TL;DR**: ${trimmed}`)
  }
  lines.push('')

  lines.push('## Concerns to address (priority order — security and correctness first)')
  lines.push('')
  a.weaknesses.forEach((b, i) => {
    lines.push(`${i + 1}. [${b.axis}] ${b.bullet}`)
  })
  lines.push('')

  if (a.strengths.length > 0) {
    lines.push("## Strengths to preserve (don't break these — they're carrying the score)")
    lines.push('')
    a.strengths.slice(0, 5).forEach((s) => {
      lines.push(`- [${s.axis}] ${s.bullet}`)
    })
    lines.push('')
  }

  lines.push('## Step 0 — pull the evidence pack before editing')
  lines.push('')
  lines.push('Each concern has more detail than the bullet above. Run this FIRST so you')
  lines.push("know which files / which patterns the audit actually keyed on — guessing")
  lines.push('without it usually means re-doing the work after re-audit:')
  lines.push('')
  lines.push('```')
  lines.push('npx commitshow audit'
    + (slug ? ` ${slug}` : '')
    + ' --json')
  lines.push('```')
  lines.push('')
  lines.push('Look at `snapshot.rich_analysis` (`scout_brief`, `vibe_concerns`, axis breakdown). Each concern category typically carries a `samples` / `sample_files` / `evidence_files` list with the exact paths and patterns the detector matched.')
  lines.push('')

  lines.push('## Rules of engagement')
  lines.push('')
  lines.push('- Smallest minimal patch per concern. No refactors, no new dependencies, no behavior changes outside the flagged scope.')
  lines.push('- Stop and ask before doing anything that conflicts with the strengths above (e.g. don\'t replace a working pattern just to reach a metric).')
  lines.push('- **Stop and ask before any destructive history rewrite.** If a concern requires `git filter-repo` / `git filter-branch` / force-pushing to scrub committed secrets, surface the exact commands and the impact (collaborators must re-clone, CI tokens may need rotation) and wait for confirmation. Do not run them autonomously.')
  lines.push('- Apply concerns in order. Skip and explain if a concern is genuinely not actionable in this repo.')
  lines.push('- After every 1-2 concerns, re-run `npx commitshow audit'
    + (slug ? ` ${slug}` : '')
    + '` to verify the fix actually landed before moving on. Cheaper than batching 5 fixes and discovering 2 didn\'t register.')
  lines.push('')

  lines.push("## When you're done")
  lines.push('')
  lines.push('1. Run `npx commitshow audit'
    + (slug ? ` ${slug}` : '')
    + '` to re-score.')
  lines.push('2. Report the new total + which concerns dropped + any new ones the audit surfaced.')
  lines.push('3. If the score didn\'t move, look at `.commitshow/audit.md` (written by the CLI) for the new evidence and decide the next iteration.')

  return lines.join('\n')
}
