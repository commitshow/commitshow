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
import { Link, useNavigate } from 'react-router-dom'
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

// Phase mirrored from HeroUrlHook so the sample mockup below the form
// hides during running/ready/error (where the real progress trail or
// result card takes over the visual weight) and shows in idle.
type HookPhase = 'idle' | 'running' | 'ready' | 'error'

export function CheckPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<AuditMode>('site')
  const [hookPhase, setHookPhase] = useState<HookPhase>('idle')

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

      {/* ── Audit entry · chromeless HeroUrlHook = form + state machine +
          result card from the landing page, with its own section bg/
          eyebrow/h2/sub copy suppressed. Sole audit surface on the LP.
          The Site URL ↔ GitHub repo segmented toggle rides in the
          `prependBeforeForm` slot so it sits directly above the input
          AND disappears together with the form once analysis starts —
          previously the toggle dangled above the running progress list
          with no input attached. Backend (audit-site-preview) auto-
          detects + forwards github URLs to the anonymous walk-on path
          regardless of which segment is active; the toggle is a
          mental-model affordance and the placeholder/helper driver. */}
      <div className="mb-12">
        <HeroUrlHook
          chromeless
          inputId={URL_INPUT_ID}
          placeholder={MODE_COPY[mode].placeholder}
          helperText={MODE_COPY[mode].helper}
          // After signup from the ad-LP, drop the new member straight
          // onto the backstage view of the project they just audited.
          // /submit (the default destination) is wrong here — that's
          // the "I came to register a project" funnel, but ad-LP users
          // came in via "see what AI missed" and want to keep looking
          // at THEIR score, with the coach panel one tab away.
          onPostSignIn={(projectId) => {
            if (projectId) navigate(`/projects/${projectId}`)
            else           navigate('/me')
          }}
          onPhaseChange={setHookPhase}
          prependBeforeForm={
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
          }
        />
      </div>

      {/* ── Ad-LP visual hero · 2026-05-29 · custom-drawn radial gauge
          (RadialAuditVisual below). Replaces the previous attempts
          (static SampleReportCard, then the LandingPage's HeroTerminal)
          — both read as "yet another UI box" per user feedback. This
          one is an actual illustration: 14 segments around the perimeter
          (~10 lit, ~4 muted, alluding to a Strong-band audit), brand
          mark in the center, no faked numbers. Single visual statement,
          ad-LP hero pattern. Hidden during analysis. */}
      {hookPhase === 'idle' && (
        <section className="relative z-10 px-6 md:px-10 lg:px-16 mt-2 mb-16">
          <div className="max-w-3xl mx-auto">
            <RadialAuditVisual />
          </div>
        </section>
      )}

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

/**
 * RadialAuditVisual — custom illustration for the ad-LP fold.
 *
 * Brief: a radial gauge that visualizes the engine's "14 production-
 * readiness frames" in one image. 14 wedge segments around the
 * perimeter — most lit gold (passing), a few muted (concerns to fix)
 * — with the runtime ("60s") sitting in the center as the brand
 * promise. Four axis labels (Lighthouse · Routes · Security · Tests)
 * float outside the ring as concrete-but-illustrative anchors so a
 * visitor reads it as "this thing measures real engineering signals"
 * rather than an abstract dial.
 *
 * Why this and not a reused component:
 *   · earlier mockup boxes and the cycling HeroTerminal both read as
 *     "yet another UI surface" — user wanted a real illustration
 *   · inline SVG keeps the brand tokens (navy + gold + cream),
 *     scales responsively, no extra HTTP request
 *   · no faked sample numbers, so it never reads as a partial audit
 */
