// /pitch · investor-facing one-pager.
//
// Audience: North-American seed/Series-A VCs evaluating commit.show.
// Format: long-scroll deck (12 sections). Each section is a "slide"
// height-bounded enough to read at a glance but flowing for sharing
// via URL. No animations, no dependence on auth — the whole page must
// render for someone clicking a link in their inbox.
//
// Design lock (CLAUDE.md §4 · §19): navy + gold tokens, Playfair
// Display + DM Sans + DM Mono, no emojis in headers or stats, no
// trailing periods on h-tags. "Audit / Audition / Audited" verb
// system held throughout. "AI" is fine here when describing the
// market category (audience expects that vocabulary) but never as
// a name for our service — we are an Audit engine.
//
// Numbers: live counts pulled from Supabase (no auth gating · public
// columns only). Falls back to '—' if RLS / network blocks the read,
// so the page never looks broken in the worst case.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { usePretendardFont } from '../lib/pretendardFont'

const NAVY_950   = '#060C1A'
const NAVY_800   = '#0F2040'
const GOLD       = '#F0C040'
const CREAM      = '#F8F5EE'
const SCARLET    = '#C8102E'
const PURPLE     = '#A78BFA'
const TEAL       = '#00D4AA'
const BLUE       = '#60A5FA'

// ──────────────────────────────────────────────────────────────────────
// Live stat hook
// ──────────────────────────────────────────────────────────────────────

interface PitchStats {
  projects:    number | null
  audits:      number | null
  members:     number | null
  audits_7d:   number | null
  cli_7d:      number | null
}

function usePitchStats(): PitchStats {
  const [s, setS] = useState<PitchStats>({
    projects: null, audits: null, members: null, audits_7d: null, cli_7d: null,
  })
  useEffect(() => {
    let alive = true
    ;(async () => {
      const sevenAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
      const [p, a, m, a7, c7] = await Promise.all([
        supabase.from('projects').select('id', { count: 'exact', head: true }),
        supabase.from('analysis_snapshots').select('id', { count: 'exact', head: true }),
        supabase.from('members').select('id', { count: 'exact', head: true }),
        supabase.from('analysis_snapshots').select('id', { count: 'exact', head: true }).gt('created_at', sevenAgo),
        supabase.from('cli_audit_calls').select('id', { count: 'exact', head: true }).gt('created_at', sevenAgo),
      ])
      if (!alive) return
      setS({
        projects:  p.count  ?? null,
        audits:    a.count  ?? null,
        members:   m.count  ?? null,
        audits_7d: a7.count ?? null,
        cli_7d:    c7.count ?? null,
      })
    })().catch(() => { /* silent · render '—' */ })
    return () => { alive = false }
  }, [])
  return s
}

// ──────────────────────────────────────────────────────────────────────
// Reusable bits
// ──────────────────────────────────────────────────────────────────────

function SectionEyebrow({ n, label, accent = GOLD }: { n: string; label: string; accent?: string }) {
  return (
    <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-3" style={{ color: accent }}>
      {n} · {label}
    </div>
  )
}

function SectionH({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display font-black mb-5"
        style={{ color: 'var(--cream)', fontSize: 'clamp(2rem, 4.4vw, 3.4rem)', lineHeight: 1.05, letterSpacing: '-0.5px' }}>
      {children}
    </h2>
  )
}

function SectionLead({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-light mb-8" style={{ color: 'var(--text-primary)', fontSize: 'clamp(1.05rem, 1.6vw, 1.3rem)', lineHeight: 1.5, maxWidth: 880 }}>
      {children}
    </p>
  )
}

function PillarCard({ tone, title, weight, children }: { tone: string; title: string; weight: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-5"
         style={{ background: `${tone}10`, border: `1px solid ${tone}40`, borderRadius: '2px' }}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-display font-bold text-lg" style={{ color: 'var(--cream)' }}>{title}</div>
        <div className="font-mono tabular-nums text-xl" style={{ color: tone }}>{weight}</div>
      </div>
      <div className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        {children}
      </div>
    </div>
  )
}

function StatCell({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="px-3 py-3"
         style={{ background: 'rgba(15,32,64,0.45)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px' }}>
      <div className="font-mono text-[9px] tracking-[0.2em] uppercase mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="font-display font-bold tabular-nums" style={{ color: 'var(--cream)', fontSize: 28, lineHeight: 1.05 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {hint && <div className="font-mono text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>{hint}</div>}
    </div>
  )
}

