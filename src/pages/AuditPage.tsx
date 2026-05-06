// AuditPage — internal technical reference of the 50-pt Audit pillar.
// Currently INTERNAL — gated to logged-in members only (not just admins,
// any team member can view). Public-safe slim version may be carved out
// later. Sister to /rulebook (public · judging philosophy).

import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { InstallInEditor } from '../components/InstallInEditor'
import { AuditCiBlock } from '../components/AuditCiBlock'

export function AuditPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  if (loading) {
    return (
      <section className="relative z-10 pt-32 pb-16 px-4 min-h-screen text-center">
        <div className="font-mono text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      </section>
    )
  }
  if (!user) {
    return (
      <section className="relative z-10 pt-32 pb-16 px-4 min-h-screen text-center">
        <div className="max-w-md mx-auto">
          <div className="font-display font-black text-2xl mb-2" style={{ color: 'var(--cream)' }}>
            Internal documentation
          </div>
          <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
            The audit mechanics page is for the commit.show team and signed-in
            members. Sign in to access it, or read{' '}
            <Link to="/rulebook" className="underline" style={{ color: 'var(--gold-500)' }}>the public Rulebook</Link>
            {' '}for league judging philosophy.
          </p>
          <button
            onClick={() => navigate('/')}
            className="font-mono text-xs px-5 py-2.5"
            style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
          >
            Back home
          </button>
        </div>
      </section>
    )
  }
  return <AuditPageContent />
}

