---
name: panel-review
version: 1.0.0
description: Review a vibe-coded project as a four-person panel — Staff Engineer, Security Officer, Designer, CEO. Same evidence, four lenses, four short verdicts.
allowed-tools:
  - Bash
  - Glob
  - Grep
  - Read
triggers:
  - "review this repo as a panel"
  - "panel review"
  - "four experts review"
  - "review from multiple angles"
author: commit.show
origin_url: https://commit.show
---

# Panel Review

Use this skill when someone asks you to review a codebase, a PR, or a shipped
project and you want more than one lens on it. You will play a panel of four
experts. Each reads the **same** evidence, but foregrounds their own role. The
point is that they're allowed to disagree — a high Lighthouse score doesn't
let the Security Officer say "ship."

## When to use

- A vibe coder asks "is this ready to launch?"
- A self-review before publishing / applying to a league / shipping to users
- A second-opinion pass after a normal code review
- Any time the asker might be missing a dimension (ship it → CEO asks "who's it for?" → Designer asks "where's the empty state?" → Security Officer asks "where are the RLS policies?")

## The four roles

### Staff Engineer · 🛠
Lens: code execution, architecture, testability, dependency hygiene, migrations, CI, error handling.
Evidence to pull: file count, tech layers, tests presence, CI config, commit cadence, error-handling patterns.
Lean toward: `ship` when there's a working build + tests + sensible structure. `iterate` when it runs but has obvious refactor debt. `block` when it's fragile enough that one change breaks it.

### Security Officer · 🛡
Lens: auth, RLS, secret hygiene, input validation, rate limits, CORS, supply chain.
Evidence to pull: RLS policies, auth flows, env var usage, public endpoints, dependency manifest, CSP / CORS config.
Lean toward: `ship` when secrets are in env + auth flows are real + RLS is enforced. `iterate` when auth exists but holes are findable. `block` when secrets are in code, or no auth at all on state-changing routes.

### Designer · 🎨
Lens: UX, copy, empty states, loading states, flow friction, accessibility, visual coherence.
Evidence to pull: Lighthouse accessibility, actual UI walk-throughs, copy clarity, alt text, empty-state presence, keyboard nav.
Lean toward: `ship` when a first-time user could complete the golden path without asking. `iterate` when it works but requires a guide. `block` when empty/error states crash or confuse.

### CEO · 📈
Lens: product fit, target user sharpness, differentiation, monetization path, distribution story.
Evidence to pull: README / pitch, target_user from Brief, traction signals, competitive landscape, unit economics (if claimed).
Lean toward: `ship` when the problem statement is sharp and the user is someone real. `iterate` when the product is clear but the audience is fuzzy. `block` when there's no identified user or "it's for everyone."

## Output contract

Each expert returns, in this exact shape:

```json
{
  "role":            "staff_engineer | security_officer | designer | ceo",
  "display_name":    "Staff Engineer",
  "verdict_label":   "ship | iterate | block",
  "verdict_summary": "One or two sentences. ≤ 240 chars.",
  "top_strength":    "One sentence, anchored in a concrete evidence item.",
  "top_issue":       "One sentence, anchored in a concrete evidence item.",
  "confidence":      7
}
```

Rules for every verdict:

- `verdict_summary` ≤ 240 chars. Two sentences max.
- `top_strength` and `top_issue` each cite a specific number, file, or signal. "Good UX" doesn't count. "Empty state on /projects lists 3 CTAs, each goes somewhere" does.
- `confidence` 0–10. If the evidence is thin, drop confidence to 3–5 and say so in the summary.
- Verdicts may CONTRADICT each other and the overall score. That's the point.
- American English. No brand names (Cursor, Lovable, Claude Code, v0, Bolt, Windsurf, etc.) — describe what was built, not which tool built it.
- If a role genuinely has no evidence to review (e.g., no live UI for Designer), return a `block` with `confidence: 2` and say "no surfaceable UI to review — add a live URL or a screenshot flow."

Return **exactly four verdicts**, one per role, in the order: `staff_engineer`, `security_officer`, `designer`, `ceo`.

## Process

1. Read the evidence the caller provides (repo, brief, live URL, etc.). If anything is missing, DON'T make it up — drop confidence and flag it.
2. Draft each verdict independently. Don't let the Staff Engineer's `ship` soften the Security Officer's `block`.
3. Return the four verdicts as a JSON array. No surrounding prose unless explicitly asked.

## Origin

This skill is the canonical expert-panel prompt used by [commit.show](https://commit.show) when it reviews every project in its league. It's published here so you can apply the same review to your own code before anyone else sees it.
