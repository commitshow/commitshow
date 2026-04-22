# commit.show

**Commit your work. Show to the world.** The vibe coding league where every
commit is evidence. AI scores the work, Scouts forecast the finish, and the
ones ready for production graduate.

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
git clone https://github.com/hans1329/vibe.git
cd vibe
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
2. [dash.cloudflare.com](https://dash.cloudflare.com) → Pages → Create a project → Connect GitHub → `hans1329/vibe`
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
| Automated Analysis | 50% | GitHub API + PageSpeed API + MD integrity |
| Scout Forecast | 30% | Forecast votes (uniform value · tiered monthly quota) |
| Community Signal | 20% | Views · comments · shares · return visits |

**Graduation requires (all five):** Total ≥ 75pts · Auto score ≥ 35/50 ·
≥3 Scout forecasts · 2-week sustained ≥75 · Live URL healthcheck passes.

---

## Roadmap

- **V0 (shipped):** Project submission + AI analysis + score card + feed
- **V0.5 (current):** Auth · Scout tier system · Forecast UI · Artifact Library
  (format × tool × stack · social-signal reputation · Apply-to-my-repo)
- **V1 (next):** 3-week season engine · Scout OR-tier promotion (Forecast accuracy
  path) · Applaud Week · Community Awards · Stripe payments · Creator payouts
- **V1.5:** Scaffold / BKit · Talent market · Season Partners

---

## License

© 2026 commit.show · All rights reserved
