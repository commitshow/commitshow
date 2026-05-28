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

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { HeroUrlHook } from '../components/HeroUrlHook'

// Stable id assigned to the audit input so the mode toggle above can
// focus it after a switch (keyboard users + iOS keyboard popup feel).
const URL_INPUT_ID = 'check-audit-input'

type AuditMode = 'site' | 'repo'

// Mode-specific placeholder + helper. audit-site-preview already
// auto-detects + forwards github URLs to the anonymous walk-on path,
// so the toggle is a UX affordance for the user's mental model — the
// backend doesn't care which mode they picked. We still tailor the
// helper line so the user knows what each lane actually measures.
// Lead with the offer in cream (95%) so "Free · ~60 seconds" is the
// first thing the eye lands on after the form, then the lane-specific
// measure list trails in text-secondary (55%).
const FREE_LEAD = <span style={{ color: 'var(--cream)' }}>Free · ~60 seconds</span>

const MODE_COPY: Record<AuditMode, { placeholder: string; helper: React.ReactNode }> = {
  site: {
    placeholder: 'https://your-app.com',
    helper: <>{FREE_LEAD} · checks Lighthouse, security headers, broken routes, and live URL health.</>,
  },
  repo: {
    placeholder: 'github.com/owner/repo',
    helper: <>{FREE_LEAD} · reads README, tests, CI, license, observability signals, code health.</>,
  },
}

export function CheckPage() {
  const [mode, setMode] = useState<AuditMode>('site')

  // Switching mode keeps any pasted value as-is — backend auto-detects
  // regardless. Refocus the input so the user can immediately type a
  // new URL if they just switched lanes. setTimeout past the React
  // re-render so the input gets the new placeholder first.
  const switchMode = (next: AuditMode) => {
    if (next === mode) return
    setMode(next)
    setTimeout(() => {
      const input = document.getElementById(URL_INPUT_ID) as HTMLInputElement | null
      input?.focus()
    }, 0)
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

      {/* ── Mode toggle · Site URL ↔ GitHub repo.
          Segmented control sitting right above the audit input so the
          user picks their lane explicitly. Backend (audit-site-preview)
          auto-detects regardless of which segment is active — the
          toggle is a mental-model affordance and a placeholder/helper
          driver. Replaces the previous secondary CTA ("BUILT AN APP …
          PASTE THE GITHUB REPO ABOVE →") which user feedback 2026-05-28
          flagged as still implying a redirect. */}
      <section className="relative z-10 px-6 md:px-10 lg:px-16 mt-4">
        <div className="max-w-3xl mx-auto">
          <div
            role="tablist"
            aria-label="Audit input mode"
            className="inline-flex font-mono text-xs tracking-widest"
            style={{
              border: '1px solid rgba(240,192,64,0.25)',
              borderRadius: '2px',
              background: 'rgba(6,12,26,0.4)',
            }}
          >
            {(['site', 'repo'] as const).map((m) => {
              const active = mode === m
              const label = m === 'site' ? 'SITE URL' : 'GITHUB REPO'
              return (
                <button
                  key={m}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => switchMode(m)}
                  className="px-4 py-2 transition-all"
                  style={{
                    background: active ? 'var(--gold-500)' : 'transparent',
                    color: active ? 'var(--navy-900)' : 'var(--text-secondary)',
                    border: 'none',
                    cursor: active ? 'default' : 'pointer',
                    fontWeight: active ? 600 : 400,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--cream)'
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--text-secondary)'
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Audit entry · chromeless HeroUrlHook = form + state machine +
          result card from the landing page, with its own section bg/
          eyebrow/h2/sub copy suppressed. Sole audit surface on the LP.
          Placeholder + helper driven by the mode toggle above so the
          user's lane choice is reflected in the input + meta line.
          audit-site-preview auto-forwards github URLs to the anonymous
          walk-on path regardless, so no signup is required to see a
          result either way. */}
      <div className="mb-12">
        <HeroUrlHook
          chromeless
          inputId={URL_INPUT_ID}
          placeholder={MODE_COPY[mode].placeholder}
          helperText={MODE_COPY[mode].helper}
        />
      </div>

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
