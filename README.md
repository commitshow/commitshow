<h1 align="center">Legit.Show</h1>

<p align="center">
  <strong>Every launched service, tested.</strong><br>
  A directory of launched digital products — each with an objective, reproducible production-readiness benchmark.
</p>

<p align="center">
  <a href="https://legit.show"><img src="https://img.shields.io/badge/legit.show-live-97600F?style=flat-square" alt="legit.show"></a>
  <img src="https://img.shields.io/badge/services-400%2B%20tested-97600F?style=flat-square" alt="services">
  <img src="https://img.shields.io/badge/benchmark-7%20Frames-A8742E?style=flat-square" alt="benchmark">
  <img src="https://img.shields.io/badge/launch-US%202026-211C15?style=flat-square" alt="launch">
</p>

<p align="center">
  <a href="https://legit.show">Discover Legit Products →</a> ·
  <a href="https://legit.show/reports">Reports</a> ·
  <a href="https://legit.show/insights">Insights</a> ·
  <a href="https://legit.show/methodology">Methodology</a>
</p>

---

## What it is

**Legit.Show** is a Yelp-style directory of launched web apps, SaaS, AI tools, MCP servers and developer tools — but instead of stars alone, every listing carries an **objective benchmark of how production-ready it actually is.**

AI-assisted ("vibe") coding ships a flawless demo. Production is the quiet part it skips — monitoring, rate limits, access rules, security headers, a real 404. Legit.Show measures that gap, from the outside, deterministically, and shows exactly what was measured.

- **400+ services**, every one benchmarked.
- **Discover** by category, platform, or "X alternatives" comparisons.
- **Real signals** — human ratings + an engine that measures, never a black-box "good/bad" verdict.

## The benchmark — 7 Frames

Seven frames of production-readiness, 0–100 each, measured from the **public surface** (URL · headers · real Lighthouse) so even closed-source SaaS is fully assessable. A frame a form can't prove is marked *not assessed*, never a zero.

| Frame | Measures |
|---|---|
| **Performance** | How fast it loads (Lighthouse) |
| **Accessibility** | Usable by everyone (Lighthouse) |
| **Security** | Transport · security headers · no leaked secrets |
| **Privacy** | Privacy policy · terms · cookie consent |
| **Reliability** | Routes reachable · valid SSL · real 404 |
| **Standards** | Best-practices · responsive · manifest |
| **Discoverability** | Meta · OpenGraph · structured data · sitemap |
| **+ Maintenance** | Actively maintained (code-host / linked repo only) |

For open-source repos, a deeper **code teardown** enriches the frames — error tracking, rate limiting, RLS, webhook idempotency, prompt-injection exposure, committed secrets, authentication. Deterministic · no LLM in the scoring path · re-checked daily. Full method: **[/methodology](https://legit.show/methodology)**.

## Reports — "According to Legit.Show"

Periodic, reproducible data reports mined from the catalog. Cite-ready stats with stated samples, open methodology, and a copy-paste citation. Rebuilt daily from the current catalog (numbers grow as the directory does).

| Report | Headline |
|---|---|
| [The State of AI-Built Software](https://legit.show/reports/state-of-ai-built-software-2026) | **94%** of AI-built open-source tools ship with no error tracking |
| [The Web Security Baseline](https://legit.show/reports/web-security-baseline-2026) | **81%** of launched web apps ship with no Content-Security-Policy |
| [The Privacy Gap](https://legit.show/reports/the-privacy-gap-2026) | **81%** set cookies with no consent prompt |
| [The State of MCP Servers](https://legit.show/reports/state-of-mcp-servers-2026) | **53%** of MCP servers ship with no authentication |
| [Open Source vs Closed SaaS](https://legit.show/reports/open-source-vs-closed-saas-2026) | Production-readiness, side by side |

## Insights

[**/insights**](https://legit.show/insights) — a live dashboard over the whole catalog: benchmark averages, security & privacy posture (% HTTPS / CSP / privacy policy / Lighthouse), quality distribution, and a discovery-source breakdown.

## For makers

- **Add your service** — paste a URL, verify the domain (meta tag / DNS TXT), and it's listed with its benchmark.
- **Claim it** — owners can verify and edit their listing.
- **Audit anyone** — every listing's full teardown is public ("measured from public surfaces, here's exactly what we saw").

## Mission

Take a vibe-coded MVP and show it the road to production-ready. Every feature is judged against that: *errors first, score second.*

---

## Stack

```
Frontend   React 18 · Vite · TypeScript · Tailwind (amber / cream design system)
Backend    Supabase (Postgres · Auth · Edge Functions · RLS)
Benchmark  Google PageSpeed (real Lighthouse) · GitHub / npm APIs · deterministic scoring
Enrich     Claude (grounded extraction + classification on ingest)
Deploy     Cloudflare Pages (Pages Functions for SSR-light meta + Dataset JSON-LD)
Automation pg_cron — daily ingest · daily report refresh · weekly catalog re-benchmark
```

SEO/AEO: per-page server-rendered meta + schema.org `Dataset` / `Article` / `SoftwareApplication` / `BreadcrumbList`, report bodies server-rendered for AI crawlers, dynamic sitemap.

> This repository also hosts the earlier **commit.show** product (a vibe-coding league), preserved at [legit.show/old](https://legit.show/old).