function BulletList({ items, accent = GOLD }: { items: Array<string | { strong: string; rest: string }>; accent?: string }) {
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3" style={{ color: 'var(--text-primary)' }}>
          <span className="font-mono text-sm mt-0.5 flex-shrink-0" style={{ color: accent }}>—</span>
          <span className="font-light" style={{ fontSize: '1rem', lineHeight: 1.55 }}>
            {typeof it === 'string'
              ? it
              : <><strong style={{ color: 'var(--cream)', fontWeight: 600 }}>{it.strong}</strong> {it.rest}</>}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────

export function PitchPage() {
  usePretendardFont()
  const stats = usePitchStats()
  const fmt = (n: number | null) => n == null ? '—' : n.toLocaleString()

  return (
    <main className="pitch-deck-root relative z-10 min-h-screen pb-20">
      {/* ─── Hero ─── */}
      <section className="px-4 md:px-8 lg:px-16 pt-24 pb-20 max-w-6xl mx-auto">
        <SectionEyebrow n="00" label="Investor Brief · Pre-Seed" accent={GOLD} />
        <h1 className="font-display font-black mb-5"
            style={{ color: 'var(--cream)', fontSize: 'clamp(2.6rem, 6vw, 5rem)', lineHeight: 1.0, letterSpacing: '-1.5px' }}>
          Every commit,<br/>
          <span style={{ color: GOLD }}>on stage</span>
        </h1>
        <p className="font-light mb-8" style={{ color: 'var(--text-primary)', fontSize: 'clamp(1.15rem, 2vw, 1.5rem)', lineHeight: 1.45, maxWidth: 880 }}>
          AI ships fast. AI also misses things. <span style={{ color: 'var(--cream)' }}>commit.show</span> is the audit layer for the vibe-coding generation — repeatable evidence of craft for the 30M+ builders shipping with Cursor, Claude Code, and Lovable.
        </p>
        <div className="flex flex-wrap gap-3 mb-12">
          <Link to="/" className="inline-block px-5 py-2.5 font-mono text-[12px] tracking-widest uppercase"
                style={{ background: GOLD, color: NAVY_950, borderRadius: '2px' }}>
            See the product →
          </Link>
          <Link to="/rulebook" className="inline-block px-5 py-2.5 font-mono text-[12px] tracking-widest uppercase"
                style={{ border: '1px solid rgba(255,255,255,0.18)', color: 'var(--cream)', borderRadius: '2px' }}>
            Read the scoring rulebook
          </Link>
          <Link to="/pitch-k" className="inline-block px-5 py-2.5 font-mono text-[12px] tracking-widest uppercase"
                style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-muted)', borderRadius: '2px' }}>
            한국어 →
          </Link>
        </div>

        {/* Live traction strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <StatCell label="Projects audited" value={fmt(stats.projects)} hint="all-time" />
          <StatCell label="Audit reports"    value={fmt(stats.audits)}   hint="snapshots" />
          <StatCell label="Members"          value={fmt(stats.members)}  hint="creators + scouts" />
          <StatCell label="Audits last 7d"   value={fmt(stats.audits_7d)} hint="weekly run-rate" />
          <StatCell label="CLI invocations"  value={fmt(stats.cli_7d)}    hint="`npx commitshow`" />
        </div>
        <div className="font-mono text-[10px] mt-3" style={{ color: 'var(--text-faint)' }}>
          Live numbers · pulled from production at page load · pre-launch (Season Zero)
        </div>
      </section>

      <Divider />

      {/* ─── Problem ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="01" label="The opportunity" accent={SCARLET} />
        <SectionH>30 million people now ship code without writing it</SectionH>
        <SectionLead>
          Cursor crossed 1M paying users in 2025. Lovable went from $0 to $20M ARR in 8 weeks. Claude Code is shipping into Anthropic's enterprise contracts. Every product team you fund will lean on this layer to ship faster.
        </SectionLead>
        <SectionLead>
          But three new problems landed with the wave — and none have a default tool yet:
        </SectionLead>
        <div className="grid md:grid-cols-3 gap-4 mt-2">
          <ProblemCard tone={SCARLET} title="No quality signal" body="A landing page built in 6 hours and one shipped to staff for 6 months look identical at the URL. Investors, hiring managers, and customers can't tell which is which." />
          <ProblemCard tone={SCARLET} title="Drift between AI tools" body="Same prompt, four different outputs. There's no public artifact that says 'this Cursor rule worked' or 'this Claude Skill stuck the landing.' Knowledge stays trapped in private Discord screenshots." />
          <ProblemCard tone={SCARLET} title="No trust marketplace" body="Solo builders ship great work but have no portfolio surface. Recruiters and acquirers fall back to GitHub stars (wrong signal) or VC-backed brands (lossy filter)." />
        </div>
      </section>

      <Divider />

      {/* ─── Solution ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="02" label="What we built" accent={GOLD} />
        <SectionH>The audit layer for vibe-coded products</SectionH>
        <SectionLead>
          commit.show measures every shipped product against a transparent 100-point rubric — combining deterministic technical signals (Lighthouse, repo hygiene, security headers, deep probes) with two human signals (Scout forecasts, Community engagement). The result: a verifiable score that travels.
        </SectionLead>

        <div className="grid md:grid-cols-3 gap-4 mt-8">
          <LaneCard
            tone={BLUE}
            num="01"
            title="URL Fast Lane"
            sub="No repo · 30 seconds"
            body="Paste any deployed URL. We run mobile + desktop Lighthouse in parallel, multi-route reachability, post-hydration probe via Cloudflare Browser Rendering, and security-header audit. Closed-source SaaS founders get a real signal without exposing source."
          />
          <LaneCard
            tone={TEAL}
            num="02"
            title="CLI Walk-on"
            sub="Anonymous repo audit · npx"
            body={<>One terminal command — <code style={{ color: 'var(--cream)', fontFamily: 'DM Mono, monospace', fontSize: '0.85em' }}>npx commitshow@latest audit github.com/owner/repo</code> — surfaces a /100 score and the fixable concerns. Output goes straight back into Cursor / Claude Code as the next prompt's context.</>}
          />
          <LaneCard
            tone={PURPLE}
            num="03"
            title="Member Audition"
            sub="Full audit · permanent ladder + events"
            body="Creator submits product + Build Brief. The Audit engine runs deep checks, Scouts (graded forecasters) cast vote tickets, and the project enters the permanent Ladder — real-time ranking by category and time window (today / week / month / all-time). Six event templates run on top: Quarterly Season (3-week, top 20% graduate to Hall of Fame), Tool Challenge, Theme Sprint, Quality Bar, Sponsored Showcase, Open Bounty."
          />
        </div>
      </section>

      <Divider />

      {/* ─── Scoring ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="03" label="Scoring methodology" accent={GOLD} />
        <SectionH>The Creator tier · plus 50 · 30 · 20 per project</SectionH>
        <SectionLead>
          Two ledgers run in parallel. Each <strong>project</strong> gets a 100-point score (Audit 50 + Scout 30 + Community 20). Each <strong>Creator</strong> carries a tier that compounds across all their audited projects — graduations promote it, average score shapes it. New builders join at Rookie; the rare ones reach Legend over years of audited shipping. The tier is the portable credential, the per-project score is the live measurement.
        </SectionLead>

        {/* Creator grade ladder · §8 */}
        <div className="px-5 py-5 mb-10"
             style={{ background: 'rgba(15,32,64,0.45)', border: `1px solid ${GOLD}30`, borderRadius: '2px' }}>
          <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-3" style={{ color: GOLD }}>Creator tiers · the actor identity</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <GradeCell color="#6B7280" name="Rookie"        cond="1+ audited · 0 grads" />
            <GradeCell color="#60A5FA" name="Builder"       cond="1 graduation · avg 60+" />
            <GradeCell color="#00D4AA" name="Maker"         cond="2 grads · avg 70+" />
            <GradeCell color="#A78BFA" name="Architect"     cond="3 grads · avg 75+ · tech diversity" />
            <GradeCell color="#F0C040" name="Vibe Engineer" cond="5 grads · avg 80+ · 20+ applauds" />
            <GradeCell color="#C8102E" name="Legend"        cond="10+ grads · community leader" />
          </div>
          <div className="font-light text-sm mt-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Tier unlocks platform privileges (Library publishing limits · Office Hours hosting · Hall of Fame eligibility · Scout tier OR-path). It travels with the Creator across audits — each shipped project compounds the next one's frame.
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-10">
          <PillarCard tone={GOLD} title="Audit" weight="50">
            <p className="mb-2"><strong style={{ color: 'var(--cream)' }}>Deterministic.</strong> Same input, same score, every time.</p>
            <ul className="space-y-1 list-none">
              <li>· Lighthouse (mobile + desktop, averaged) — 20 pts</li>
              <li>· Live URL Health + multi-route — 5 pts</li>
              <li>· Production Maturity (tests · CI · TS strict · LICENSE · responsive) — 12 pts</li>
              <li>· Source Hygiene (repo accessibility · governance) — 5 pts</li>
              <li>· Tech Layer Diversity — 3 pts</li>
              <li>· Build Brief Integrity — 5 pts</li>
              <li>· Soft bonuses (ecosystem · activity · elite OSS tier) — +0-10</li>
            </ul>
          </PillarCard>
          <PillarCard tone={PURPLE} title="Scout" weight="30">
            <p className="mb-2"><strong style={{ color: 'var(--cream)' }}>Human forecasts.</strong> Graded judges with skin in the game.</p>
            <ul className="space-y-1 list-none">
              <li>· Tier-gated monthly vote allocation (20-80)</li>
              <li>· Hit-rate tracked per Scout, public profile</li>
              <li>· Self-vote blocked at DB layer</li>
              <li>· Early-Spotter bonus for pre-week-1 conviction</li>
              <li>· Scouts compete for OR-path tier promotion (activity OR accuracy)</li>
            </ul>
          </PillarCard>
          <PillarCard tone={TEAL} title="Community" weight="20">
            <p className="mb-2"><strong style={{ color: 'var(--cream)' }}>Network signal.</strong> Engagement quality, not raw volume.</p>
            <ul className="space-y-1 list-none">
              <li>· Comment depth (judgment-based, not "+1")</li>
              <li>· Re-visit rate weighted</li>
              <li>· Applauds (unlimited toggle, 1 item · 1 applaud)</li>
              <li>· Self-engagement filtered out</li>
              <li>· Cosine-similarity bot pattern → silent zero-out</li>
            </ul>
          </PillarCard>
        </div>

        <div className="px-5 py-5"
             style={{ background: `${GOLD}08`, border: `1px solid ${GOLD}30`, borderRadius: '2px' }}>
          <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-2" style={{ color: GOLD }}>Why publish the rubric</div>
          <div className="font-light" style={{ color: 'var(--text-primary)', fontSize: '0.95rem', lineHeight: 1.55 }}>
            Closed-rubric review platforms (App Store, ProductHunt, awesome-lists) lose trust the moment users believe scoring is arbitrary. We publish the slot weights, the bucket thresholds, and the calibration set. Builders can simulate their score before submitting. That radical transparency is the moat — copy our rubric and you're now competing with us at our own benchmark.
          </div>
        </div>
      </section>

      <Divider />

      {/* ─── Network effects ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="04" label="Network effects" accent={GOLD} />
        <SectionH>Three sides, one flywheel</SectionH>
        <SectionLead>
          Every audit produces three reusable assets: a public score (creator-side), a forecast track record (scout-side), and a Library artifact — Cursor rules, Claude Skills, MCP configs that the audited repo actually shipped with. Each artifact links back to the graduated project as proof. Adoption begets audits begets artifacts.
        </SectionLead>

        <div className="grid md:grid-cols-3 gap-4 mt-2">
          <FlowCard
            tone={GOLD}
            label="Creator"
            edges="Audited → live ladder rank → streaks + milestones"
            body="Solo builder ships a product. The Audit engine scores it and the project enters the permanent Ladder — ranked in real time per category × time window. Streaks (100 days top-50) and milestones (first top-10, all-categories top-50) accumulate as durable badges. Quarterly Season events layer on top for cohort-based graduation and Hall of Fame entry."
          />
          <FlowCard
            tone={PURPLE}
            label="Scout"
            edges="Forecasts tracked → tier promotion → recruiter signal"
            body="Senior engineers and PMs vote on which audited products will ship. Hit-rate is public. Top Scouts unlock 'Verified by commit.show' badges that recruiters and acquirers use as a hiring filter."
          />
          <FlowCard
            tone={TEAL}
            label="Library"
            edges="Auto-discovered → adopted via PR → graduations citing it"
            body="Every audited repo is scanned for reusable artifacts (Cursor rules, MCP configs, prompt packs). The 'apply-to-my-repo' flow opens a one-click PR. Adoption stats become the artifact's credibility — not stars, not downloads."
          />
        </div>
      </section>

      <Divider />

      {/* ─── Business model ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="05" label="Business model" accent={GOLD} />
        <SectionH>B2C now · B2B layered on the same data</SectionH>
        <SectionLead>
          The audit engine is the wedge. Same scoring infrastructure powers a consumer credentialing layer (today) and an enterprise / recruiter / sponsorship layer (V1.5+). One pipeline, four revenue surfaces.
        </SectionLead>

        <div className="grid md:grid-cols-2 gap-5 mt-4">
          {/* B2C */}
          <div className="px-5 py-5" style={{ background: 'rgba(15,32,64,0.55)', border: `1px solid ${GOLD}40`, borderRadius: '2px' }}>
            <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: GOLD }}>B2C — live in V1</div>
            <div className="font-display font-black text-2xl mb-4" style={{ color: 'var(--cream)' }}>Consumer credential layer</div>
            <RevenueRow tone={GOLD} title="Audition fees"
              body="3 free audits per Creator, then a per-audition fee. Stripe Live since 2026-05-09. Recoupable as Encore credit on Diploma graduation, mirrors Steam Direct's model — aligned incentives, soft conversion." />
            <RevenueRow tone={GOLD} title="Library marketplace"
              body="80 / 20 split (Creator / platform) on premium artifacts. Free tier ships day 1 to bootstrap supply; paid tier unlocks once the artifact has graduated projects citing it. V1.5 launch." />
            <RevenueRow tone={GOLD} title="Cosmetic + permanence"
              body="Hall of Fame upgrades, custom badge designs, season memorabilia. Low-frequency but high-margin · Steam-style monetization on top of the credential." />
          </div>

          {/* B2B */}
          <div className="px-5 py-5" style={{ background: 'rgba(15,32,64,0.55)', border: `1px solid ${PURPLE}40`, borderRadius: '2px' }}>
            <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: PURPLE }}>B2B — V1.5 / V2</div>
            <div className="font-display font-black text-2xl mb-4" style={{ color: 'var(--cream)' }}>Enterprise + ecosystem layer</div>
            <RevenueRow tone={PURPLE} title="Audit API"
              body="Same engine exposed as a metered REST endpoint. Buyers: portfolio acceleration teams, code-review SaaS adding a 'shipping readiness' module, ATS vendors stamping candidate repos. $0.05–$0.50 per audit, volume tiers." />
            <RevenueRow tone={PURPLE} title="GitHub Marketplace Action"
              body="commitshow/audit-action ships PR-gating now. Free tier for OSS; paid tier ($X/seat/mo) for private monorepos with unlimited PR audits + custom rule overlays. Already published on GitHub Marketplace." />
            <RevenueRow tone={PURPLE} title="Recruiter access"
              body="ATS-style tier for hiring teams: filter graduated Creators by Audit pillar, Stack Fingerprint, Scout endorsements. Per-seat subscription. Bridges the 'GitHub stars are wrong signal' problem identified in §01." />
            <RevenueRow tone={PURPLE} title="Tool sponsorship + Sponsored Showcases"
              body="Cursor, Anthropic, Vercel sponsor seasonal Showcases tied to their stack. Sponsor pays the prize pool + retainer for branded events. Already templated in /admin/events (6 templates · ready)." />
          </div>
        </div>
      </section>

      <Divider />

      {/* ─── Roadmap ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="06" label="Roadmap" accent={GOLD} />
        <SectionH>From wedge to ecosystem in 18 months</SectionH>
        <SectionLead>
          We're at the end of V1 build. Public launch is days, not weeks, away. Below is the 4-phase plan against this raise.
        </SectionLead>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mt-4">
          <RoadCol tone={GOLD} phase="V1 · now" title="Audit + Audition"
            items={[
              'Three audit lanes live (URL · CLI · member)',
              'Stripe Live in production',
              'Season Zero open to public',
              'GitHub Action published on Marketplace',
              'CLI on npm — npx commitshow@latest audit',
            ]} />
          <RoadCol tone={PURPLE} phase="V1.5 · Q3 2026" title="Library Marketplace"
            items={[
              'Cursor rules · Claude Skills · MCP configs · prompt packs',
              'Auto-discovery scans graduated repos',
              'One-click apply-to-my-repo PR',
              '80/20 paid tier with Stripe',
              'Adoption stats → graduation provenance',
            ]} />
          <RoadCol tone={TEAL} phase="V1.8 · Q4 2026" title="Enterprise + Recruiter"
            items={[
              'Metered Audit API',
              'Recruiter ATS tier',
              'Private repo audits via GitHub App',
              'SOC 2 readiness',
              'Tool sponsorship pipeline (Cursor · Anthropic · Vercel)',
            ]} />
          <RoadCol tone={BLUE} phase="V2 · 2027" title="Ecosystem layer"
            items={[
              'MCP server (Claude Desktop / Cursor / Windsurf integration)',
              'Open Bounty hosting (sponsor-funded)',
              'Acquisition / Fund-of-Funds discovery surface',
              'Multi-region calibration',
              'White-label for code-review vendors',
            ]} />
        </div>

        <div className="mt-8 px-5 py-4" style={{ background: `${GOLD}08`, border: `1px solid ${GOLD}30`, borderRadius: '2px' }}>
          <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-1" style={{ color: GOLD }}>Capital efficiency</div>
          <div className="font-light" style={{ color: 'var(--text-primary)', fontSize: '0.95rem', lineHeight: 1.55 }}>
            V1 was built to public launch on under $40K of all-in spend (Claude API · Stripe · Cloudflare · Supabase). The pipeline that scores audits is the same pipeline that powers the API tier — every dollar invested in calibration upgrades both products simultaneously.
          </div>
        </div>
      </section>

      <Divider />

      {/* ─── Why now ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="07" label="Why now" accent={GOLD} />
        <SectionH>Three windows, all open at once</SectionH>
        <div className="grid md:grid-cols-3 gap-4 mt-4">
          <WhyNowCard
            tone={GOLD}
            t="Vibe-coding wave is mainstream"
            body="Cursor 1M+ paying. Lovable $20M ARR in 8 weeks. Claude Code shipping into Anthropic enterprise. Tens of millions of net-new builders entered the surface in 18 months."
          />
          <WhyNowCard
            tone={PURPLE}
            t="LLM-as-judge crossed reliability bar"
            body="Claude Sonnet 4.6 + structured tool-use makes deterministic, auditable scoring possible at scale. The 'AI grades AI' loop now works — calibration drift is measured per prompt change, not per quarter."
          />
          <WhyNowCard
            tone={TEAL}
            t="Discovery is broken on every legacy surface"
            body="GitHub Trending optimizes for stars, ProductHunt for launch-day traffic, awesome-lists for authorship. Nothing surfaces 'this works in production today.' The category is empty."
          />
        </div>
      </section>

      <Divider />

      {/* ─── Moat ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="08" label="Moat" accent={GOLD} />
        <SectionH>Six layers a copycat can't bolt on</SectionH>
        <div className="grid md:grid-cols-2 gap-3 mt-4">
          <MoatRow n="1" t="Calibration set"      body="Five reference projects re-scored on every prompt change. Six months of drift data. A new entrant starts at zero." />
          <MoatRow n="2" t="Scout track record"   body="Every Scout's hit-rate is public and accumulates per season. A two-season-deep Scout brand can't be fast-followed." />
          <MoatRow n="3" t="Graduation provenance" body="Library artifacts cite the audited projects that graduated using them. Adoption → graduation is a closed loop competitors don't have data for." />
          <MoatRow n="4" t="Apply-to-my-repo PR"  body="One-click PR generation from artifact to user repo. GitHub OAuth + variable substitution + multi-file Skill bundles. Wappalyzer / awesome-cursorrules are read-only — we ship code." />
          <MoatRow n="5" t="Three-side flywheel"  body="Creator audit → Scout forecast → Library adoption. Each side feeds the other. Single-side competitors (just-Lighthouse, just-recruiter, just-marketplace) never ignite a cross-side compound." />
          <MoatRow n="6" t="Brand position"        body="'Every commit, on stage' has clean ownership. 'Hall of Fame' / 'Audition' / 'Audit' verbs are pre-empted. A new entrant has to invent vocabulary while we own the URL." />
        </div>
      </section>

      <Divider />

      {/* ─── Competitive ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="09" label="Competition" accent={GOLD} />
        <SectionH>What we are · what we are not</SectionH>
        <div className="overflow-x-auto mt-4">
          <table className="w-full font-mono text-[12px]" style={{ minWidth: 720 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${GOLD}30` }}>
                <th className="text-left py-3 pr-4 font-mono text-[10px] tracking-widest uppercase" style={{ color: GOLD }}>Surface</th>
                <th className="text-left py-3 pr-4 font-mono text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>What it does</th>
                <th className="text-left py-3 font-mono text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Why we win</th>
              </tr>
            </thead>
            <tbody style={{ color: 'var(--text-primary)' }}>
              <CompRow s="GitHub Trending" what="Star-weighted ranking" win="Stars ≠ working in production. We measure what ships." />
              <CompRow s="ProductHunt"     what="Launch-day attention surface" win="One-day spike, no follow-up audit. We measure week-to-week craft." />
              <CompRow s="awesome-cursorrules" what="Curated copy-paste lists" win="Read-only, no provenance. Our artifacts cite graduated repos and ship via one-click PR." />
              <CompRow s="Wappalyzer / BuiltWith" what="Tech-stack detection" win="Detection only. We score, rank, and credentialize." />
              <CompRow s="Lighthouse direct" what="Performance audit" win="Single signal. We combine LH + repo + scout + community in one rubric." />
              <CompRow s="LinkedIn / Recruiter ATS" what="Profile-based hiring filter" win="No engineering signal. We surface 'audited and graduated' as portable proof of craft." />
            </tbody>
          </table>
        </div>
      </section>

      <Divider />

      {/* ─── Team / Ask ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="10" label="Team & ask" accent={GOLD} />
        <SectionH>Who's building, what we're raising</SectionH>
        <div className="grid md:grid-cols-2 gap-5 mt-2">
          <div className="px-5 py-5" style={{ background: 'rgba(15,32,64,0.55)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px' }}>
            <div className="font-mono text-[10px] tracking-widest uppercase mb-4" style={{ color: GOLD }}>Founders</div>
            <FounderCard
              name="Han Kim"
              role="Founder"
              photo="/team/han.jpg"
              initial="H"
              linkedin="https://www.linkedin.com/in/han-seok-kim-0057121aa/"
              bio="Builds end-to-end across product, engineering, and brand. Wrote the audit engine, the React surface, the Stripe integration, and the CLI."
            />
            <div style={{ height: 12 }} />
            <FounderCard
              name="CJ Kim"
              role="Founder"
              photo="/team/cj.jpg"
              initial="C"
              linkedin="https://www.linkedin.com/in/chanjoonkim/"
              bio="Drives go-to-market, partnerships, and the ecosystem outreach pipeline. Operates the Tool-maker relationships that anchor V1.5 Library Marketplace supply."
            />
            <p className="font-mono text-[11px] mt-4" style={{ color: 'var(--text-muted)' }}>
              No outside hires shipped V1. Same hands write the engine, the deck, and this page.
            </p>
          </div>
          <div className="px-5 py-5" style={{ background: 'rgba(15,32,64,0.55)', border: `1px solid ${GOLD}50`, borderRadius: '2px' }}>
            <div className="font-mono text-[10px] tracking-widest uppercase mb-3" style={{ color: GOLD }}>The ask</div>
            <div className="font-light" style={{ color: 'var(--text-primary)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              <div className="mb-4 pb-3" style={{ borderBottom: `1px solid ${GOLD}20` }}>
                <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Target raise</div>
                <div className="font-display font-black tabular-nums" style={{ color: GOLD, fontSize: '2rem', lineHeight: 1.1 }}>$500K</div>
                <div className="font-mono text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Pre-seed · 18-month runway</div>
              </div>
              <p className="mb-3">Funds take V1 public, ship the Library Marketplace (V1.5), and stand up the Audit API tier (V1.8).</p>
              <p className="mb-1" style={{ color: 'var(--cream)', fontWeight: 600 }}>Use of funds</p>
              <ul className="space-y-1.5 mb-3 list-none">
                <li>· <span style={{ color: 'var(--cream)' }}>30% Marketing &amp; brand</span> — paid acquisition · launch campaign · creator partnerships · X · Discord · YouTube content</li>
                <li>· <span style={{ color: 'var(--cream)' }}>25% Engineering</span> — one senior hire (Library Marketplace · API tier)</li>
                <li>· <span style={{ color: 'var(--cream)' }}>20% Ecosystem &amp; BD</span> — Tool-partner outreach (Cursor · Anthropic · Vercel) · sponsorship pipeline</li>
                <li>· <span style={{ color: 'var(--cream)' }}>15% Calibration &amp; infra</span> — Claude API at scale · evaluation infra · CF Browser Rendering</li>
                <li>· <span style={{ color: 'var(--cream)' }}>10% Legal &amp; ops</span> — counsel · accounting · SOC 2 prep</li>
              </ul>
              <p style={{ color: 'var(--text-muted)' }}>Valuation and instrument structure discussed in first conversation.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Closing ─── */}
      <section className="px-4 md:px-8 lg:px-16 pt-12 pb-32 max-w-6xl mx-auto">
        <div className="px-6 md:px-10 py-10"
             style={{
               background: `linear-gradient(135deg, ${NAVY_800} 0%, ${NAVY_950} 100%)`,
               border: `1px solid ${GOLD}40`,
               borderRadius: '2px',
             }}>
          <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-3" style={{ color: GOLD }}>Closing</div>
          <div className="font-display font-black mb-4"
               style={{ color: 'var(--cream)', fontSize: 'clamp(1.6rem, 3.4vw, 2.6rem)', lineHeight: 1.1, letterSpacing: '-0.5px' }}>
            The next 30 million developers don't need another IDE. They need a stage that says <span style={{ color: GOLD }}>this works</span>
          </div>
          <p className="font-light mb-6" style={{ color: 'var(--text-primary)', fontSize: '1.05rem', lineHeight: 1.55, maxWidth: 880 }}>
            We are at Season Zero. Audits are running. The CLI is on npm. The Action is on Marketplace. Stripe is live. The product works today and the moat compounds with every snapshot. We'd like to talk to investors who see the wave the same way.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href="mailto:han@commit.show?subject=Investor%20intro%20%C2%B7%20commit.show"
               className="inline-block px-5 py-2.5 font-mono text-[12px] tracking-widest uppercase"
               style={{ background: GOLD, color: NAVY_950, borderRadius: '2px' }}>
              Email the founders →
            </a>
            <Link to="/" className="inline-block px-5 py-2.5 font-mono text-[12px] tracking-widest uppercase"
                  style={{ border: '1px solid rgba(255,255,255,0.18)', color: 'var(--cream)', borderRadius: '2px' }}>
              Try the product
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Section helpers
// ──────────────────────────────────────────────────────────────────────

