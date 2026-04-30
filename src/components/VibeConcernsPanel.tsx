// VibeConcernsPanel — 7-category checklist of failure modes that
// AI-coded projects systematically miss. Generic linters and Cursor's
// inline review don't catch these; commit.show's audit does.
//
// Reads gh.signals.vibe_concerns directly from the snapshot — no LLM
// dependency, so this card is fast, deterministic, and cheap to render
// (Claude variability stays in the prose strengths/weaknesses).

import type { ReactNode } from 'react'

interface VibeConcerns {
  // Core 7 Frames
  webhook_idempotency: { handlers_seen: number; idempotency_signal_seen: number; signature_verified_seen?: number; gap: boolean; sample_files: string[] }
  rls_gaps:            { tables: number; policies: number; writable_table_signals: number; gap_estimate: number; tables_uncovered?: string[]; has_rls_intent: boolean }
  secret_exposure:     { client_violations: Array<{ file: string; pattern: string; reason?: string }>; total: number }
  db_indexes:          { fk_columns_seen: number; indexes_seen: number; gap_estimate: number; unindexed_samples?: Array<{ file: string; column: string; references?: string }> }
  observability:       { libs: string[]; detected: boolean; checked_subpackages?: number }
  rate_limit:          { lib_detected: string | null; middleware_detected: boolean; has_api_routes: boolean; needs_attention: boolean }
  prompt_injection:    { uses_ai_sdk: boolean; ai_evidence_files?: string[]; raw_input_to_prompt_files: string[]; sanitization_detected?: boolean; suspicious: boolean }
  // Extension frames 8-11 (2026-04-30 · AI-template-copy footguns)
  hardcoded_urls?:     { samples: Array<{ file: string; pattern: string }>; total: number }
  mock_data?:          { samples: Array<{ file: string; collection: string }>; total: number }
  webhook_signature?:  { handlers_seen: number; verified_seen: number; gap: boolean; sample_files: string[] }
  cors_permissive?:    { samples: Array<{ file: string; pattern: string }>; total: number }
}

type Status = 'pass' | 'warn' | 'fail' | 'na'

interface CardData {
  key:       string
  title:     string             // "Webhook idempotency"
  prevalence:string             // "85% miss this"
  status:    Status
  finding:   string             // one-line specific finding for THIS project
  why:       string             // why this matters for vibe coders (static)
  fix:       string | null      // suggested next step
  evidence?: string[]           // file paths or table names backing this card
}

