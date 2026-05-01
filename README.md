# commit.show

**Every commit, on stage. Audited by the engine, auditioned for Scouts.** The
vibe coding league where every commit is evidence. Audit scores the work,
Scouts forecast the finish, and the top 20% of each season graduate.

> Season Zero · US Launch 2026

---

## What is commit.show?

A structured league platform for vibe-coded (AI-assisted) projects. Unlike
Product Hunt's popularity contest, commit.show uses a **50% automated analysis +
30% Scout forecast + 20% community signal** scoring system to determine which
projects are truly production-ready.

**Graduation** = Hall of Fame + Certification badge + Media exposure (10K
guaranteed for Valedictorian) + Entry fee refund.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| Backend | Supabase (PostgreSQL + Auth + Edge Functions + Realtime) |
| AI Analysis | Claude API (claude-sonnet-4-5) |
| Lighthouse | Google PageSpeed Insights API |
| Deployment | Cloudflare Pages |

---

## Getting Started

### 1. Clone & install

```bash
git clone https://github.com/commitshow/commitshow.git
cd commitshow
npm install
```

### 2. Set up environment

```bash
cp .env.example .env
```

Edit `.env`:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_PAGESPEED_KEY=your_google_api_key   # optional
```

### 3. Set up Supabase

Go to your Supabase dashboard → SQL Editor → paste and run `supabase/schema.sql`,
then apply migrations under `supabase/migrations/` in chronological order.

### 4. Run dev server

```bash
npm run dev
```

---

## Deploy to Cloudflare Pages

1. Push to GitHub
2. [dash.cloudflare.com](https://dash.cloudflare.com) → Pages → Create a project → Connect GitHub → `commitshow/commitshow`
3. Build settings:
   - Framework preset: Vite
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_PAGESPEED_KEY` (optional)
5. Save and Deploy → `vibe.pages.dev` live
6. Custom domain: Pages → Custom domains → commit.show

---

## Scoring System

| Component | Weight | Source |
|-----------|--------|--------|
| Audit | 50% | GitHub API + PageSpeed + Brief integrity |
| Scout Forecast | 30% | Forecast votes (uniform value · tiered monthly quota) |
| Community Signal | 20% | Views · comments · shares · return visits |

**Graduation** = top 20% of each season (relative standing), split into
Valedictorian (≈0.5%) · Honors (5%) · Graduate (14.5%) · Rookie Circle (rest).
Basic filter: Live URL + two snapshots in-season + Brief Core Intent submitted.

---

## Badge

Once your project is auditioning, drop a live-updating badge into your
project's own README:

```markdown
[![commit.show](https://tekemubwihsjdzittoqf.supabase.co/functions/v1/badge?project=YOUR_PROJECT_ID)](https://commit.show/projects/YOUR_PROJECT_ID)
```

Append `&style=pill` for the larger embed. Grab the snippet from the **README
BADGE** section on your project page after auditioning.

---

## Roadmap

- **V0 (shipped):** Audition flow + audit engine + score card + feed
- **V0.5 (shipped):** Auth · Scout tier system · Forecast UI · Artifact Library
  (Intent-first · GitHub-Trending UX · Apply-to-my-repo) · polymorphic Applaud ·
  Creator Community (Build Logs · Stacks · Asks · Office Hours) · README badge
- **V1 (next):** %-based season engine (top 20% auto-graduation) · Scout OR-tier
  promotion · Stripe audition fee + Library payments · Creator payouts
- **V1.5:** `commitshow` CLI (`npx commitshow audit`) · Scaffold / BKit · Talent
  market · Season Partners · MCP server

---

## License

© 2026 commit.show · All rights reserved