function Divider() {
  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16">
      <div style={{ height: 1, background: 'rgba(240,192,64,0.12)' }} />
    </div>
  )
}

function FounderCard({ name, role, photo, initial, linkedin, bio }: {
  name: string; role: string; photo: string; initial: string; linkedin: string; bio: string;
}) {
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <div className="flex gap-4 items-start">
      <div className="flex-shrink-0 flex items-center justify-center font-display font-black overflow-hidden"
           style={{
             width: 64, height: 64,
             background: imgFailed ? GOLD : 'var(--navy-800)',
             border: '1px solid rgba(240,192,64,0.35)',
             borderRadius: '2px',
             color: NAVY_950, fontSize: 28,
           }}>
        {imgFailed
          ? initial
          : <img src={photo} alt={name} className="w-full h-full" style={{ objectFit: 'cover' }} onError={() => setImgFailed(true)} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
          <div className="font-display font-bold text-base" style={{ color: 'var(--cream)' }}>{name}</div>
          <div className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>{role}</div>
        </div>
        <p className="font-light text-sm mb-1.5" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{bio}</p>
        <a href={linkedin} target="_blank" rel="noopener noreferrer"
           className="inline-block font-mono text-[11px]"
           style={{ color: GOLD, textDecoration: 'underline', textUnderlineOffset: 3 }}>
          LinkedIn ↗
        </a>
      </div>
    </div>
  )
}