function AuditPageContent() {
  return (
    <section className="relative z-10 pt-20 pb-20 px-4 md:px-6 min-h-screen">
      <div className="max-w-3xl mx-auto">
        <header className="mb-10">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // AUDIT MECHANICS · v3
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl mb-3" style={{ color: 'var(--cream)' }}>
            How the score gets built
          </h1>
          <p className="font-light text-base" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            The Audit pillar is the 50-point engine half of every project's score.
            Every slot, threshold, and adjustment is documented here. If a number on
            your project ever surprises you, this page explains where it came from.
            For league judging philosophy (Scout forecasts · Community signal · graduation
            tiers), see <Link to="/rulebook" className="underline" style={{ color: 'var(--gold-500)' }}>the Rulebook</Link>.
          </p>
        </header>

        <Section title="1 · The big picture" anchor="overview">
          <P>
            A project's total score is <B>Audit (50) + Scout Forecast (30) + Community
            Signal (20) = 100</B>. This page covers only the Audit half — the part the
            engine measures automatically.
          </P>
          <P>
            The Audit pillar has 7 hard slots (totaling 50 pts) plus soft bonuses
            (up to +5) and one hard penalty (-5). Every slot is calculated by
            deterministic code from the project's GitHub repo + live URL. The
            language model (Claude Sonnet) reads the same evidence and writes
            the prose strengths/concerns — but the numbers are the numbers.
          </P>
          <Table
            rows={[
              ['20 pts',  'Lighthouse',         'Performance · Accessibility · Best Practices · SEO (mobile · PageSpeed Insights)'],
              ['12 pts',  'Production Maturity', 'tests · CI · observability · TS strict · lockfile · LICENSE · responsive'],
              ['5 pts',   'Source Hygiene',     'GitHub accessibility · monorepo discipline · governance docs'],
              ['5 pts',   'Live URL Health',    '200 + SSL + response time'],
              ['2 pts',   'Completeness',       'OG image · twitter · manifest · favicon · meta tags (10 signals)'],
              ['3 pts',   'Tech Layer Diversity', 'frontend + backend + database + AI/web3'],
              ['5 pts',   'Build Brief Integrity', 'Phase 2 brief sections (locked at 0 for walk-ons)'],
            ]}
          />
          <P>
            Soft bonuses (capped +5):
          </P>
          <Table
            rows={[
              ['+0-3', 'Ecosystem',  'GitHub stars · contributors · npm downloads · semver releases'],
              ['+0-2', 'Activity',   'recent commit · momentum (≥20 commits in last 100)'],
            ]}
          />
          <P>
            Hard penalty (deterministic, applied before cap):
          </P>
          <Table
            rows={[
              ['-5', 'env_committed', 'A literal `.env` / `.env.production` file in the repo (excludes `.env.example` + similar templates). Treated as a categorical security violation — no polish offsets it.'],
            ]}
          />
        </Section>

        <Section title="2 · Lighthouse · 20 pts" anchor="lighthouse">
          <P>
            Mobile-strategy run via Google PageSpeed Insights. Each of four
            Lighthouse categories maps to a step bucket. We use mobile (not
            desktop) because mobile-first is the fairer floor for production
            evaluation — desktop scores are typically 10-20 pts higher and
            hide real user pain.
          </P>
          <Table
            rows={[
              ['8 pts',  'Performance',    '90+ → 8 · 70-89 → 6 · 50-69 → 3 · <50 → 0 · not assessed → 4 (neutral)'],
              ['5 pts',  'Accessibility',  '90+ → 5 · 70-89 → 3 · <70 → 1 · not assessed → 3'],
              ['4 pts',  'Best Practices', '90+ → 4 · 70-89 → 2 · <70 → 0 · not assessed → 2'],
              ['3 pts',  'SEO',            '90+ → 3 · 70-89 → 2 · <70 → 0 · not assessed → 2'],
            ]}
          />
          <P>
            "Not assessed" (-1 in our internal sentinel) means PageSpeed couldn't
            compute the category — usually because the live URL didn't render.
            We give a neutral midpoint instead of a 0 so projects that ship
            without a fully-deployed front page aren't punished for what's
            structurally unmeasurable.
          </P>
        </Section>

        <Section title="3 · Production Maturity · 12 pts" anchor="maturity">
          <P>
            The single biggest calibration lever. Built to separate a polished
            greenfield app (vibe-style) from a real production library (shadcn /
            cal.com / supabase style). A repo with zero tests + no CI + no
            observability cannot exceed ~3 pts here, which appropriately limits
            its overall ceiling.
          </P>
          <Table
            rows={[
              ['+0-3', 'Tests',           'Test files (`*.test.*` / `*.spec.*`) — 50+ → 3 · 10-49 → 2 · 1-9 → 1 · 0 → 0'],
              ['+2',   'CI',              'Any of: `.github/workflows/*.yml` · `.gitlab-ci.yml` · `.circleci/config.yml` · `vercel.json` · `netlify.toml`'],
              ['+2',   'Observability',   '1+ deps in package.json from: @sentry · @datadog · pino · winston · @opentelemetry · honeybadger · rollbar · bugsnag · @logtail · @axiomhq · newrelic · @logdna'],
              ['+1',   'TS strict',       '`tsconfig.json` with `compilerOptions.strict: true`'],
              ['+1',   'Lockfile',        'Any of: package-lock.json · yarn.lock · pnpm-lock.yaml · bun.lockb · bun.lock'],
              ['+1',   'LICENSE',         'A LICENSE file at repo root (any extension)'],
              ['+0-2', 'Responsive',      '+1 if Tailwind responsive prefix density (sm/md/lg/xl/2xl) ≥ 10% of class tokens OR ≥5 CSS @media queries · +1 if mobile Lighthouse perf ≥ 70'],
            ]}
          />
          <P>
            The Production Maturity slot ties directly to the <B>Polish × Maturity
            coupling</B> — see §9.
          </P>
        </Section>

        <Section title="4 · Source Hygiene · 5 pts" anchor="hygiene">
          <Table
            rows={[
              ['+3', 'GitHub accessible', 'Public repo, the API can read it'],
              ['+1', 'Monorepo discipline', 'Workspaces declared OR `turbo.json` OR `pnpm-workspace.yaml` OR `packages/*/package.json` present'],
              ['+1', 'Governance docs',  'At least 2 of: CONTRIBUTING.md · CHANGELOG.md · CODE_OF_CONDUCT.md'],
            ]}
          />
        </Section>

        <Section title="5 · Live URL Health · 5 pts" anchor="health">
          <P>
            One GET against the project's live URL. <B>5 pts if HTTP 200 with SSL
            and response time &lt; 3000ms; 0 otherwise.</B> Binary by design — a
            slow site is a slow site, and we don't want to reward "almost there".
          </P>
          <P>
            If the live URL field is empty on the project record, the engine
            tries to infer one from the GitHub repo's <code>homepage</code> field
            before giving up. Most polished libraries set this (e.g.
            shadcn-ui/ui → ui.shadcn.com).
          </P>
        </Section>

        <Section title="6 · Completeness Signals · 2 pts" anchor="completeness">
          <P>
            One HEAD-fetch on the live URL pulls the rendered HTML; we count
            10 production-polish signals and renormalize to 0-2 pts.
          </P>
          <Table
            rows={[
              ['1', 'og:image · og:title · og:description', 'Open Graph (link previews)'],
              ['2', 'twitter:card',                          'Twitter share card'],
              ['3', 'manifest.json',                         'PWA installable hint'],
              ['4', 'apple-touch-icon',                      'iOS home-screen icon'],
              ['5', 'theme-color',                           'browser chrome tint'],
              ['6', 'favicon',                               'tab icon'],
              ['7', 'canonical',                             'duplicate-content guard'],
              ['8', 'meta description',                      'SEO text'],
            ]}
          />
          <P>
            Score is `Math.round((filled / 5) * 2)` — so projects need at least
            ~5 of 10 signals to earn 2 pts.
          </P>
        </Section>

        <Section title="7 · Tech Layer Diversity · 3 pts" anchor="tech">
          <P>
            Detected from <code>language_pct</code> + dependency keywords:
          </P>
          <Table
            rows={[
              ['+2', 'Frontend + Backend + Database', 'TS/JS/HTML/CSS/Svelte/Vue + Python/Go/Rust/Java/Ruby/PHP OR DB keyword (postgres/supabase/etc) + DB layer'],
              ['+1', 'AI layer',                       'claude · openai · anthropic · gpt · gemini · llm · cursor · lovable · v0 · replit'],
              ['+1', 'Web3/MCP',                       'ethereum · solana · base · chain · wallet · web3 · nft · mcp'],
            ]}
          />
          <P>
            Capped at 3 pts. A pure full-stack web app earns 2; adding AI or
            chain integration tops it out.
          </P>
        </Section>

        <Section title="8 · Build Brief Integrity · 5 pts" anchor="brief">
          <P>
            Phase 1 brief completeness — `problem` · `features` · `target_user`
            fields filled with at least 10 chars each.
          </P>
          <Table
            rows={[
              ['5 pts', '3 of 3 fields',       'all required fields filled'],
              ['3 pts', '2 of 3 fields',       'partial'],
              ['1 pt',  '1 of 3 fields',       'minimal'],
              ['0 pts', '0 of 3 fields',       'not filled · or walk-on track (no brief access)'],
            ]}
          />
          <P>
            <B>Walk-on track (CLI users) cannot fill this slot</B> — they never
            reach the /submit form. The walk-on score is normalized against /47
            (52 cap minus this 5-pt brief slot) so they aren't punished for an
            inaccessible field. See §10.
          </P>
        </Section>

        <Section title="9 · Polish × Maturity coupling" anchor="coupling">
          <P>
            A polished tiny app with no tests / no CI / no observability shouldn't
            outscore a real production library. The engine scales the polish
            slots (Lighthouse · Live · Completeness · Tech) by a maturity
            confidence factor.
          </P>
          <Table
            rows={[
              ['Maturity 0/12',  'factor 0.60', 'Polish slots earn 60% credit. A perfect-Lighthouse-but-zero-tests project is hard-capped.'],
              ['Maturity 6/12',  'factor 0.80', '80% credit'],
              ['Maturity 12/12', 'factor 1.00', 'Full credit'],
            ]}
          />
          <P>
            Formula: <code>polishSubtotal × (0.6 + 0.4 × maturity / 10)</code>.
            The `/10` denominator (vs `/12` cap) lets responsive bonus push factor
            slightly above 1.0 when maturity is fully maxed — a small kicker
            for the most disciplined repos. Maturity, Hygiene, Brief, and
            soft bonuses are NOT scaled — they're the maturity evidence itself.
          </P>
        </Section>

        <Section title="10 · Walk-on (CLI) track vs League track" anchor="tracks">
          <P>
            Two tracks for the same Audit pillar:
          </P>
          <Table
            rows={[
              ['Walk-on',  'CLI · `npx commitshow@latest audit` · status="preview"', 'Audit-only score, normalized to /47 (52 hard - 5 brief slot inaccessible). Scout + Community pillars structurally absent — shown as "audit unlocks". Score derived deterministically from score_auto, no Claude qualitative override.'],
              ['Full',     'Audited project · status="active" · brief filled',     'Full 50 + 30 + 20 = 100. Claude reads all evidence, calibrates a final score with bonuses + deductions per the SCORE FORMATION rules. Brief Integrity slot accessible.'],
            ]}
          />
          <P>
            For walk-ons, the engine knows the brief is unfillable, so the
            Phase 1/2 missing penalty is suppressed and the integrity_score = 0
            penalty is bypassed. The display normalizes against /47 to give a
            fair /100 figure.
          </P>
        </Section>

        <Section title="11 · Tier-1 evidence (informational)" anchor="evidence">
          <P>
            These signals are <B>collected</B> on every audit but don't move
            slot scores directly. They surface in the LLM evidence pack so
            strengths/concerns can cite them, and they show up in admin views.
          </P>
          <Table
            rows={[
              ['security_headers', 'GET on live URL · counts CSP · HSTS · X-Frame-Options · X-Content-Type-Options · Referrer-Policy · Permissions-Policy'],
              ['legal_pages',     '/privacy and /terms reachability (3 + 4 path variants probed)'],
              ['readme_depth',    'README line count + presence of Install / Usage sections'],
              ['form_factor',     'app · library · scaffold · unknown — derived from package.json (main/exports/bin/private), workspaces, README phrases'],
              ['dark_mode',       'CSS @media (prefers-color-scheme: dark) detected in any sampled CSS file'],
              ['reduced_motion',  'CSS @media (prefers-reduced-motion) detected'],
              ['npm_downloads',   'Last-week downloads from api.npmjs.org (libraries only)'],
            ]}
          />
          <P>
            These were briefly promoted to score slots in v4 (April 27, 2026)
            but the calibration over-penalized library form factors. We
            reverted scoring; signals stay because the evidence is genuinely
            useful — just don't deduct points for them.
          </P>
        </Section>

        <Section title="12 · CLI integration" anchor="cli">
          <P>
            The CLI is the walk-on lane. <code>npx commitshow@latest audit
            github.com/&lt;owner&gt;/&lt;repo&gt;</code> hits the same engine
            with the same scoring math.
          </P>
          <Table
            rows={[
              ['Walk-on score', 'Claude.score.current bypassed · score_auto / 47 × 100 displayed as the big-digit',
                'Why: walk-ons can\'t fill the brief slot, so leagues\' qualitative bonuses don\'t apply. Math is deterministic from the slots.'],
              ['Cache', 'Per-URL 7-day cache; force-refresh via `--refresh` (counts against IP cap)',
                'Cache hit = no Claude call · audit returns immediately'],
              ['Rate limits', 'IP 20/day (authed) · per-URL 5/day · global 800/day',
                'IP cap defends scraping cached data; URL cap defends repeated billing for same repo; global cap caps total Claude spend'],
              ['Admin bypass', '`x-admin-token` header matching `ADMIN_TOKEN` secret skips all caps',
                'Used by /admin force-refresh button + ops debugging'],
            ]}
          />
          <P>
            CLI output is identical to the cached snapshot view — same big-digit
            ASCII, same 3-axis bar (Audit shown raw, Scout / Community shown as
            "audit unlocks"), same 3 strengths + 2 concerns. The terminal
            bar is the same data the ladder projects render in their detail
            page.
          </P>
        </Section>

        <Section title="13 · Engine + model" anchor="engine">
          <P>
            All audits run through Claude Sonnet 4-6 (model id
            <code>claude-sonnet-4-6</code>) with structured tool_use output.
          </P>
          <P>
            The engine fetches in parallel: Lighthouse mobile (PageSpeed),
            inspectGitHub (~30 GitHub API calls — repo metadata, languages,
            commits, file tree, sampled SQL files, package.json, tsconfig,
            CSS samples, component samples, README, brief search, contributors,
            releases, npm downloads), liveHealth, inspectCompleteness (head
            fetch), inspectSecurityHeaders, inspectLegalPages. The signals
            fold into score_auto (deterministic) which is passed to Claude as
            <code>auto_baseline = score_auto × 2</code>. Claude applies bonuses /
            deductions / form-factor framing per the SCORE FORMATION rules.
          </P>
          <P>
            Anthropic API errors (quota, rate limit, 5xx) are caught and
            surface as a `rich_analysis.error` envelope on the snapshot row —
            the CLI renders a friendly explanation instead of a generic 429.
          </P>
        </Section>

        <Section title="14 · Anti-double-counting" anchor="anti-double">
          <P>
            Claude is given an explicit blocklist: <B>never deduct for any signal
            already priced into one of the auto_50 slots</B>. Specifically NEVER
            for: no tests · no CI · no observability · no TS strict · no lockfile
            · no LICENSE · no monorepo · no governance docs · no GitHub stars ·
            no contributors · no releases · stale repo · committed `.env` (already
            -5 deterministically). Production Maturity at 2/10 already represents
            the deduction; adding "−5 no tests" on top punishes the same fact
            twice. If a project earned 2/10 in Maturity, that 10-point gap from
            ceiling IS the deduction.
          </P>
        </Section>

        <Section title="15 · Calibration baseline (April 2026)" anchor="baseline">
          <P>
            Field-validated reference scores on representative public repos:
          </P>
          <Table
            rows={[
              ['85', 'supabase/supabase', 'Massive open-source SaaS · auto 40/55'],
              ['82', 'shadcn-ui/ui',      'Industry-standard React UI library · auto 37/55'],
              ['80', 'calcom/cal.com',    'Polished production scheduling app · auto 36/55'],
              ['76', 'vercel/ai',         'AI SDK (library form factor)         · auto 34/55'],
              ['71', 'commit.show (vibe)', 'Greenfield 3-month-old indie app    · auto 31/55'],
            ]}
          />
          <P>
            The order is the calibration check. Recognized industry-standard
            projects sit at 80+; greenfield indie sits at 70-72. The bar is
            deliberately tough — graduation threshold is 75, and it should be
            hard to cross.
          </P>
        </Section>

        <Section title="16 · How to improve your score" anchor="improve">
          <P>Walk-on Audit pillar improvements (from highest impact):</P>
          <ul className="pl-0 space-y-2 mb-4">
            <Bullet><B>Lighthouse mobile perf 90+</B> on the live URL → +2 pts in Performance bucket vs 70-89.</Bullet>
            <Bullet><B>Add tests</B> (≥10 files) → +2 pts. ≥50 files → +3 pts.</Bullet>
            <Bullet><B>Add CI</B> (any of: GitHub Actions, GitLab CI, CircleCI, Vercel.json) → +2 pts.</Bullet>
            <Bullet><B>Add observability</B> (Sentry / pino / OTel / Datadog) → +2 pts.</Bullet>
            <Bullet><B>Enable TS strict</B> (`compilerOptions.strict: true`) → +1 pt.</Bullet>
            <Bullet><B>Commit lockfile + LICENSE</B> → +2 pts.</Bullet>
            <Bullet><B>Polish 10/10 completeness</B> (og:image, manifest, apple-touch, etc) → +2 pts.</Bullet>
            <Bullet><B>Run a full audit</B> (fill the brief at <Link to="/submit" className="underline" style={{ color: 'var(--gold-500)' }}>commit.show/submit</Link>) → +5 pts (Brief Integrity slot becomes accessible) plus Scout + Community pillars open up.</Bullet>
          </ul>
          <P>
            <B>Hardest 5 pts to get</B>: 90+ Lighthouse Performance on a real
            production app with images and analytics. Most polished sites land
            70-89 (6 pts). Hitting 90 mobile perf requires aggressive bundling
            + edge caching + image optimization.
          </P>
        </Section>

        <Section title="17 · Run the audit on every pull request" anchor="ci">
          <P>
            The same audit can run as a GitHub Action so the score and
            top concerns get posted as a sticky comment on every pull
            request — regressions surface during review instead of after
            merge. The action is published on GitHub Marketplace as
            "commit.show audit".
          </P>
          <AuditCiBlock githubUrl={null} />
          <P>
            <B>Inputs and quality gates</B> (e.g. fail the check when the
            score drops below 70) are documented in the action's{' '}
            <a href="https://github.com/commitshow/audit-action#inputs"
               target="_blank" rel="noopener noreferrer"
               className="underline" style={{ color: 'var(--gold-500)' }}>
              README
            </a>.
          </P>
        </Section>

        <div className="mt-12 pt-8 text-center" style={{ borderTop: '1px solid rgba(240,192,64,0.15)' }}>
          <p className="font-mono text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            All scoring math is open. Implementation:
          </p>
          <p className="font-mono text-xs">
            <a href="https://github.com/commitshow/commitshow/blob/main/supabase/functions/analyze-project/index.ts"
               target="_blank" rel="noopener noreferrer"
               className="underline" style={{ color: 'var(--gold-500)' }}>
              supabase/functions/analyze-project/index.ts
            </a>
          </p>
          <p className="font-mono text-[11px] mt-3" style={{ color: 'var(--text-muted)' }}>
            Last updated: 2026-04-27 · v3 calibration baseline
          </p>
        </div>

        {/* ── INSTALL IN EDITOR · MCP one-click cards ── */}
        <div className="mt-10">
          <InstallInEditor />
        </div>
      </div>
    </section>
  )
}

