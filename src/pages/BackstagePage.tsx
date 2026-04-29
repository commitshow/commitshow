// Backstage — the brand for commit.show's prompt-extraction analysis (Phase 2
// of the Build Brief). Public marketing/onboarding page that explains why
// Backstage data is special: 4 of its 6 sections (failure_log, decision_
// archaeology, ai_delegation_map, next_blocker) are captured nowhere else
// in the industry. Positioned as an *earned status*, not a chore.
//
// Sister pages: /rulebook (judging logic) · /scouts (forecaster tier) ·
// future /failures (Failure Log gallery sourced from Backstage data).

import { Link } from 'react-router-dom'

export function BackstagePage() {
  return (
    <section className="relative z-10 pt-20 pb-20 px-4 md:px-6 min-h-screen">
      <div className="max-w-3xl mx-auto">
        <header className="mb-12">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // BACKSTAGE
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl mb-3" style={{ color: 'var(--cream)' }}>
            Document what no one else captures
          </h1>
          <p className="font-light text-base" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Backstage is the prompt-extraction layer of every commit.show audit.
            Stack scrapers tell the world <em>what</em> you built. Backstage records
            the parts that live only in your head and your AI chat — the failures, the
            decisions, the delegation, the next wall. This is the data the next
            generation of vibe coders will need, and it doesn&rsquo;t exist anywhere else.
          </p>
        </header>

        <Section title="What Backstage actually captures" anchor="capture">
          <P>
            Six structured sections, generated from your AI coding session and
            your repo. The first two are commodity. The last four are the moat.
          </P>
          <Table
            rows={[
              ['Stack',           'Commodity',  'Runtime · framework · DB · infra. Anything Wappalyzer can scrape from a deployed URL.'],
              ['Live Proof',      'Commodity',  'URLs · GitHub · contract addresses. Visible to anyone who finds your project.'],
              ['Failure Log',     'Backstage',  'Two moments your AI got it wrong 3+ times. Symptom → root cause → fix → prevention. Lives only in the chat.'],
              ['Decisions',       'Backstage',  'Two "A vs B" choices, with the actual reasoning. The codebase shows the winner; only this records why.'],
              ['Delegation Map',  'Backstage',  'How much of each area was AI vs you. The single sharpest skill signal in the AI era.'],
              ['Next Blocker',    'Backstage',  'The wall you&apos;re about to hit + the first thing you&apos;d ask AI for. Forward-looking, never derivable from code.'],
            ]}
          />
        </Section>

        <Section title="Why this data is the moat" anchor="moat">
          <P>
            Stack Overflow archives <B>answers</B>. GitHub archives <B>code</B>.
            Backstage archives <B>everything in between</B> — the trial and error,
            the rationale, the work allocation, the road ahead. None of those
            archives exist at scale.
          </P>
          <Table
            rows={[
              ['1,000 graduates × 2 failures × season', 'Aggregated failure dataset', '"Top 10 things Cursor got wrong this quarter" — material no AI tool vendor can refute and no competitor can replicate without our user base.'],
              ['Decisions become Stack Recipes',         'Library content engine',     'Every documented "A vs B" is a candidate Library card. Backstage feeds the catalog automatically.'],
              ['Delegation Map → hiring filter',          'LinkedIn-for-vibe-coders',   '"Architects who keep DB schema decisions in-house, delegate UI to AI." A real query, only answerable with our data.'],
              ['Next Blocker → matching',                 'Asks + Office Hours wiring', 'The blocker today is the Ask tomorrow. Backstage seeds the marketplace with real demand.'],
            ]}
          />
        </Section>

        <Section title="What earning Backstage looks like" anchor="how">
          <P>
            Auditing a project includes a one-step prompt extraction. You copy
            a block from <Link to="/submit" className="underline" style={{ color: 'var(--gold-500)' }}>
            commit.show/submit</Link> into your AI coding agent (Claude Code, Cursor,
            Windsurf — anywhere with chat history). The agent reads the chat, the repo,
            and writes the brief back as a single Markdown file you commit.
          </P>
          <ul className="pl-0 space-y-2 mb-4">
            <Bullet>Roughly 5 minutes once your project is in flight.</Bullet>
            <Bullet>The agent uses <B>your</B> session — nothing leaves your machine until you commit the file.</Bullet>
            <Bullet>You can edit the brief before committing. Honest beats polished.</Bullet>
            <Bullet>Once committed, commit.show reads it from your public repo on the next audit.</Bullet>
          </ul>
          <P>
            Walk-ons (CLI users) get a code-only audit. Backstage opens once you
            run a full audit through commit.show/submit. The friction is the
            filter — it&rsquo;s why the data is worth anything.
          </P>
        </Section>

        <Section title="What you get back" anchor="rewards">
          <Table
            rows={[
              ['+15 pts',   'Audit score',         'Brief integrity bonus inside the 50-point automated half. Materially shifts your tier projection.'],
              ['Verified',  'Public badge',        'A "Backstage Verified" mark on your project card. Signals that the data behind the score is real, not inferred.'],
              ['Indexed',   'Failure Gallery',     'Your failure entries (anonymous by default · opt-in for credit) appear in the public failure gallery. Compounds your discoverability.'],
              ['Counter',   'Profile signal',     '"12 failure patterns documented" surfaces on your profile. A new kind of skill credential.'],
              ['Recipe',    'Library candidate',   'Your decision entries get auto-suggested as Library Stack cards. Documented decisions → published artifacts.'],
            ]}
          />
        </Section>

        <Section title="The promise" anchor="promise">
          <P>
            You did the work. The chat history will get compacted, the repo will
            get rewritten, the AI you used today will be deprecated. Backstage is
            the receipt. It says: this person, on this project, in this season,
            recovered from <em>this</em> failure, picked <em>this</em> over <em>that</em>,
            kept <em>this</em> in human hands.
          </P>
          <P>
            That receipt is what we put on stage.
          </P>
        </Section>

        <div className="mt-12 pt-8" style={{ borderTop: '1px solid rgba(240,192,64,0.15)' }}>
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div>
              <div className="font-display font-bold text-lg mb-1" style={{ color: 'var(--cream)' }}>
                Ready to put it on the record?
              </div>
              <div className="font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
                A full audit opens Backstage. Five minutes of honest writing earns it.
              </div>
            </div>
            <Link
              to="/submit"
              className="px-6 py-3 text-sm font-medium tracking-wide transition-all whitespace-nowrap"
              style={{
                background: 'var(--gold-500)',
                color: 'var(--navy-900)',
                borderRadius: '2px',
                fontFamily: 'DM Mono, monospace',
                textDecoration: 'none',
              }}
            >
              Audit your product →
            </Link>
          </div>
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