function GradeCell({ color, name, cond }: { color: string; name: string; cond: string }) {
  return (
    <div className="px-3 py-2.5"
         style={{ background: `${color}10`, border: `1px solid ${color}40`, borderRadius: '2px' }}>
      <div className="font-display font-bold text-sm mb-0.5" style={{ color }}>{name}</div>
      <div className="font-mono text-[10px]" style={{ color: 'var(--text-secondary)', lineHeight: 1.45 }}>{cond}</div>
    </div>
  )
}

function ProblemCard({ tone, title, body }: { tone: string; title: string; body: string }) {
  return (
    <div className="px-5 py-5" style={{ background: `${tone}08`, border: `1px solid ${tone}30`, borderRadius: '2px' }}>
      <div className="font-display font-bold text-lg mb-2" style={{ color: 'var(--cream)' }}>{title}</div>
      <p className="font-light text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>{body}</p>
    </div>
  )
}

function LaneCard({ tone, num, title, sub, body }: { tone: string; num: string; title: string; sub: string; body: React.ReactNode }) {
  return (
    <div className="px-5 py-5" style={{ background: `${tone}08`, border: `1px solid ${tone}40`, borderRadius: '2px' }}>
      <div className="font-mono text-[10px] tracking-widest uppercase mb-1" style={{ color: tone }}>Lane {num}</div>
      <div className="font-display font-black text-xl mb-1" style={{ color: 'var(--cream)' }}>{title}</div>
      <div className="font-mono text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>{sub}</div>
      <div className="font-light text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>{body}</div>
    </div>
  )
}