function evaluate(vc: VibeConcerns | null | undefined): CardData[] {
  const cards: CardData[] = []
  // 1. Webhook idempotency
  {
    const w = vc?.webhook_idempotency
    let status: Status = 'na'
    let finding = 'No webhook handler files detected — N/A.'
    if (w && w.handlers_seen > 0) {
      if (w.gap) {
        status = 'fail'
        finding = `${w.handlers_seen} webhook handler${w.handlers_seen === 1 ? '' : 's'} detected · 0 idempotency-key check found.`
      } else if (w.idempotency_signal_seen > 0) {
        status = 'pass'
        finding = `${w.idempotency_signal_seen}/${w.handlers_seen} handler${w.handlers_seen === 1 ? '' : 's'} reference idempotency or event-id dedupe.`
      }
    }
    cards.push({
      key: 'webhook',
      title: 'Webhook idempotency',
      prevalence: '85% of vibe-coded projects miss this',
      status,
      finding,
      why: 'Stripe / Slack / GitHub retry webhooks if your endpoint returns non-2xx. Without an idempotency key, a payment can charge twice.',
      fix: status === 'fail' ? 'Add an idempotency-key check (Stripe `event.id`, Slack `event_id`, etc.) before the side effect.' : null,
      evidence: w?.sample_files,
    })
  }

  // 2. Supabase RLS gaps
  {
    const r = vc?.rls_gaps
    let status: Status = 'na'
    let finding = 'No SQL migrations detected — N/A.'
    if (r && r.tables > 0) {
      if (!r.has_rls_intent) {
        status = 'fail'
        finding = `${r.tables} CREATE TABLE statements · 0 row-level-security policies. Tables open to any authenticated user.`
      } else if (r.gap_estimate >= 3) {
        status = 'warn'
        finding = `${r.tables} tables · ${r.policies} policies · ${r.gap_estimate} likely uncovered.`
      } else {
        status = 'pass'
        finding = `${r.tables} tables · ${r.policies} RLS policies · gap minimal.`
      }
    }
    cards.push({
      key: 'rls',
      title: 'RLS coverage (Supabase)',
      prevalence: '70% of Supabase projects have at least one writable table without policy',
      status,
      finding,
      why: 'Supabase RLS is OFF by default. Any table without an `enable row level security` + matching `create policy` is readable / writable by every signed-in user.',
      fix: status === 'fail' || status === 'warn' ? 'Run `alter table <name> enable row level security;` then add `create policy` for each select/insert/update/delete.' : null,
      evidence: r?.tables_uncovered,
    })
  }

  // 3. Secret client-side exposure
  {
    const s = vc?.secret_exposure
    let status: Status = 'pass'
    let finding = 'No service-role keys or secret tokens found in client-side files.'
    if (s && s.total > 0) {
      status = 'fail'
      const first = s.client_violations[0]
      finding = `${s.total} client file${s.total === 1 ? '' : 's'} reference${s.total === 1 ? 's' : ''} a secret pattern · e.g. \`${first?.pattern ?? '?'}\` in ${first?.file ?? '?'}.`
    }
    cards.push({
      key: 'secrets',
      title: 'Service-role / secret exposure',
      prevalence: '60% of vibe-coded apps leak a secret to the bundle',
      status,
      finding,
      why: 'Anything with `process.env.X` reachable from a client file ships in the JS bundle. Service-role keys = full database takeover.',
      fix: status === 'fail' ? 'Move secrets to server-only routes (`api/` · server actions · edge functions) and keep only `NEXT_PUBLIC_*` style anon keys client-side.' : null,
      evidence: s?.client_violations?.map(v => `${v.file} · ${v.reason ?? v.pattern}`),
    })
  }

  // 4. DB missing indexes
  {
    const d = vc?.db_indexes
    let status: Status = 'na'
    let finding = 'No SQL migrations detected — N/A.'
    if (d && d.fk_columns_seen > 0) {
      if (d.gap_estimate >= 3) {
        status = 'warn'
        finding = `${d.fk_columns_seen} FK / lookup columns · ${d.indexes_seen} CREATE INDEX. Likely query-perf cliff at scale.`
      } else if (d.gap_estimate > 0) {
        status = 'warn'
        finding = `${d.fk_columns_seen} FK columns · ${d.indexes_seen} indexes · ${d.gap_estimate} likely unindexed.`
      } else {
        status = 'pass'
        finding = `${d.fk_columns_seen} FK columns · ${d.indexes_seen} indexes — coverage looks healthy.`
      }
    }
    cards.push({
      key: 'indexes',
      title: 'Database indexes',
      prevalence: '90% of vibe-coded schemas miss FK indexes',
      status,
      finding,
      why: 'AI tends to write `references` clauses but forgets to add indexes. Queries stay fast at 1k rows; collapse at 100k.',
      fix: status !== 'pass' && status !== 'na' ? 'For every `_id uuid references X(id)`, add `create index <table>_<col>_idx on <table> (<col>);`.' : null,
      evidence: d?.unindexed_samples?.map(u => u.references ? `${u.file} · ${u.column} → ${u.references}` : `${u.file} · ${u.column}`),
    })
  }

  // 5. Observability
  {
    const o = vc?.observability
    let status: Status = 'fail'
    let finding = 'No error-tracking library in package.json (sentry / datadog / pino / winston / otel).'
    if (o && o.detected) {
      status = 'pass'
      finding = `Detected: ${o.libs.join(' · ')}.`
    }
    cards.push({
      key: 'observability',
      title: 'Error tracking',
      prevalence: '95% of vibe-coded apps have nothing wired',
      status,
      finding,
      why: '`console.log` doesn\'t reach prod. When users hit an error you don\'t notice, they bounce — and you don\'t know why.',
      fix: status !== 'pass' ? 'Add Sentry (`@sentry/nextjs`, `@sentry/node`) or pino + pino-pretty. ~10 minutes to wire.' : null,
    })
  }

  // 6. Rate limit
  {
    const r = vc?.rate_limit
    let status: Status = 'pass'
    let finding = 'No API routes detected — N/A.'
    if (r) {
      if (!r.has_api_routes) {
        status = 'na'
        finding = 'No API routes detected — N/A.'
      } else if (r.lib_detected) {
        status = 'pass'
        finding = `Detected: ${r.lib_detected}.`
      } else if (r.middleware_detected) {
        status = 'pass'
        finding = 'Custom rate-limit middleware detected.'
      } else if (r.needs_attention) {
        status = 'fail'
        finding = 'API routes present · 0 rate-limit lib or middleware. Open to scraping & bill-shock.'
      }
    }
    cards.push({
      key: 'rate_limit',
      title: 'API rate limiting',
      prevalence: '80% of vibe-coded APIs run wide open',
      status,
      finding,
      why: 'AI scaffolds routes without throttling. One enthusiastic LLM agent can hammer your endpoint 1000×/sec — and your bill follows.',
      fix: status === 'fail' ? 'Add `@upstash/ratelimit` (Vercel-native) or `express-rate-limit` (Node). 5 min wire-up.' : null,
    })
  }

  // 7. Prompt injection
  {
    const p = vc?.prompt_injection
    let status: Status = 'pass'
    let finding = 'No AI SDK detected — N/A.'
    if (p && p.uses_ai_sdk) {
      if (p.suspicious) {
        status = 'warn'
        finding = `${p.raw_input_to_prompt_files.length} file${p.raw_input_to_prompt_files.length === 1 ? '' : 's'} pipe user input directly into a model prompt — sanitize before send.`
      } else {
        status = 'pass'
        finding = 'AI SDK in use · no obvious raw-input-to-prompt patterns in API handlers.'
      }
    }
    cards.push({
      key: 'prompt_injection',
      title: 'Prompt injection / unsanitized input',
      prevalence: '70% of AI-feature projects leak the system prompt',
      status,
      finding,
      why: 'If `req.body.message` flows into your prompt, an attacker can override the system instructions, exfiltrate data, or rack up your token bill.',
      fix: status === 'warn' ? 'Wrap user input in a fixed delimiter (XML / JSON), validate length, and strip control chars before injecting into messages.' : null,
      evidence: p?.raw_input_to_prompt_files,
    })
  }

  // 8. Hardcoded URLs (extension)
  {
    const h = vc?.hardcoded_urls
    let status: Status = 'pass'
    let finding = 'No hardcoded localhost / 127.0.0.1 URLs in scanned files.'
    if (h && h.total > 0) {
      status = 'warn'
      finding = `${h.total} file${h.total === 1 ? '' : 's'} with hardcoded URLs · should be env-driven.`
    }
    cards.push({
      key: 'hardcoded_urls',
      title: 'Hardcoded URLs',
      prevalence: '60% of vibe-coded apps ship localhost or staging URLs',
      status,
      finding,
      why: 'AI copies dev URLs into source. Production deploys then point at localhost or wrong env — silent until a user hits the dead link.',
      fix: status === 'warn' ? 'Move URLs to `process.env.<NAME>` with a typed config layer (zod / valibot).' : null,
      evidence: h?.samples.map(s => `${s.file} · ${s.pattern}`),
    })
  }

  // 9. Mock data left in production
  {
    const m = vc?.mock_data
    let status: Status = 'pass'
    let finding = 'No inline mock-data arrays detected in app paths.'
    if (m && m.total > 0) {
      status = 'warn'
      finding = `${m.total} file${m.total === 1 ? '' : 's'} with hardcoded mock arrays · check before shipping.`
    }
    cards.push({
      key: 'mock_data',
      title: 'Mock data in production paths',
      prevalence: '55% of AI prototypes ship with seed arrays',
      status,
      finding,
      why: 'AI generates `const users = [{id:1,...}]` for prototyping and the production code keeps reading from it. Real database never gets hit; first user sees the seed data.',
      fix: status === 'warn' ? 'Replace mock arrays with real fetch calls; gate dev-only seeds behind `process.env.NODE_ENV === "development"`.' : null,
      evidence: m?.samples.map(s => `${s.file} · ${s.collection}`),
    })
  }

  // 10. Webhook signature verification
  {
    const w = vc?.webhook_signature
    let status: Status = 'pass'
    let finding = 'No webhook handlers detected — N/A.'
    if (w && w.handlers_seen > 0) {
      if (w.gap) {
        status = 'fail'
        finding = `${w.handlers_seen} webhook handler${w.handlers_seen === 1 ? '' : 's'} · 0 signature verification. Anyone can post fake events.`
      } else if (w.verified_seen >= w.handlers_seen) {
        status = 'pass'
        finding = `${w.verified_seen}/${w.handlers_seen} handlers verify signature.`
      } else {
        status = 'warn'
        finding = `${w.verified_seen}/${w.handlers_seen} handlers verify signature · partial coverage.`
      }
    } else {
      status = 'na'
    }
    cards.push({
      key: 'webhook_signature',
      title: 'Webhook signature verification',
      prevalence: '75% of webhook handlers ship without HMAC check',
      status,
      finding,
      why: 'Idempotency catches double-charges; signature verification stops fake events. Without HMAC validation an attacker can POST a "payment.succeeded" event and trigger your fulfillment.',
      fix: status === 'fail' ? 'Stripe → `stripe.webhooks.constructEvent()`. Slack → verify `x-slack-signature` HMAC. GitHub → verify `x-hub-signature-256`.' : null,
      evidence: w?.sample_files,
    })
  }

  // 11. CORS permissive
  {
    const c = vc?.cors_permissive
    let status: Status = 'pass'
    let finding = 'No `origin: *` CORS patterns detected.'
    if (c && c.total > 0) {
      status = 'warn'
      finding = `${c.total} file${c.total === 1 ? '' : 's'} with permissive CORS (\`origin: *\` or \`origin: true\`).`
    }
    cards.push({
      key: 'cors_permissive',
      title: 'CORS too permissive',
      prevalence: '50% of AI-coded APIs allow any origin',
      status,
      finding,
      why: 'AI copies `cors({ origin: "*" })` from a tutorial. In production any website can hit your API with the user\'s cookies — CSRF + token theft surface opens up.',
      fix: status === 'warn' ? 'Whitelist explicit origins: `cors({ origin: ["https://yourapp.com", "https://staging.yourapp.com"] })`.' : null,
      evidence: c?.samples.map(s => `${s.file} · ${s.pattern}`),
    })
  }

  return cards
}

