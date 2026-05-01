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
- Source: https://github.com/commitshow/commitshow

---

## Phase 2 — Engineering archaeology

### Failure log (real moments AI got wrong twice or more)

1. **Hero video stutter survived deploys.** Symptom: hardware-decoded MP4
   shipped, mobile still juddered. Cause: Cloudflare CDN cached the prior
   5.6 MB animated WebP for 7 days under our own `/*.webp` cache rule —
   stale browser bundles still requested it. Fix: rename to
   `/hero-bg-v3.{mp4,webm}` (URL-level cache bust) + redirect legacy path
   to the 12 KB poster + 30 fps motion-interpolated re-encode. Prevention:
   big media files only ship under bundle-hashed names now.

2. **Notifications killed `/me` for logged-in users.** Console:
   `cannot add postgres_changes callbacks for realtime:notifications:<id> after subscribe()`.
   Cause: NotificationBell `useEffect` had `open` in its dep array, so
   every dropdown toggle tore down + re-created the realtime channel.
   Supabase channel cache returned the half-disposed channel; calling
   `.on()` threw, killing the React render tree. Fix: `open` moved to a
   ref + per-instance UUID suffix on channel names. Prevention:
   subscribe-once pattern; UI state never drives subscription lifetime.

3. **`npm publish commit.show` rejected as typosquat.** Even
   `commit-show` (hyphen) blocked. Cause: npm typosquatting filter
   rejects unscoped names confusable with an existing package
   (`commitshow` was already published 30 minutes earlier). Fix: scoped
   `@commit.show/cli` alias — npm allows dots inside scope names.
   Forwards via thin bin shim. Prevention: brand-named packages start
   scoped from day one when the brand has punctuation.

### Decision archaeology

1. **CLI before MCP.** Considered: MCP-first (Claude Desktop / Cursor /
   Windsurf register as native tool) or web-only. Reasoning: vibe coders
   99% live in editors that already have shell access (Composer /
   Cascade / Claude Code). For them `npx commitshow audit` IS native —
   the agent shells it. MCP only matters for shell-less surfaces (Claude
   Desktop, ChatGPT). CLI also doubles as the X-viral terminal
   screenshot — MCP cannot match that.

2. **Three-tier rate limit (IP + per-URL + global daily).** Considered:
   IP-only with tighter caps · login-required · Cloudflare Turnstile.
   Reasoning: IP-only defeated by trivial proxy rotation
   ($30/mo residential proxy = 50K IPs). Login-required kills the
   anonymous-friendly viral wedge that was the CLI's whole point.
   Turnstile doesn't fit a terminal flow. Layered caps with
   cache-miss-only counting on URL/global cap Claude API spend at ~$80/day
   worst case while keeping the anonymous flow intact.

### AI delegation map

| Area | AI % | Human % | Notes |
|---|---|---|---|
| Frontend UI components | 90 | 10 | AI wrote React + animations + responsive. Human nudged polish, brand, mobile. |
| Supabase schema + Edge Functions | 85 | 15 | AI wrote 17 migrations + 5 functions. Human directed RLS, rate-limit tiers, cache TTL. |
| Audit pipeline design | 60 | 40 | AI implemented `analyze-project`. Human owned rubric (50/30/20, axis defs, 5+3 asymmetry, expert personas). |
| Brand + marketing copy | 30 | 70 | Human wrote brand vocabulary (Audition / Audit verb pair, Rookie Circle tone, v2 PRD deltas). AI drafted from those primitives. |
| Strategy + priority calls | 10 | 90 | CLI-first vs MCP-first, paid tiers, rate values, when to publish — human. AI surfaced trade-offs. |
| Performance optimization | 95 | 5 | AI handled code splitting, hero video pipeline (ffmpeg minterpolate), CDN rules, lazy-loading. Human only flagged visible issues. |

### Live proof

- Production: <https://commit.show>
- Source: <https://github.com/commitshow/commitshow>
- CLI on npm: <https://npmjs.com/package/commitshow> + <https://npmjs.com/package/@commit.show/cli>
- 5 Edge Functions deployed: `analyze-project`, `audit-preview`, `apply-artifact`, `discover-mds`, `badge`
- 7 tables with RLS: `projects`, `members`, `votes`, `applauds`, `comments`, `build_briefs`, `notifications`

### Next blocker

MCP server (`@commitshow/mcp`) for Claude Desktop / Cursor / Windsurf.
First AI task: scaffold the MCP tool surface (`audit` · `status` ·
`submit` · `applaud` · `forecast` · `notifications.list` ·
`library.search`) reusing the existing `packages/cli/src/lib/api.ts`.
Auth model: long-lived `csk_xxx` token issued from `/me/tokens` after
web OAuth, dropped into the user's `mcpServers` config env. Once
shipped, vibe coders can say "내 프로젝트 점수 봐줘" in Cursor without
ever typing the word `commitshow` — agent discovers the tool natively.
