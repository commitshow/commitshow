// Terms of Service · public page.
//
// V1 minimum-viable draft (CLAUDE.md §17 flags external counsel review
// before launch). The structure here mirrors what most US-launch SaaS
// platforms publish: eligibility, accounts, user content, conduct, audit-
// engine disclaimer, fees, IP, termination, disclaimers, liability cap,
// governing law, changes, contact.
//
// LEGAL DISCLAIMER (in-code only · NOT user-facing): this draft is not a
// substitute for counsel review. Before paid auditions go live (V1 §16.2
// P7), an attorney has to sign off on the indemnity, liability cap,
// governing-law clause, and recoup mechanics.

import { useNavigate } from 'react-router-dom'

export function TermsPage() {
  const navigate = useNavigate()
  const lastUpdated = 'May 2, 2026'

  return (
    <section className="relative z-10 pt-20 pb-20 px-4 md:px-6 min-h-screen">
      <div className="max-w-3xl mx-auto">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          className="mb-5 font-mono text-xs tracking-wide"
          style={{ background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer', padding: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
        >
          ← BACK
        </button>

        <header className="mb-10">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // TERMS OF SERVICE
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl mb-3" style={{ color: 'var(--cream)' }}>
            Terms of Service
          </h1>
          <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
            Last updated: {lastUpdated}
          </p>
        </header>

        <Section title="1 · Welcome" anchor="welcome">
          <P>
            commit.show is operated by <B>Madeflo Inc.</B>, a Delaware
            corporation ("Madeflo", "commit.show", "we", "us", or "our"),
            and provides a public league for AI-assisted ("vibe-coded")
            software projects, where members can submit projects, receive
            automated audit reports, and participate in seasonal
            evaluations. By accessing or using commit.show (the "Service"),
            you agree to these Terms of Service (the "Terms").
          </P>
          <P>
            If you do not agree to these Terms, do not use the Service.
          </P>
        </Section>

        <Section title="2 · Eligibility" anchor="eligibility">
          <P>
            You must be at least <B>13 years old</B> to use the Service. If you
            are under 18, you represent that a parent or legal guardian has
            reviewed and accepts these Terms on your behalf.
          </P>
          <P>
            You may not use the Service if you are barred from doing so under
            the laws of the country in which you reside, or if you are on a
            US sanctions list.
          </P>
        </Section>

        <Section title="3 · Your account" anchor="account">
          <P>
            You may sign in via email, Google, GitHub, X (Twitter), or
            LinkedIn. You are responsible for keeping your credentials secure
            and for all activity under your account. Notify us immediately at{' '}
            <Email /> if you suspect unauthorized access.
          </P>
          <P>
            You must provide accurate registration information and keep it
            current. We may suspend or terminate accounts that we reasonably
            believe to contain false, misleading, or impersonated information.
          </P>
        </Section>

        <Section title="4 · Your content" anchor="content">
          <P>
            "Your Content" includes the project URLs, GitHub repositories,
            screenshots, descriptions, briefs, comments, and any other
            material you submit. <B>You retain ownership</B> of Your Content.
          </P>
          <P>
            By submitting content, you grant commit.show a worldwide,
            non-exclusive, royalty-free license to host, store, reproduce,
            display, and create derivative works (such as audit summaries,
            score cards, and league rankings) solely to operate, promote, and
            improve the Service. You can revoke this license by deleting the
            relevant content from your account.
          </P>
          <P>
            You represent that you have the right to submit Your Content and
            that doing so does not violate the rights of any third party.
          </P>
        </Section>

        <Section title="5 · Audit reports · provided as-is" anchor="audit">
          <P>
            commit.show audit reports are produced by automated tools
            (including third-party language models, GitHub APIs, and
            Lighthouse), combined with optional human Scout forecasts. Reports
            are <B>snapshots, not verdicts</B>. They reflect the data
            available at the time of evaluation and may change as your code,
            traffic, or third-party signals change.
          </P>
          <P>
            Audit reports are NOT professional security assessments, code
            audits, or legal compliance reviews. Do not rely on a commit.show
            audit as the sole basis for a security, compliance, or
            commercial decision.
          </P>
        </Section>

        <Section title="6 · Acceptable conduct" anchor="conduct">
          <P>You agree not to:</P>
          <ul className="space-y-2 ml-2">
            <Bullet>Submit content you do not have the right to use.</Bullet>
            <Bullet>
              Manipulate audits, votes, applauds, or rankings — including
              creating fake accounts, IP rotation, or coordinated inauthentic
              activity.
            </Bullet>
            <Bullet>
              Scrape, mirror, or republish substantial portions of the Service
              without prior written consent.
            </Bullet>
            <Bullet>
              Probe, scan, or attempt to breach the Service's security.
            </Bullet>
            <Bullet>
              Use the Service to distribute malware, phishing attempts, hate
              speech, harassment, or content that infringes others' rights.
            </Bullet>
            <Bullet>
              Reverse-engineer the audit engine to game scoring outcomes.
            </Bullet>
          </ul>
          <P>
            We may remove content, suspend accounts, or terminate access for
            violations, with or without notice.
          </P>
        </Section>

        <Section title="7 · Fees and recoup" anchor="fees">
          <P>
            We may, from time to time, offer a free-audition allowance that
            lets each member submit a limited number of auditions at no
            charge before the audition fee applies. The size of the
            allowance, the conditions under which it applies, and the
            duration for which it is offered are determined by us and may
            be adjusted, paused, or withdrawn at any time. The allowance
            in effect for any given audition is the one shown at the
            point of submission.
          </P>
          <P>
            Auditions outside any active free allowance carry a one-time
            audition fee. The fee has two internally-tracked components: a
            non-recoupable audit & operations cost, and an Encore credit
            recoupable on Diploma. The Encore credit is platform credit
            applied within the audition lifecycle — it is not a refundable
            deposit and carries no claim to interest, dividends, or payout
            from any pool. The credit becomes recoupable only when the
            audited product earns a Diploma in a future League cohort,
            subject to the rules and timing in effect at that time.
          </P>
          <P>
            From time to time we may run a Founder pricing window in which
            the audition fee is reduced for a fixed number of paying
            auditions across the platform. Once that count is reached the
            fee returns to its standard amount. The exact fee charged at
            checkout is the authoritative price for that purchase.
          </P>
          <P>
            All fees are stated in US dollars unless noted otherwise. Payment
            is processed by third-party providers (currently Stripe). Their
            terms also apply. We do not guarantee future Diploma eligibility,
            League cohort timing, or that any Encore credit will become
            recoupable within a specific timeframe.
          </P>
        </Section>

        <Section title="8 · Our intellectual property" anchor="ip">
          <P>
            The commit.show name, logo, audit-engine framework, ladder
            algorithm, scoring rubrics, and all original site content (other
            than User Content) are owned by Madeflo Inc. and protected by
            intellectual property laws. You may not use our marks without
            prior written consent.
          </P>
        </Section>

        <Section title="9 · Termination" anchor="termination">
          <P>
            You may close your account at any time from your profile page.
            We may suspend or terminate your access if you violate these
            Terms, if we are required to by law, or if continuing the Service
            to you becomes commercially impracticable. On termination, the
            sections of these Terms that by their nature should survive
            (ownership, disclaimers, liability, governing law) will survive.
          </P>
        </Section>

        <Section title="10 · Disclaimers" anchor="disclaimers">
          <P>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT
            WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING
            WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
            PARTICULAR PURPOSE, NON-INFRINGEMENT, OR ACCURACY OF AUDIT
            RESULTS. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED
            OR ERROR-FREE.
          </P>
        </Section>

        <Section title="11 · Limitation of liability" anchor="liability">
          <P>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, MADEFLO INC. WILL NOT BE
            LIABLE FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, OR
            PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUES, DATA, OR
            BUSINESS OPPORTUNITIES, ARISING OUT OF OR RELATED TO THE SERVICE.
          </P>
          <P>
            OUR AGGREGATE LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE
            WILL NOT EXCEED THE GREATER OF (A) THE FEES YOU PAID US IN THE
            SIX MONTHS BEFORE THE EVENT GIVING RISE TO LIABILITY OR (B) ONE
            HUNDRED US DOLLARS (US$100).
          </P>
        </Section>

        <Section title="12 · Governing law" anchor="law">
          <P>
            These Terms are governed by the laws of the State of Delaware,
            United States, without regard to its conflict-of-laws rules. Any
            dispute will be resolved in the state or federal courts located
            in Delaware, and you consent to exclusive jurisdiction and venue
            there. The United Nations Convention on Contracts for the
            International Sale of Goods does not apply.
          </P>
        </Section>

        <Section title="13 · Changes to these Terms" anchor="changes">
          <P>
            We may update these Terms from time to time. Material changes
            will be communicated via the Service or by email at least 14 days
            before they take effect. Continued use of the Service after the
            effective date constitutes acceptance of the updated Terms.
          </P>
        </Section>

        <Section title="14 · Contact" anchor="contact">
          <P>
            For questions about these Terms, write to us at <Email />.
          </P>
        </Section>
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

function Email() {
  return (
    <a href="mailto:hello@commit.show" style={{ color: 'var(--gold-500)' }}>
      hello@commit.show
    </a>
  )
}