function StatusDot({ status }: { status: Status }) {
  const map: Record<Status, { color: string; label: string }> = {
    pass: { color: '#22C55E', label: 'PASS' },
    warn: { color: '#F0C040', label: 'WARN' },
    fail: { color: '#C8102E', label: 'FAIL' },
    na:   { color: 'rgba(255,255,255,0.3)', label: 'N/A' },
  }
  const m = map[status]
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-widest" style={{ color: m.color }}>
      <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: m.color }} />
      {m.label}
    </span>
  )
}

interface Props {
  vibeConcerns: VibeConcerns | null | undefined
  // Optional intro line shown above the grid — can explain "this is the
  // vibe-coder checklist we run on every audit"
  showIntro?: boolean
}

export function VibeConcernsPanel({ vibeConcerns, showIntro = true }: Props) {
  const cards = evaluate(vibeConcerns)
  // Sort: fail first, warn second, pass third, na last — most decision-moving on top
  const order: Record<Status, number> = { fail: 0, warn: 1, pass: 2, na: 3 }
  cards.sort((a, b) => order[a.status] - order[b.status])

  const failCount = cards.filter(c => c.status === 'fail').length
  const warnCount = cards.filter(c => c.status === 'warn').length
  const passCount = cards.filter(c => c.status === 'pass').length

  return (
    <div className="my-6">
      {showIntro && (
        <div className="mb-4">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // AI CODER 7 FRAMES
          </div>
          <div className="font-light text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>
            Seven systematic failure modes AI tools ship without — the ones generic linters and Cursor's
            inline review don't catch. {' '}
            <span style={{ color: 'var(--cream)' }}>{cards.filter(c => c.status !== 'na').length}/{cards.length}</span> applied to this project.
          </div>
          <div className="mt-3 flex items-center gap-4 font-mono text-xs">
            {failCount > 0 && <span style={{ color: '#C8102E' }}>● {failCount} fail</span>}
            {warnCount > 0 && <span style={{ color: '#F0C040' }}>● {warnCount} warn</span>}
            {passCount > 0 && <span style={{ color: '#22C55E' }}>● {passCount} pass</span>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {cards.map(c => (
          <Card key={c.key} card={c} />
        ))}
      </div>
    </div>
  )
}

function Card({ card }: { card: CardData }) {
  const borderTone = card.status === 'fail' ? 'rgba(200,16,46,0.4)'
                   : card.status === 'warn' ? 'rgba(240,192,64,0.45)'
                   : card.status === 'pass' ? 'rgba(34,197,94,0.35)'
                                            : 'rgba(255,255,255,0.08)'
  const bgTone     = card.status === 'fail' ? 'rgba(200,16,46,0.05)'
                   : card.status === 'warn' ? 'rgba(240,192,64,0.05)'
                   : card.status === 'pass' ? 'rgba(34,197,94,0.04)'
                                            : 'rgba(255,255,255,0.02)'
  return (
    <div className="p-4" style={{
      background: bgTone,
      border: `1px solid ${borderTone}`,
      borderRadius: '2px',
    }}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="font-display font-bold text-sm" style={{ color: 'var(--cream)' }}>{card.title}</div>
        <StatusDot status={card.status} />
      </div>
      <div className="font-light text-[13px] mb-2" style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>
        {card.finding}
      </div>
      <div className="font-mono text-[10px] tracking-wide uppercase mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
        {card.prevalence}
      </div>
      <details className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
        <summary className="cursor-pointer font-mono text-[10px] tracking-widest uppercase mt-1" style={{ color: 'var(--gold-500)' }}>
          Why this matters {card.fix ? ' · How to fix' : ''}{card.evidence && card.evidence.length > 0 ? ' · Evidence' : ''}
        </summary>
        <div className="mt-2 space-y-2 font-light" style={{ lineHeight: 1.6 }}>
          <div><span className="font-mono text-[9px] tracking-widest mr-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>WHY</span>{card.why}</div>
          {card.fix && (
            <div><span className="font-mono text-[9px] tracking-widest mr-1.5" style={{ color: 'var(--gold-500)' }}>FIX</span>{card.fix}</div>
          )}
          {card.evidence && card.evidence.length > 0 && (
            <div>
              <span className="font-mono text-[9px] tracking-widest mr-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>EVIDENCE</span>
              <ul className="mt-1 space-y-0.5">
                {card.evidence.slice(0, 8).map((e, i) => (
                  <li key={i} className="font-mono text-[11px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    · {e}
                  </li>
                ))}
                {card.evidence.length > 8 && (
                  <li className="font-mono text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    + {card.evidence.length - 8} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </details>
    </div>
  )
}

// Compact one-row version for the project header — single-line summary
// "5 pass · 2 warn · 0 fail · expand to see full checklist"
export function VibeConcernsBadge({ vibeConcerns, onClick }: {
  vibeConcerns: VibeConcerns | null | undefined
  onClick?: () => void
}): ReactNode {
  const cards = evaluate(vibeConcerns)
  const fail = cards.filter(c => c.status === 'fail').length
  const warn = cards.filter(c => c.status === 'warn').length
  const pass = cards.filter(c => c.status === 'pass').length
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-3 px-3 py-1.5 font-mono text-[11px] tracking-wide"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '2px',
        color: 'var(--text-primary)',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span>VIBE CHECKLIST</span>
      {pass > 0 && <span style={{ color: '#22C55E' }}>✓ {pass}</span>}
      {warn > 0 && <span style={{ color: '#F0C040' }}>⚠ {warn}</span>}
      {fail > 0 && <span style={{ color: '#C8102E' }}>✕ {fail}</span>}
    </button>
  )
}
