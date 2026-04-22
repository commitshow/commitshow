// Public judging rulebook. commit.show's core value proposition is neutral,
// transparent scoring; publishing these rules is both marketing AND legal
// evidence (CLAUDE.md §2 core principle, §17 legal notes).

export function RulebookPage() {
  return (
    <section className="relative z-10 pt-20 pb-20 px-6 min-h-screen">
      <div className="max-w-3xl mx-auto">
        <header className="mb-10">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // RULEBOOK · v0.5
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
            revelation phases, which determine what a public viewer can see at any
            moment.
          </P>
          <Table
            rows={[
              ['Week 1 · Days 1-7',   'Blind stage',          'Scores hidden to the public. Creators iterate without pressure.'],
              ['Week 2 · Days 8-14',  'Percentile reveal',    'Projects surface as relative bands ("top X%"). First rounds of Scout feedback.'],
              ['Week 3 · Days 15-21', 'Scores go live',       'Concrete numbers visible with a 6-hour snapshot delay. Forecasting intensifies.'],
              ['Days 22-28',          'Applaud Week',         'Scouts recognize specific craft axes. 30-second usage verification required to applaud.'],
              ['Day 29',              'Graduation Day',       'Results confirmed. Refunds, badges, NFTs dispatched. Alumni briefs open.'],
            ]}
          />
        </Section>

        <Section title="2 · The score · 100 points" anchor="score">
          <P>
            A project's total score is the sum of three components, each with its
            own cap and its own method of collection.
          </P>
          <Table
            rows={[
              ['50 pts', 'Automated Evaluation', 'Source structure · live performance audit · brief integrity · live URL health · tech-layer diversity. Algorithmic. Uncheatable.'],
              ['30 pts', 'Scout Forecast',        'Weighted predictions from verified Scouts. Platinum ×3.0 · Gold ×2.0 · Silver ×1.5 · Bronze ×1.0.'],
              ['20 pts', 'Community Signal',      'Views · comment depth · shares · return visits. Quality-weighted, not raw counts.'],
            ]}
          />
          <P>
            The automated 50-point half breaks down as follows.
          </P>
          <Table
            rows={[
              ['up to 30 pts', 'Live performance audit', 'Mobile-strategy audit on the submitted live URL. Performance · accessibility · best practices · SEO.'],
              ['+5',           'Source repository public',  'Repo has to be publicly accessible — Scouts and the community must be able to inspect.'],
              ['up to +5',     'Tech-layer diversity',      'Distinct layers detected — frontend / backend / DB / infra / AI / Web3.'],
              ['+3',           'Build Brief integrity',     'Phase 2 brief structurally complete: stack fingerprint · failure log · decisions · delegation map.'],
              ['+5',           'Live URL health check',     'URL responds within 3 seconds, returns 2xx, renders real content.'],
            ]}
          />
        </Section>

        <Section title="3 · Graduation bar" anchor="graduation">
          <P>
            A project <B>graduates</B> when it clears <B>every</B> bar below at
            the end of the season. Missing any one bar means the project did not
            graduate — no partial credit.
          </P>
          <ul className="pl-0 space-y-2 mb-4">
            <Bullet>Total score <B>≥ 75</B> at season end.</Bullet>
            <Bullet>Automated score <B>≥ 35 / 50</B> (you can't graduate on hype alone).</Bullet>
            <Bullet>At least <B>3 Scout forecasts</B> cast during the season.</Bullet>
            <Bullet>Score maintained <B>≥ 75 for 2 consecutive weeks</B> (not a last-minute spike).</Bullet>
            <Bullet>Live URL <B>health check passes</B> at graduation.</Bullet>
          </ul>
          <Table
            rows={[
              ['Valedictorian', '≈0.5% · 1 per season',  '100% entry fee refund + $500 bonus · Hall of Fame · media exposure · special NFT.'],
              ['Honors',        'Top 5% (excl. Valedictorian)', '85% refund · Hall of Fame · certification badge · featured.'],
              ['Graduate',      'Top 20% (excl. Honors)', '70% refund · graduation badge · full Build Brief publicly revealed.'],
              ['Retry',         'Bottom 80%',            'No refund · AI analysis report private option · can reapply next season.'],
            ]}
          />
        </Section>

        <Section title="4 · Creator Grade · career track" anchor="grade">
          <P>
            Creator Grade is your cumulative career tier. It only advances through
            graduated projects — a single great project doesn't change it.
          </P>
          <Table
            rows={[
              ['Rookie',        '0 graduated',                                              'Every member starts here.'],
              ['Builder',       '1 graduated · avg ≥ 60',                                   'You can ship one project cleanly through 3 weeks.'],
              ['Maker',         '2 graduated · avg ≥ 70',                                   'Consistency shows.'],
              ['Architect',     '3 graduated · avg ≥ 75 · tech diversity',                  'Range across infra / AI / frontend / Web3.'],
              ['Vibe Engineer', '5 graduated · avg ≥ 80 · 20+ applauds received',           'Craft quality recognized by the community.'],
              ['Legend',        '10+ graduated · community influence',                      'Permanent Hall of Fame resident.'],
            ]}
          />
        </Section>

        <Section title="5 · Scout Tier · activity track" anchor="scout">
          <P>
            Scout Tier measures how engaged you are as a critic — not the quality
            of your own projects. Tier comes from Activity Points earned by voting
            and applauding, <B>or</B> from your Forecast accuracy (OR condition).
            Every Forecast Vote counts the same across all tiers — tier differentiation
            is carried by the monthly Voteg quota and by early access to deeper analysis.
          </P>
          <Table
            rows={[
              ['Bronze',   '0 — 499 AP',            '20 forecasts / month'],
              ['Silver',   '500 — 1,999 AP  OR 30+ accurate forecasts',  '40 forecasts / month · security analysis 12h early'],
              ['Gold',     '2,000 — 4,999 AP  OR 120+ accurate forecasts','60 forecasts / month · security analysis 24h early'],
              ['Platinum', 'Top 3% AP  OR Top 3% accurate forecasts',    '80 forecasts / month · full analysis early access · rulebook preview'],
            ]}
          />
          <P>
            Activity Points are credited in real time — <B>+10 AP</B> per Forecast,
            <B> +25 AP</B> per Applaud (Craft Award Week). Accurate forecasts and
            Craftsman Applauds earn bonus AP when the relevant project graduates.
            Craft Award Applaud keeps a tier multiplier (×1.0 / ×1.5 / ×2.0 / ×3.0)
            during Applaud Week only; regular Forecast votes are uniform weight 1.0.
          </P>
        </Section>

        <Section title="6 · Evidence integrity" anchor="integrity">
          <P>
            Four sources of evidence are weighed, ranked by trust (lowest to highest).
          </P>
          <ol className="pl-4 space-y-2 mb-4 list-decimal" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>
            <li>Phase 1 self-claims (problem · features · target user) — marketing copy. Treated skeptically.</li>
            <li>Phase 2 <B>pasted</B> extraction — may be tampered in transit. Cross-checked against ground truth.</li>
            <li>Phase 2 <B>committed</B> brief (inside the repo with Git history) — higher trust. Commit SHA and timestamp are referenced as immutability proof.</li>
            <li>Source-code implementation evidence (repo tree · commits · files) — ground truth. Cannot be faked.</li>
          </ol>
          <P>
            Every mismatch between Phase 2 claims and source-code reality is
            surfaced as a <B>tampering signal</B> with severity ratings. High-severity
            signals reduce the final score by 10–20 points each.
          </P>
        </Section>

        <Section title="7 · Anti-abuse guardrails" anchor="abuse">
          <Table
            rows={[
              ['Comment rate limit',      '≤ 50 / month per member'],
              ['Share rate limit',        '≤ 3 / day per member'],
              ['Vote cap per Scout',      'Enforced in-DB by tier'],
              ['Applaud on own project',  'Blocked · one-strike Scout credibility penalty'],
              ['Duplicate-IP Forecasts',  'Auto-flagged'],
              ['Cosine similarity ≥ 0.85', 'Triggers manual deeper review'],
              ['Overclaim (Phase 2 contradicts repo)', 'Relevant section scores 0'],
            ]}
          />
        </Section>

        <Section title="8 · Refunds & payments" anchor="payments">
          <P>
            The $99 application fee is a <B>competition entry fee</B>. It is
            conditionally refunded based on graduation tier at season end.
            Refunds are processed within 5 business days of Graduation Day.
          </P>
          <P>
            During the launch event (through 2026-07-18), members get their
            first 4 applications free — the application fee kicks in from the
            5th onward.
          </P>
        </Section>

        <div className="mt-12 pt-6 font-mono text-[11px]" style={{ borderTop: '1px solid rgba(240,192,64,0.15)', color: 'var(--text-muted)', lineHeight: 1.65 }}>
          These rules are binding for the current season. Material changes are
          announced at least two weeks before they take effect and do not apply
          retroactively to projects already in-season.
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
          className={`grid items-start gap-3 px-4 py-2.5 ${r.length === 3 ? 'grid-cols-[100px_150px_1fr] md:grid-cols-[110px_180px_1fr]' : 'grid-cols-[130px_1fr]'}`}
          style={{
            background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
            borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          }}
        >
          <div className="font-mono text-[10px] tracking-widest uppercase pt-0.5" style={{ color: 'var(--gold-500)' }}>
            {r[0]}
          </div>
          {r.length === 3 && (
            <div className="font-mono text-xs" style={{ color: 'var(--cream)' }}>{r[1]}</div>
          )}
          <div className="font-light text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {r.length === 3 ? r[2] : r[1]}
          </div>
        </div>
      ))}
    </div>
  )
}
