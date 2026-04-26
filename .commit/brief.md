# commit.show — Build Brief

## Problem

Vibe-coded projects (built with Cursor, Claude Code, Lovable, v0, Bolt,
Replit AI, etc.) ship faster than ever, but **the market has no neutral
signal for which ones are actually production-ready**. Product Hunt rewards
launch-day virality, GitHub stars reward marketing reach, and Cursor
Directory ships static files with no provenance. A vibe coder's first ten
projects look identical to a recruiter, an investor, or a fellow builder —
because there is no shared yardstick that grades the *thing they built*
rather than the *story they told*.

## Features

1. **Three-axis audit (50% engine · 30% Scout · 20% community)** — every
   submission gets a multi-axis Claude evaluation (Lighthouse + GitHub +
   tech-layer diversity + Brief integrity), human Scout forecasts gated by
   tier, and community signal weighted by quality. Score is reproducible and
   the rubric is public at `/rulebook`.

2. **3-week season with %-based graduation** — top 20% of each season auto-
   promote: Valedictorian (~0.5%), Honors (5%), Graduate (14.5%). The
   remaining 80% land in Rookie Circle and try the next season. No 5-AND
   gate — pure relative ranking inside the cohort.

3. **`commitshow` CLI + `audit-preview` Edge Function** — anyone can run
   `npx commitshow audit github.com/owner/repo` and get the full Claude
   audit (5 strengths, 3 concerns, expert panel) in 60-90 seconds without
   signing up. Cache + per-IP / per-URL / global rate limits keep the cost
   bounded. CLI sidecar writes `.commitshow/audit.{md,json}` so the next
   AI-coding turn has the report as context.

## Target user

Solo vibe coders and small teams who built something real with an AI
coding agent and need a credential they can point at — to recruiters
(LinkedIn-for-vibecoders direction), to investors evaluating throwaway
demos vs. shippable products, and to themselves (recommit loop · weekly
delta tracking · trajectory share card). Secondary: Scouts and seasoned
builders who want to grade and discover work in the AI-coding space
without wading through an undifferentiated feed.

## Stack

- **Frontend** React 18 + Vite + TypeScript + Tailwind, hardware-decoded
  hero video, route-level code splitting, two-stage poster→video.
- **Backend** Supabase (Postgres + Auth + Edge Functions + Realtime).
  17 SQL migrations · 5 Edge Functions (`analyze-project`,
  `audit-preview`, `apply-artifact`, `discover-mds`, `badge`).
- **Audit engine** Claude Sonnet 4.5 with structured tool-use output ·
  4-persona expert panel · 5 strengths + 3 concerns asymmetric scout brief.
- **Lighthouse** Google PageSpeed Insights API.
- **Deploy** Cloudflare Pages (custom domain commit.show) · GitHub auto-build.
- **CLI** packages/cli published as `commitshow` + `@commit.show/cli`
  (alias) on npm.

## Live

- Web: https://commit.show
- CLI: `npx commitshow audit <target>` or `npx @commit.show/cli audit <target>`
- npm: https://npmjs.com/package/commitshow
- Source: https://github.com/hans1329/vibe
