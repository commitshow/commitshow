<h1 align="center">commit.show</h1>

<p align="center">
  <strong>Every commit, on stage.</strong><br>
  The vibe-coding league where every commit is evidence.
</p>

<p align="center">
  <a href="https://commit.show"><img src="https://img.shields.io/badge/commit.show-live-F0C040?style=flat-square" alt="commit.show"></a>
  <a href="https://www.npmjs.com/package/commitshow"><img src="https://img.shields.io/npm/v/commitshow?label=npm%20%2F%20cli&color=F0C040&style=flat-square" alt="cli"></a>
  <a href="https://github.com/commitshow/cli"><img src="https://img.shields.io/badge/cli-commitshow%2Fcli-0F2040?style=flat-square" alt="cli repo"></a>
  <img src="https://img.shields.io/badge/season-zero-0F2040?style=flat-square" alt="season">
  <img src="https://img.shields.io/badge/launch-US%202026-0F2040?style=flat-square" alt="launch">
</p>

<p align="center">
  <a href="https://commit.show">Visit commit.show →</a>
</p>

```
  ┌──────────────────────────────────────────────────────────┐
  │  commit.show · Audit report                               │
  └──────────────────────────────────────────────────────────┘

    your-build                          owner/your-build

  ┌──────────────────────────────────────────────────────────┐
  │ What this build missed                                   │
  │ ↓ No API rate limiting on /auth endpoint                 │
  │ ↓ Accessibility 72 · buttons missing aria-labels         │
  │                                                          │
  │ What it got right                                        │
  │ ↑ Tests cover the auth path · CI green for 30 days       │
  │ ↑ Full-stack evidence · 6 tech layers                    │
  │ ↑ Brief integrity 9/10 · all 6 sections answered         │
  └──────────────────────────────────────────────────────────┘

                  ╔═══════════════════════════╗
                  ║                           ║
                  ║     █████╗   ██████╗      ║
                  ║    ██╔══██╗ ╚════██╗      ║
                  ║    ╚█████╔╝  █████╔╝      ║
                  ║    ██╔══██╗ ██╔═══╝       ║
                  ║    ╚█████╔╝ ███████╗      ║
                  ║     ╚════╝  ╚══════╝      ║
                  ║                           ║
                  ║   82 / 100 · strong       ║
                  ╚═══════════════════════════╝

      Audit  42/50  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱
      Scout  26/30  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱
      Comm.  14/20  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱

      Ranked    #3 of 47   Season Zero
      Tier      Honors     (top 5%)
                                              commit.show
```

```bash
# audit any public repo from your terminal — no signup
npx commitshow@latest audit github.com/owner/repo
```

<p align="center">
  <a href="https://github.com/commitshow/commitshow"><img src="https://img.shields.io/github/stars/commitshow/commitshow?style=for-the-badge&logo=github&label=Star%20%E2%98%85%20commit.show&color=F0C040&labelColor=0F2040" alt="Star commit.show"></a>
</p>

<p align="center">
  <strong>If commit.show changes how you think about shipping vibe-coded work — drop a ⭐.</strong><br>
  <sub>Stars tell us this league is wanted · they help vibe-coders find each other faster.</sub>
</p>

---

## What is commit.show

A **structured league** for vibe-coded (AI-assisted) projects. Unlike a popularity
contest, every project gets a transparent **100-point score** — broken into
three signals that each catch different kinds of nonsense:

| Pillar | Weight | Caught by |
|---|---|---|
| **Audit** | 50% | Claude reads the repo + Lighthouse + GitHub signals · objective evidence |
| **Scout forecast** | 30% | Tier-gated humans place forecast votes · social proof with skin in the game |
| **Community signal** | 20% | Views · comments · returning attention · the room reacts |

Run a season for three weeks. The top 20% **graduate** and earn permanent
status (`Valedictorian` · `Honors` · `Graduate`). The rest land in the
**Rookie Circle** with the audit notes they need to come back stronger.

> Season Zero · US Launch 2026

---

## Three ways in

### 1. Audit your build (no signup)

```bash
npx commitshow@latest audit github.com/yourname/your-repo
```

