// Public judging rulebook. commit.show's core value proposition is neutral,
// transparent scoring; publishing these rules is both marketing AND legal
// evidence (CLAUDE.md §2 core principle, §17 legal notes).
//
// Last meaningful rewrite: 2026-04-29 — reflects v3.1 form-aware
// calibration · walk-on max 95 · vibe-coder 7-category framework ·
// %-based graduation. No pricing details (those live in
// /backstage and project-level UI).

import { useNavigate } from 'react-router-dom'

export function RulebookPage() {
  const navigate = useNavigate()
  return (
    <section className="relative z-10 pt-20 pb-20 px-4 md:px-6 min-h-screen">
      <div className="max-w-3xl mx-auto">
        {/* Back link · history.back() falls through to /ladder if user landed
            here directly (no referrer in same-app history). */}
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/ladder'))}
          className="mb-5 font-mono text-xs tracking-wide"
          style={{ background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer', padding: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
        >
          ← BACK
        </button>

        <header className="mb-10">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // RULEBOOK · v3.1
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl mb-3" style={{ color: 'var(--cream)' }}>
            How commit.show judges a project
          </h1>
          <p className="font-light text-base" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Every rule that shapes a score or a grade lives here. No secret sauce,
            no human ringmaster with a thumb on the scale. If a Scout, Creator,
            or lawyer ever asks "why did this project graduate?", the answer is
            on this page.
          </p>
        </header>

        <Section title="1 · The season" anchor="season">
          <P>
            Every project runs a <B>3-week season</B>. The season is divided into
            revelation phases that determine what a public viewer can see at any
            moment.
          </P>
          <Table
            rows={[
              ['Week 1 · Days 1-7',   'Blind stage',      'Scores hidden to the public. Creators iterate without pressure.'],
              ['Week 2 · Days 8-14',  'Percentile reveal','Projects surface as relative bands ("top X%"). First rounds of Scout feedback.'],
              ['Week 3 · Days 15-21', 'Scores go live',   'Concrete numbers visible with a 6-hour snapshot delay. Forecasting intensifies.'],
              ['Days 22-28',          'Graduation Week',  'Top 20% computed across the season. Brief Phase 2 auto-published for the Valedictorian.'],
              ['Day 29',              'Graduation Day',   'Results confirmed · badges + Hall of Fame entries dispatched · Alumni Briefs open · Build Logs auto-seeded.'],
            ]}
          />
        </Section>

        <Section title="2 · The score · 100 points" anchor="score">
          <P>
            A project's total score is the sum of three pillars, each with its
            own cap and method of collection.
          </P>
          <Table
            rows={[
              ['50 pts', 'Audit pillar',     'Deterministic code analysis · live URL signals · production-readiness signals · structured failure-mode checks. The half a code analyzer can reach.'],
              ['30 pts', 'Scout Forecast',   'Predictions from verified Scouts. Every forecast vote is uniform weight 1.0. Tier differentiates the monthly quota and how early a Scout sees deeper analysis.'],
              ['20 pts', 'Community Signal', 'Views · comment depth · shares · return visits. Quality-weighted, not raw counts. Bot-clusters score zero.'],
            ]}
          />
          <P>
            <B>Walk-on score caps at 95 / 100.</B> Walk-on is the CLI track —
            a public preview audit that only evaluates the Audit pillar. The
            final 5 points are reserved for Scout + Community signals only an
            actual audition produces. Even a perfect walk-on never reads as
            "100" because half the surface wasn't measured.
          </P>
        </Section>

        <Section title="3 · The Audit pillar · 52 points hard, normalized to 50" anchor="audit">
          <P>
            The Audit pillar is split across 7 slots. Slot <B>weights</B> are
            constant across all projects; slot <B>semantics</B> adapt to the
            project's form factor (app · library · CLI · scaffold). A library
            without a public URL is not penalized for "missing Lighthouse";
            its 20-point Lighthouse-equivalent slot scores tests + docs + types
            instead.
          </P>
          <Table
            rows={[
              ['20 pts', 'Lighthouse-equivalent',
                'App: mobile Lighthouse (Performance 8 · A11y 5 · Best Practices 4 · SEO 3). Library/CLI: tests 8 · docs 7 · TS-strict 3 · LICENSE 2.'],
              ['12 pts', 'Production maturity',
                'tests · CI workflows · observability libs · TS strict · lockfile · LICENSE · responsive intent. Form-aware: libraries get neutral baselines on responsive + observability.'],
              ['5 pts', 'Source hygiene',
                'GitHub repo accessible · monorepo discipline · governance docs (≥2 of CONTRIBUTING / CHANGELOG / CODE_OF_CONDUCT).'],
              ['5 pts', 'Live-equivalent',
                'App: live URL responds in <3s with 2xx + valid SSL. Library/CLI: npm published + last-week downloads ≥ 1k.'],
              ['2 pts', 'Completeness-equivalent',
                'App: og:image · meta · favicon · apple-touch · manifest · theme-color · canonical · meta-desc. Library/CLI: 5+ semver releases + CHANGELOG present.'],
              ['3 pts', 'Tech-layer diversity',
                'Frontend + backend + database + AI layer + Web3/MCP. Capped at 3.'],
              ['5 pts', 'Build Brief integrity',
                'Phase 1 problem · features · target_user filled (3/3 = 5pt). Walk-on substitute up to 3pt: live URL OK + README has Install + Usage + ≥80 lines.'],
            ]}
          />
          <P>
            Soft bonuses stack on top, capped at +10:
          </P>
          <Table
            rows={[
              ['+0-3', 'Ecosystem',  'Stars (10K+ = +3 · 1K = +2 · 100 = +1) · contributors ≥ 50 · npm dl ≥ 1k · 5+ releases. Capped at 3.'],
              ['+0-2', 'Activity',   'Recent commit ≤ 30d · momentum (≥ 20 commits in last 100).'],
              ['+0-5', 'Elite OSS',  'Per-axis 0-2 buckets: stars (5K/10K) · weekly dl (100k/1M) · contributors (50/100). Sum capped 5. Designed for the supabase / cal.com / shadcn-ui tier.'],
            ]}
          />
          <P>
            <B>Hard penalty:</B> committed <code>.env</code> file (with real
            secret patterns) deducts <B>−5</B> deterministically before the
            cap. Polish slots scale with maturity for app form (factor 0.6-1.0)
            so a polished greenfield with no tests can't outscore a real
            production library.
          </P>
        </Section>

        <Section title="4 · Vibe-coder 7-category framework" anchor="vibe-checklist">
          <P>
            The seven systematic failure modes that ~70% of AI-assisted
            projects ship to production without. A generic linter doesn't
            check these; Cursor's inline review doesn't either. We probe
            specifically for them on every audit and surface a 7-card
            checklist alongside the score.
          </P>
          <Table
            rows={[
              ['1', 'Webhook idempotency',
                'Stripe / Slack / GitHub retry webhooks on non-2xx. Without an idempotency-key check, a payment can charge twice.'],
              ['2', 'RLS coverage (Supabase)',
                'RLS is OFF by default. Tables without `enable row level security` + matching `create policy` are open to any authenticated user.'],
              ['3', 'Service-role / secret exposure',
                '`process.env.SUPABASE_SERVICE_ROLE_KEY` reachable from a client file ships in the JS bundle = full database takeover.'],
              ['4', 'Database indexes',
                'AI tends to write `references` clauses but forgets indexes. Fast at 1k rows, collapses at 100k.'],
              ['5', 'Error tracking',
                '`console.log` doesn\'t reach prod. No Sentry / Datadog / pino / winston / OTel = production blind.'],
              ['6', 'API rate limiting',
                'Routes without throttling = open to scraping + bill shock when one enthusiastic agent hammers them.'],
              ['7', 'Prompt injection / unsanitized input',
                '`req.body.message` flowing into a model prompt = attacker can override the system instructions, exfiltrate, or rack up tokens.'],
            ]}
          />
          <P>
            Each category renders as a card with status (pass · warn · fail · N/A),
            a one-line finding specific to your project, prevalence anchor
            ("85% of vibe-coded projects miss this"), and a concrete fix
            recommendation.
          </P>
        </Section>

        <Section title="5 · Graduation · top 20% relative" anchor="graduation">
          <P>
            Graduation is <B>relative</B>, not absolute. At the end of the
            season the league is ranked by total score. The top 20% earn a
            graduation tier; the rest move to the Rookie Circle and come back.
          </P>
          <Table
            rows={[
              ['Valedictorian', '≈0.5% · 1 per season',           'Hall of Fame · permanent archive · official @commitshow video · Build Brief Phase 2 auto-published.'],
              ['Honors',        'Top 5% (excl. Valedictorian)',   'Hall of Fame · certified badge · featured · NFT.'],
              ['Graduate',      'Top 20% (excl. Honors)',         'Graduation badge · full Build Brief publicly revealed · MD Library publishing rights.'],
              ['Rookie Circle', 'Everyone else',                  'Audit findings + Scout commentary preserved. Brief stays private if you choose. Try again next season.'],
            ]}
          />
          <P>
            Even a top-20% score lands in Rookie Circle if any of these basic
            filters fail:
          </P>
          <ul className="pl-0 space-y-2 mb-4">
            <Bullet>Live URL <B>health check passes</B> (HTTP 200 + valid SSL) — production readiness minimum.</Bullet>
            <Bullet>At least <B>2 audit snapshots</B> recorded across the season — single-shot luck doesn't graduate.</Bullet>
            <Bullet>Build Brief Phase 1 <B>Core Intent submitted</B> (problem · features · target user).</Bullet>
            <Bullet><B>No abuse adjudication</B> during the season (see §8).</Bullet>
          </ul>
        </Section>

        <Section title="6 · Creator grade · career track" anchor="grade">
          <P>
            Creator Grade is your cumulative career tier across seasons. It
            only advances through graduated projects — a single great project
            doesn't change it.
          </P>
          <Table
            rows={[
              ['Rookie',        '0 graduated',                                           'Every member starts here.'],
              ['Builder',       '1 graduated · avg ≥ 60',                                'You can ship one project cleanly through 3 weeks.'],
              ['Maker',         '2 graduated · avg ≥ 70',                                'Consistency shows.'],
              ['Architect',     '3 graduated · avg ≥ 75 · tech diversity',               'Range across infra / AI / frontend / Web3.'],
              ['Vibe Engineer', '5 graduated · avg ≥ 80 · 20+ applauds received',        'Craft quality recognized by the community.'],
              ['Legend',        '10+ graduated · community influence',                   'Permanent Hall of Fame resident.'],
            ]}
          />
        </Section>

        <Section title="7 · Scout tier · activity track" anchor="scout">
          <P>
            Scout Tier measures how engaged you are as a critic — not the quality
            of your own projects. Tier comes from Activity Points earned by voting
            and applauding, <B>or</B> from your Forecast accuracy (OR condition).
            Every Forecast vote counts the same across all tiers — tier
            differentiation is carried by the monthly forecast quota and by
            early access to deeper analysis.
          </P>
          <Table
            rows={[
              ['Bronze',   '0 — 499 AP',                                  '20 forecasts / month'],
              ['Silver',   '500 — 1,999 AP  OR 30+ accurate forecasts',   '40 forecasts / month · security analysis 12h early'],
              ['Gold',     '2,000 — 4,999 AP  OR 120+ accurate forecasts','60 forecasts / month · security analysis 24h early'],
              ['Platinum', 'Top 3% AP  OR Top 3% accurate forecasts',     '80 forecasts / month · full analysis early access'],
            ]}
          />
          <P>
            Activity Points are credited in real time. <B>Applauds</B> are a
            lightweight reaction signal — 1 toggle per item, unlimited budget,
            no effect on graduation score. They feed the Community pillar
            weakly as a "reactions present" signal.
          </P>
        </Section>

        <Section title="8 · Evidence integrity" anchor="integrity">
          <P>
            Four sources of evidence are weighed, ranked by trust (lowest to highest).
          </P>
          <ol className="pl-4 space-y-2 mb-4 list-decimal" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>
            <li>Phase 1 self-claims (problem · features · target user) — marketing copy. Treated skeptically.</li>
            <li>Phase 2 <B>pasted</B> extraction — may be tampered in transit. Cross-checked against ground truth.</li>
            <li>Phase 2 <B>committed</B> brief (inside the repo with Git history) — higher trust. Commit SHA and timestamp are referenced as immutability proof.</li>
            <li>Source-code implementation evidence (repo tree · commits · files · live URL probe results) — ground truth. Cannot be faked.</li>
          </ol>
          <P>
            Every mismatch between Phase 2 claims and source-code reality is
            surfaced as a <B>tampering signal</B> with severity ratings.
            High-severity signals reduce the final score by 10-20 points each.
            Medium = -5. Low = -2.
          </P>
        </Section>

        <Section title="9 · Anti-abuse guardrails" anchor="abuse">
          <Table
            rows={[
              ['Comment rate limit',         '≤ 50 / month per member'],
              ['Share rate limit',           '≤ 3 / day per member'],
              ['Forecast cap per Scout',     'Enforced in-DB by tier'],
              ['Applaud / Forecast on own project', 'Blocked at the database level'],
              ['Duplicate-IP / ASN clusters', 'Auto-flagged · their signal silently zeroed'],
              ['Cosine similarity ≥ 0.85 across submissions', 'Triggers manual deeper review'],
              ['Overclaim · Phase 2 contradicts repo',        'Relevant section scores 0; Brief slot capped'],
              ['Commit-sha-aware cache',     'Re-audit only when code actually changes — same sha = 30-day cache hit, different sha = invalidate immediately.'],
            ]}
          />
        </Section>

        <Section title="10 · About this score" anchor="about-this-score">
          <P>
            Audit pillar measures things we can detect with code analysis:
            RLS coverage, webhook integrity, query indexes, error tracking.
            These signals correlate with production-readiness. They don't
            prove it.
          </P>
          <P>
            What this score doesn't see: how clean your domain logic is,
            whether your abstractions hold up under feature load, whether
            your users actually return next week. The most important parts
            of a product are often the ones a code analyzer can't reach.
          </P>
          <P>
            So treat the number like a checkup, not a grade. If your doctor
            hands you a cholesterol reading, you don't tattoo it on your arm.
            You adjust your diet.
          </P>
        </Section>

        <div className="mt-12 pt-6 font-mono text-[11px]" style={{ borderTop: '1px solid rgba(240,192,64,0.15)', color: 'var(--text-muted)', lineHeight: 1.65 }}>
          These rules are binding for the current season. Material changes are
          announced at least two weeks before they take effect and do not apply
          retroactively to projects already in-season. Pricing and refund
          mechanics live on each project's audition page, not here.
        </div>
      </div>
    </section>
  )
}

// ── Helpers ──────────────────────────────────────────────────

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
