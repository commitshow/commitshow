// CheckPage · /check ad-traffic landing page (2026-05-28).
//
// Built for paid acquisition ("바이브 코더라면 세상에 내놓기 전에 검증해봐").
// Single-fold, chrome-less, one CTA: paste URL → 60s audit → result.
// Nav + sidebar are short-circuited on this path (Nav.tsx + App.tsx)
// so the audit input owns the user's first 2 seconds with no competing
// surfaces.
//
// Architecture choice: reuse <HeroUrlHook chromeless /> for the entire
// audit state machine + result card. The marketing hero (headline +
// sub-copy + CTA framing) lives here; the actual form/probe/result UI
// is one component shared with the landing page so there's one
// audit-site-preview integration to maintain.
//
// Repo audit is offered as a secondary path (Link to /submit) rather than
// a second equal-weight input on the LP — decision fatigue would tank
// conversion. Ad audience is overwhelmingly "MVP deployed, repo public
// status unknown"; URL paste is the universal entry.

import { Link } from 'react-router-dom'
import { HeroUrlHook } from '../components/HeroUrlHook'

// Stable id assigned to the audit input so the "got a repo?" CTA below
// can focus + scroll to it without a router redirect to /submit (which
// gates on signup). audit-site-preview auto-forwards github URLs to the
// anonymous walk-on path, so a single input handles both lanes.
const URL_INPUT_ID = 'check-audit-input'

export function CheckPage() {
  // Focus + smoothly scroll to the audit input. Used by the secondary
  // CTA which previously sent users to /submit (auth-gated · breaks
  // the "free first, login later" flow the ad LP promises).
  const focusAuditInput = () => {
    const input = document.getElementById(URL_INPUT_ID)
    if (!input) return
    input.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Defer focus past the scroll so iOS doesn't pop the keyboard
    // mid-scroll and leave the page jumping.
    setTimeout(() => (input as HTMLInputElement).focus(), 320)
  }
  return (
    <main
      className="relative min-h-screen flex flex-col"
      style={{ background: 'var(--navy-950)', color: 'var(--cream)' }}
    >
      {/* ── Minimal logo strip · the only chrome on the page.
          No Nav, no sidebar, no menu — the page exists to convert
          ad traffic into a single audit run. Logo links home so a
          curious visitor can still escape to the full site. */}
      <header className="px-6 md:px-10 lg:px-16 pt-6">
        <Link to="/" className="inline-flex items-center" style={{ textDecoration: 'none' }}>
          <span className="font-display font-bold text-xl tracking-tight" style={{ color: 'var(--cream)' }}>
            Commit<span style={{ color: 'var(--gold-500)' }}>.Show</span>
          </span>
        </Link>
      </header>

      {/* ── Marketing hero · ad-aligned copy.
          Headline mirrors the ad creative so post-click feels like the
          same conversation. Sub copy is two short beats matching the
          errors-first thesis on the main site (Hero.tsx:155-161) without
          duplicating it verbatim. */}
      <section className="relative z-10 px-6 md:px-10 lg:px-16 pt-14 md:pt-20 pb-4">
        <div className="max-w-3xl mx-auto">
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>
            // FREE · 60 SEC · NO SIGNUP
          </div>
          <h1
            className="font-display font-black leading-none mb-6"
            style={{ fontSize: 'clamp(2.25rem, 5.5vw, 4rem)', color: 'var(--cream)' }}
          >
            Before you ship it,<br />
            <span className="gold-shimmer">see what AI missed</span>
          </h1>
          <p
            className="font-display mb-3"
            style={{ color: 'var(--cream)', fontSize: '1.35rem', lineHeight: 1.4, fontWeight: 600 }}
          >
            AI ships fast. AI also misses things.
          </p>
          <p
            className="font-light max-w-xl mb-2"
            style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.6 }}
          >
            We catch what your prompts forgot — Lighthouse, security headers, broken routes,
            production-readiness signals across 14 frames. Paste your URL.
          </p>
        </div>
      </section>

      {/* ── Audit entry · chromeless HeroUrlHook = form + state machine +
          result card from the landing page, with its own section bg/
          eyebrow/h2/sub copy suppressed. Sole audit surface on the LP.
          Placeholder + helper expanded to advertise that the same box
          accepts a GitHub repo URL — audit-site-preview auto-forwards
          to the anonymous walk-on path. No signup required to see a
          result either way. */}
      <HeroUrlHook
        chromeless
        inputId={URL_INPUT_ID}
        placeholder="https://your-app.com  ·  or  github.com/owner/repo"
        helperText={<>Free · ~60 seconds · paste a site URL <em style={{ color: 'var(--gold-500)', fontStyle: 'normal' }}>or a GitHub repo</em> · we auto-detect.</>}
      />

      {/* ── Secondary path · repo audit · 2026-05-28 redesigned.
          PREVIOUSLY: <Link to="/submit"> · which gated the repo lane on
          signup and broke the LP promise ("run a basic audit first,
          then login"). User feedback 2026-05-28 confirmed.
          NOW: a button that focuses the URL input above. Since audit-
          site-preview auto-detects + forwards github URLs to the
          anonymous walk-on path, the same input handles both lanes
          without a redirect. Signup CTA lives on the result card,
          AFTER trust is built by a real score landing. */}
      <section className="relative z-10 px-6 md:px-10 lg:px-16 mt-6 mb-12">
        <div className="max-w-3xl mx-auto">
          <button
            type="button"
            onClick={focusAuditInput}
            className="inline-flex items-center gap-2 font-mono text-xs tracking-widest transition-colors"
            style={{
              color: 'var(--gold-500)',
              textDecoration: 'none',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--gold-400)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--gold-500)')}
          >
            BUILT AN APP, LIBRARY, OR CLI? PASTE THE GITHUB REPO ABOVE →
          </button>
        </div>
      </section>

      {/* ── Minimal trust strip · footer-equivalent.
          One line · brand attribution · legal links. Anything more
          would invite users away from the audit CTA. */}
      <footer
        className="relative z-10 mt-auto px-6 md:px-10 lg:px-16 py-8 font-mono text-xs"
        style={{ color: 'var(--text-faint)', borderTop: '1px solid rgba(240,192,64,0.06)' }}
      >
        <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          <span>commit.show · audit engine for vibe-coded MVPs</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <Link to="/privacy" style={{ color: 'inherit', textDecoration: 'none' }}>Privacy</Link>
          <Link to="/terms" style={{ color: 'inherit', textDecoration: 'none' }}>Terms</Link>
          <Link to="/rulebook" style={{ color: 'inherit', textDecoration: 'none' }}>How scoring works</Link>
        </div>
      </footer>
    </main>
  )
}