function FlowCard({ tone, label, edges, body }: { tone: string; label: string; edges: string; body: string }) {
  return (
    <div className="px-5 py-5" style={{ background: `${tone}08`, border: `1px solid ${tone}40`, borderRadius: '2px' }}>
      <div className="font-mono text-[10px] tracking-widest uppercase mb-1" style={{ color: tone }}>{label}</div>
      <div className="font-mono text-[11px] mb-3" style={{ color: 'var(--text-secondary)' }}>{edges}</div>
      <div className="font-light text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>{body}</div>
    </div>
  )
}

function RevenueRow({ tone, title, body }: { tone: string; title: string; body: string }) {
  return (
    <div className="mb-4 pl-3" style={{ borderLeft: `2px solid ${tone}` }}>
      <div className="font-display font-bold text-base mb-1" style={{ color: 'var(--cream)' }}>{title}</div>
      <div className="font-light text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>{body}</div>
    </div>
  )
}

function RoadCol({ tone, phase, title, items }: { tone: string; phase: string; title: string; items: string[] }) {
  return (
    <div className="px-4 py-4" style={{ background: `${tone}08`, border: `1px solid ${tone}40`, borderRadius: '2px', minHeight: 280 }}>
      <div className="font-mono text-[10px] tracking-widest uppercase mb-1" style={{ color: tone }}>{phase}</div>
      <div className="font-display font-bold text-base mb-3" style={{ color: 'var(--cream)' }}>{title}</div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2" style={{ color: 'var(--text-primary)' }}>
            <span className="font-mono text-xs" style={{ color: tone }}>·</span>
            <span className="font-light text-[12.5px]" style={{ lineHeight: 1.45 }}>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function WhyNowCard({ tone, t, body }: { tone: string; t: string; body: string }) {
  return (
    <div className="px-5 py-5" style={{ background: `${tone}08`, border: `1px solid ${tone}30`, borderRadius: '2px' }}>
      <div className="font-display font-bold text-base mb-2" style={{ color: tone }}>{t}</div>
      <p className="font-light text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>{body}</p>
    </div>
  )
}

function MoatRow({ n, t, body }: { n: string; t: string; body: string }) {
  return (
    <div className="px-4 py-3 flex gap-3" style={{ background: 'rgba(15,32,64,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px' }}>
      <div className="font-mono text-2xl flex-shrink-0" style={{ color: GOLD, fontFamily: 'Playfair Display, serif', lineHeight: 1, paddingTop: 2 }}>{n}</div>
      <div>
        <div className="font-display font-bold mb-1" style={{ color: 'var(--cream)', fontSize: '1rem' }}>{t}</div>
        <div className="font-light text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  )
}

function CompRow({ s, what, win }: { s: string; what: string; win: string }) {
  return (
    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <td className="py-3 pr-4 font-mono align-top" style={{ color: 'var(--cream)' }}>{s}</td>
      <td className="py-3 pr-4 align-top" style={{ color: 'var(--text-secondary)' }}>{what}</td>
      <td className="py-3 align-top" style={{ color: 'var(--text-primary)' }}>{win}</td>
    </tr>
  )
}

// Suppress an unused-helpers lint warning · these are referenced from
// the JSX above but tsc (sometimes) flags via the closure.
void BulletList