The CLI calls the same Claude-grade audit engine the league runs internally,
prints the report in your terminal, and (in local mode) drops `.commitshow/audit.md`
into your repo so your AI coding agent can read it on the next turn. Repo:
[commitshow/cli](https://github.com/commitshow/cli).

### 2. Audition for the season

Audition at [commit.show/submit](https://commit.show/submit) to enter the
ladder. You unlock Scout forecasts, weekly recommit deltas, season ranking,
Backstage prompt extraction, and (if you graduate) the Hall of Fame.

### 3. Become a Scout

Forecast which projects will graduate. Tier-gated monthly ballots. Hit-rate
earns activity points and tier promotion. The Scouts who spotted the eventual
Valedictorian early get permanent **Early Spotter** badges on their profile.

---

## What's in the audit report

- **Score** · 100-point total, split into the three pillars above
- **3 strengths + 2 concerns** · asymmetric by design — concerns don't dominate
- **Vibe-coder findings** · 7 categories the audit specifically checks for
  (RLS coverage · API rate limiting · secrets in client code · prompt-injection
  surface · DB indexes · error tracking · etc.)
- **Rank + projected tier** · where it stands in this week's window
- **Δ since last snapshot** · what changed when

Public scoring rubric: [commit.show/rulebook](https://commit.show/rulebook).
Per-pillar deep dive (logged-in members): [commit.show/audit](https://commit.show/audit).

---

## Live badge

Once a project is auditioning, drop a live-updating badge into the project's
own README:

```markdown
[![commit.show](https://tekemubwihsjdzittoqf.supabase.co/functions/v1/badge?project=YOUR_PROJECT_ID)](https://commit.show/projects/YOUR_PROJECT_ID)
```

Append `&style=pill` for the larger embed. Snippet auto-generated on the
project page after auditioning.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind |
| Backend | Supabase (Postgres + Auth + Edge Functions + Realtime) |
| Audit engine | Claude API · `claude-sonnet-4-6` |
| Lighthouse | Google PageSpeed Insights API |
| CLI | [commitshow/cli](https://github.com/commitshow/cli) · npm `commitshow` |
| Deploy | Cloudflare Pages |

---

## Install

Requires **Node 20+** and a Supabase project (anon key is public-safe; the
service-role key stays server-side, only used by Edge Functions).

```bash
git clone https://github.com/commitshow/commitshow.git
cd commitshow
npm install
cp .env.example .env
```

Edit `.env`:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from supabase dashboard>
VITE_PAGESPEED_KEY=<google PageSpeed key · optional>
```

Apply the database schema and ordered migrations:

```bash
psql "$DATABASE_URL" -f supabase/schema.sql
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

Edge Functions (audit-preview, analyze-project, etc.) deploy through the
Supabase CLI:

```bash
npx supabase functions deploy analyze-project audit-preview discover-mds badge apply-artifact
```

## Usage

### Local dev

```bash
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # tsc + vite build → dist/
npm run preview      # serve dist/ locally
npx tsc --noEmit     # type check (run before push)
```

### Audit a project from the terminal

```bash
npx commitshow@latest audit github.com/owner/repo            # markdown report
npx commitshow@latest audit github.com/owner/repo --json     # full JSON envelope
```

The CLI lives in [github.com/commitshow/cli](https://github.com/commitshow/cli)
and ships separately on npm as the `commitshow` package.

### Audit from any HTTP client (no shell required)

```bash
curl 'https://api.commit.show/audit?repo=github.com/owner/repo&format=md'
curl 'https://api.commit.show/audit?repo=github.com/owner/repo&format=json'
```

OpenAPI 3.1 spec: <https://api.commit.show/openapi.json>.

### Use inside an MCP-aware editor (Claude Desktop · Cursor · Cline)

```jsonc
{
  "mcpServers": {
    "commitshow": {
      "command": "npx",
      "args": ["-y", "commitshow-mcp"]
    }
  }
}
```

### Deploy

Connect this repo to Cloudflare Pages — framework `Vite`, build command
`npm run build`, output directory `dist`. Every `git push` to `main` triggers
a fresh deploy; no `wrangler deploy` step needed.

---

## Roadmap

| Phase | Status |
|---|---|
| **V0** — audition flow · audit engine · score card · feed | shipped |
| **V0.5** — auth · Scout tiers · forecast UI · Artifact Library · Creator Community | shipped |
| **V1** — %-based season engine · Stripe audition fee · payouts · season-end automation · OAuth (Google · X · GitHub) · Terms / Privacy · CLI ANSI Shadow render · X share trigger | in progress |
| **V1.5** — CLI login + install · Scaffold / BKit · talent market · MCP server · Twitter auto-post · Bundle curation | after V1 |

---

## Links

- Platform — <https://commit.show>
- Rulebook — <https://commit.show/rulebook>
- Privacy — <https://commit.show/privacy>
- Terms — <https://commit.show/terms>
- CLI repo — <https://github.com/commitshow/cli>
- npm package — <https://www.npmjs.com/package/commitshow>
- REST API — <https://api.commit.show/openapi.json>

---

## License

[MIT](./LICENSE) · © 2026 [Madeflo Inc.](https://commit.show)

The platform is operated by **Madeflo Inc.**, a Delaware corporation.
"commit.show" is the product brand; legal filings, payouts, and external
service registrations all use the Madeflo Inc. entity.

---

<p align="center">
  <strong>Every commit, on stage.</strong>  <a href="https://commit.show">commit.show</a>
</p>

<p align="center">
  © 2026 Madeflo Inc. · commit.show · All rights reserved
</p>