function Section({ title, anchor, children }: { title: string; anchor: string; children: React.ReactNode }) {
  return (
    <section id={anchor} className="mb-10" style={{ scrollMarginTop: '80px' }}>
      <h2 className="font-display font-black text-xl md:text-2xl mb-4" style={{ color: 'var(--cream)' }}>
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm font-light" style={{ color: 'var(--text-primary)', lineHeight: 1.7 }}>
      {children}
    </p>
  )
}

function B({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: 'var(--cream)' }}>{children}</strong>
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="pl-3 text-sm font-light flex gap-2" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>
      <span style={{ color: 'var(--gold-500)', flexShrink: 0 }}>·</span>
      <span>{children}</span>
    </li>
  )
}

function Table({ rows }: { rows: Array<[string, string, string] | [string, string]> }) {
  return (
    <div className="my-3" style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
      {rows.map((r, i) => (
        <div
          key={i}
          className={`grid items-start gap-3 px-4 py-2.5 ${r.length === 3 ? 'grid-cols-[88px_minmax(0,1fr)] sm:grid-cols-[100px_150px_minmax(0,1fr)] md:grid-cols-[110px_180px_minmax(0,1fr)]' : 'grid-cols-[110px_minmax(0,1fr)] sm:grid-cols-[130px_minmax(0,1fr)]'}`}
          style={{
            background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
            borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          }}
        >
          <div className="font-mono text-[10px] tracking-widest uppercase pt-0.5 min-w-0" style={{ color: 'var(--gold-500)' }}>
            {r[0]}
          </div>
          {r.length === 3 && (
            <div className="hidden sm:block font-mono text-xs min-w-0 break-words" style={{ color: 'var(--cream)' }}>{r[1]}</div>
          )}
          <div className="font-light text-xs min-w-0 break-words" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {r.length === 3 && (
              <span className="sm:hidden font-mono block mb-0.5" style={{ color: 'var(--cream)' }}>{r[1]}</span>
            )}
            {r.length === 3 ? r[2] : r[1]}
          </div>
        </div>
      ))}
    </div>
  )
}
