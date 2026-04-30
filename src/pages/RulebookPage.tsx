// Public judging rulebook. commit.show's core value proposition is neutral,
// transparent scoring; publishing these rules is both marketing AND legal
// evidence (CLAUDE.md §2 core principle, §17 legal notes).
//
// 2026-04-30 rewrite — restructured around §11-NEW Ladder + Events PRD:
//   · Ladder is the primary surface (always-on)
//   · 7 use-case categories (productivity / niche SaaS / creator / dev
//     tools / AI agents / consumer / games)
//   · Events (incl. quarterly = season) are admin-created drops
//   · Quarterly events still produce graduation tiers
//   · Form factor / stage / pricing are orthogonal filters, not categories
// No pricing details (live on each project's audit page).

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
            // RULEBOOK · v3
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl mb-3" style={{ color: 'var(--cream)' }}>
            How commit.show judges a project
          </h1>
          <p className="font-light text-base" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Every rule that shapes a score, a rank, or a graduation tier lives
            here. No secret sauce, no human ringmaster with a thumb on the
            scale. If a Scout, Creator, or lawyer ever asks "why is this
            project ranked above that one?", the answer is on this page.
          </p>
        </header>

        <Section title="1 · The Ladder · always live" anchor="ladder">
          <P>
            The ladder is commit.show's primary surface. Every audited project
            ranks against its peers in <B>one of seven use-case categories</B>,
            across <B>four time windows</B>. There is no off-season — the
            moment an audit finishes, the project's rank updates.
          </P>
          <Table
            rows={[
              ['Categories',  '7 use-case buckets',
                'Productivity & Personal · Niche SaaS · Creator & Media · Dev Tools · AI Agents & Chat · Consumer & Lifestyle · Games & Playful. Picked by the Creator (auto-detected suggestion at submit time).'],
              ['Windows',     'Today · Week · Month · All-time',
                'Today/Week refresh every 5 minutes. Month / All-time every hour. Switch the chip at the top of /ladder.'],
              ['Tiebreaker',  '5-stage',
                'Score total · last-audit recency · Audit pillar score · audit count (fewer = better — lucky-roll deterrent) · project creation date.'],
              ['Coverage',    'Active + graduated',
                'Walk-on / preview audits stay out of the ladder · they appear only in the hero terminal demo. Categories with zero entries simply hide.'],
            ]}
          />
          <P>
            <B>Ranks are public · scores are public.</B> No hidden multipliers,
            no editorial reshuffles. If a project rank surprises you, the
            tiebreaker columns explain why.
          </P>
        </Section>

        <Section title="2 · The score · two layers" anchor="score">
          <P>
            commit.show runs <B>two scoring layers</B>. The ladder layer is
            always live; the events layer kicks in only when the admin runs
            a quarterly event or other showcase.
          </P>
          <Table
            rows={[
              ['Ladder · always',
                'Audit 70% + Community 30%',
                'No Scout-Forecast pillar. Pure code-evidence + community reaction signal. This is what every project is ranked on by default.'],
              ['Quarterly event',
                'Audit 50 + Scout 30 + Community 20',
                'Only during a 3-week quarterly. Adds a Scout-Forecast pillar that lets verified Scouts predict project performance. Drives the graduation cut.'],
              ['Other event templates',
                'Per-template scoring',
                'Tool Challenge / Theme Sprint / Quality Bar / Sponsored Showcase / Open Bounty — each picks its own scoring method (audit-only, audit+community, etc).'],
            ]}
          />
          <P>
            <B>Walk-on score caps at 95 / 100.</B> Walk-on is the CLI track —
            <code> npx commitshow audit github.com/owner/repo</code> — that
            evaluates only the Audit pillar with no brief and no Scout signals.
            The remaining 5 points are reserved for the parts only a full
            commit.show submission produces.
          </P>
        </Section>

        <Section title="3 · Categories · 7 use-case buckets" anchor="categories">
          <P>
            Categories describe <B>what the project does</B>, not how it's
            built. Form factor (web / mobile / CLI), maturity stage, and
            free-vs-paid live as orthogonal filters elsewhere.
          </P>
          <Table
            rows={[
              ['Productivity & Personal', 'Personal productivity', 'Notes · dashboards · automation · personal utilities · internal tools.'],
              ['Niche SaaS',              'Vertical / role micro-SaaS', 'Industry-specific or role-specific SaaS with auth + billing.'],
              ['Creator & Media',         'Creative tooling', 'Design · video · image · writing · generative media · creator-economy.'],
              ['Dev Tools',               'Built for developers', 'CLI · libraries · IDE plugins · coding agents · SDKs · scaffolds.'],
              ['AI Agents & Chat',        'Agentic / conversational', 'Autonomous agents · chatbots · automation workers · RAG products.'],
              ['Consumer & Lifestyle',    'Mass-consumer', 'Health · finance · travel · learning · social · everyday consumer.'],
              ['Games & Playful',         'Games + interactive', 'Games · interactive fiction · playful experiments.'],
            ]}
          />
          <P>
            <B>Auto-detector suggests, Creator picks.</B> On every audit a
            keyword + form-factor + tech-layer detector writes a suggestion
            into <code>detected_category</code>. The Creator then confirms or
            overrides at audit-result time (or via the project EDIT form at
            any time). The picked category is what determines ladder
            placement; the auto-suggestion is a hint with a "SUGGESTED" badge.
          </P>
          <P>
            If the Creator never picks one, the auto-suggestion is used as a
            fallback so the project doesn't disappear from the ladder.
          </P>
        </Section>

        <Section title="4 · The Audit pillar · 52 points hard, normalized to 50" anchor="audit">
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

        <Section title="5 · Vibe-coder 7-category framework" anchor="vibe-checklist">
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

        <Section title="6 · Events · admin-curated drops" anchor="events">
          <P>
            Beyond the always-on ladder, the admin can launch <B>events</B> on
            its own schedule. Six templates, each with its own rules:
          </P>
          <Table
            rows={[
              ['Quarterly',           '3-week season',
                'Adds Scout Forecast pillar · ends in graduation cut (top 20%) · Hall of Fame entry for Valedictorian.'],
              ['Tool Challenge',      'Per-tool 30-day',
                'Audit-only scoring · entries filtered by tool used (Cursor / Claude / Lovable / etc) · 3 winners.'],
              ['Theme Sprint',        '7-day theme',
                'Audit + community signal · all entries must address the announced theme.'],
              ['Quality Bar',         'Threshold-gated',
                'Auto-validated by detectors (e.g. webhook idempotency · RLS coverage · 7-cat framework). Pass-or-fail.'],
              ['Sponsored Showcase',  'Sponsor-funded',
                'Sponsor brings the prize pool · admin-approved · scoring method per agreement.'],
              ['Open Bounty',         'Spec-to-solution',
                'A documented problem with acceptance criteria · first to solve (or all who solve) gets the reward.'],
            ]}
          />
          <P>
            Entry into an event is <B>opt-in</B>. The 3-tier model:
          </P>
          <Table
            rows={[
              ['Ladder',   'Auto · everyone',         'Every audited project ranks on the ladder by default. No event involvement.'],
              ['Eligible', 'Auto · matches filter',   'Project matches an event\'s eligibility (category / tool / score threshold) · gets a notification · NOT yet competing.'],
              ['Entered',  'Manual · explicit click', 'Creator confirms entry · project is now on the event leaderboard with a frozen snapshot.'],
            ]}
          />
          <P>
            "Eligible" never auto-promotes to "Entered". A small sponsor pool
            never gets diluted by every passing project.
          </P>
        </Section>

        <Section title="7 · Graduation · only during quarterly events" anchor="graduation">
          <P>
            Graduation only happens during a <B>Quarterly event</B>. The
            always-on ladder doesn't graduate anyone — it just ranks. When a
            quarterly closes, the top 20% of <B>entered</B> projects earn a
            graduation tier; the rest move to the Rookie Circle and can
            re-enter next quarterly.
          </P>
          <Table
            rows={[
              ['Valedictorian', '≈0.5% · 1 per quarterly',         'Hall of Fame (Spring/Summer/Fall/Winter cohort) · permanent archive · official @commitshow video · Build Brief Phase 2 auto-published.'],
              ['Honors',        'Top 5% (excl. Valedictorian)',    'Hall of Fame · certified badge · featured · NFT.'],
              ['Graduate',      'Top 20% (excl. Honors)',          'Graduation badge · full Build Brief publicly revealed · MD Library publishing rights.'],
              ['Rookie Circle', 'Everyone else',                   'Audit findings + Scout commentary preserved. Brief stays private if you choose. Try again next quarterly.'],
            ]}
          />
          <P>
            Even a top-20% score lands in Rookie Circle if any of these basic
            filters fail:
          </P>
          <ul className="pl-0 space-y-2 mb-4">
            <Bullet>Live URL <B>health check passes</B> (HTTP 200 + valid SSL) — production readiness minimum.</Bullet>
            <Bullet>At least <B>2 audit snapshots</B> recorded across the quarterly — single-shot luck doesn't graduate.</Bullet>
            <Bullet>Build Brief Phase 1 <B>Core Intent submitted</B> (problem · features · target user).</Bullet>
            <Bullet><B>No abuse adjudication</B> during the quarterly (see §11).</Bullet>
          </ul>
        </Section>

        <Section title="8 · Streaks + milestones · permanent badges" anchor="streaks">
          <P>
            Two flavors of recognition track ladder progress year-round:
          </P>
          <Table
            rows={[
              ['Streaks',
                'Live · resets',
                'How long a project has held a Top-10 / Top-50 / Top-100 spot in its category. 3-day grace period (a brief drop doesn\'t reset). Surfaces as a "47-day streak" badge.'],
              ['Milestones',
                'One-shot · permanent',
                'Crossing a threshold for the first time issues a permanent badge: first Top-100 · first Top-10 · first #1 · 100-day streak · 100-spot climb in 30 days · all-categories-Top-50.'],
            ]}
          />
          <P>
            Milestones can never un-happen. Streaks are a "how is the project
            doing right now?" signal; milestones are a "what has it
            accomplished?" trophy case.
          </P>
        </Section>

        <Section title="9 · Creator grade · career track" anchor="grade">
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

        <Section title="10 · Scout tier · activity track" anchor="scout">
          <P>
            Scout Tier measures how engaged you are as a critic — not the
            quality of your own projects. Tier comes from Activity Points
            earned by voting / applauding, <B>or</B> from your Forecast
            accuracy (OR condition). Every Forecast vote counts the same
            across all tiers — tier differentiation is carried by the monthly
            forecast quota and by early access to deeper analysis.
          </P>
          <P>
            <B>Forecasts only fire during quarterly events.</B> The always-on
            ladder uses Audit + Community only — no Scout pillar — so Scouts
            queue their forecasts for the next quarterly when it opens.
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

        <Section title="11 · Evidence integrity" anchor="integrity">
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

        <Section title="12 · Anti-abuse guardrails" anchor="abuse">
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

        <Section title="13 · About this score" anchor="about-this-score">
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
          These rules are binding for the active ladder and any in-flight
          event. Material changes are announced at least two weeks before
          they take effect and do not apply retroactively to projects already
          ranked or entered. Pricing and refund mechanics live on each
          project's audit page, not here.
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