function RadialAuditVisual() {
  const cx = 400
  const cy = 360
  const outerR = 230
  const innerR = 178
  const segmentCount = 14
  // Pattern: 10 lit, 4 muted. Indices mixed (not contiguous) so it reads
  // as "audit result" rather than "progress bar 70%".
  const litSet = new Set([0, 1, 2, 4, 5, 7, 8, 9, 11, 12])

  // Half-angle gap between adjacent wedges (radians) — small visual
  // breather between segments without losing the ring read.
  const gap = 0.022

  const segments = Array.from({ length: segmentCount }, (_, i) => {
    const step = (Math.PI * 2) / segmentCount
    const start = -Math.PI / 2 + i * step + gap
    const end   = -Math.PI / 2 + (i + 1) * step - gap
    const x1 = cx + Math.cos(start) * outerR
    const y1 = cy + Math.sin(start) * outerR
    const x2 = cx + Math.cos(end)   * outerR
    const y2 = cy + Math.sin(end)   * outerR
    const x3 = cx + Math.cos(end)   * innerR
    const y3 = cy + Math.sin(end)   * innerR
    const x4 = cx + Math.cos(start) * innerR
    const y4 = cy + Math.sin(start) * innerR
    const d = `M ${x1} ${y1} A ${outerR} ${outerR} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 0 0 ${x4} ${y4} Z`
    return { d, lit: litSet.has(i) }
  })

  // Axis labels float just outside the ring at cardinal-ish angles.
  // Copy rewritten 2026-05-29 from engineering jargon (LIGHTHOUSE / ROUTES
  // / SECURITY / TESTS · CI) to vibe-coder pain points — what they
  // actually forget to ship. Concrete enough that someone reads them
  // and thinks "oh yeah, my .env / og:image / mobile broke".
  const labelOffsetR = outerR + 38
  const labels: Array<{ text: string; angleDeg: number; anchor: 'start' | 'middle' | 'end' }> = [
    { text: 'MOBILE SPEED',  angleDeg: -90, anchor: 'middle' },
    { text: 'BROKEN LINKS',  angleDeg:   0, anchor: 'start'  },
    { text: 'SOCIAL CARDS',  angleDeg:  90, anchor: 'middle' },
    { text: 'SECRET LEAKS',  angleDeg: 180, anchor: 'end'    },
  ]

  return (
    <svg
      viewBox="0 0 800 780"
      width="100%"
      role="img"
      aria-label="Radial gauge illustration: 14 production-readiness frames audited"
      style={{ display: 'block', maxWidth: 640, margin: '0 auto' }}
    >
      {/* outer guide ring · whisper-faint */}
      <circle cx={cx} cy={cy} r={outerR + 22} fill="none" stroke="rgba(240,192,64,0.06)" strokeWidth={1} />

      {/* 14 wedge segments */}
      {segments.map((s, i) => (
        <path
          key={i}
          d={s.d}
          fill={s.lit ? 'var(--gold-500)' : 'rgba(248,245,238,0.10)'}
          opacity={s.lit ? 0.92 : 1}
        />
      ))}

      {/* inner subtle disc · pulls the center text out of the wedge ring */}
      <circle cx={cx} cy={cy} r={innerR - 12} fill="rgba(6,12,26,0.6)" stroke="rgba(240,192,64,0.10)" strokeWidth={1} />

      {/* center label · runtime promise. "60s" big in Playfair · "ANALYZE
          & COACH" small under it in DM Mono · short and abstract enough
          that it doesn't read as a fake sample score. (2026-05-30 ·
          mascot + speech bubble reverted per CEO; text center restored.) */}
      <text
        x={cx} y={cy + 6} textAnchor="middle"
        fontFamily="Playfair Display, Georgia, serif"
        fontWeight={900}
        fontSize={108}
        fill="var(--cream)"
        letterSpacing="-2"
      >
        60s
      </text>
      <text
        x={cx} y={cy + 44} textAnchor="middle"
        fontFamily="DM Mono, monospace"
        fontSize={12}
        fill="var(--gold-500)"
        letterSpacing="4"
      >
        ANALYZE &amp; COACH
      </text>

      {/* axis labels around the ring */}
      {labels.map(({ text, angleDeg, anchor }, i) => {
        const angle = (angleDeg * Math.PI) / 180
        const x = cx + Math.cos(angle) * labelOffsetR
        const y = cy + Math.sin(angle) * labelOffsetR
        return (
          <text
            key={i}
            x={x} y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontFamily="DM Mono, monospace"
            fontSize={11}
            fill="rgba(248,245,238,0.42)"
            letterSpacing="3"
          >
            {text}
          </text>
        )
      })}

      {/* bottom caption · ties the abstract gauge back to plain language.
          Pushed further down (y=735) per design feedback so it breathes
          away from the axis labels and reads as a separate beat. */}
      <text
        x={cx} y={735} textAnchor="middle"
        fontFamily="DM Mono, monospace"
        fontSize={11}
        fill="rgba(248,245,238,0.55)"
        letterSpacing="3"
      >
        14 PRODUCTION-READINESS FRAMES · PROBED IN ONE PASS
      </text>
    </svg>
  )
}

