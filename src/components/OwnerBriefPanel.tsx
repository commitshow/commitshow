import { useEffect, useState } from 'react'
import { supabase, type BuildBrief } from '../lib/supabase'

interface Props {
  projectId: string
}

/**
 * Private dashboard of the creator's Build Brief Phase 2 fields
 * (Stack Fingerprint · Failure Log · Decision Archaeology · AI Delegation Map
 * · Next Blocker · integrity). Rendered on the detail page for the project's
 * owner only. Public viewers see nothing — Phase 2 stays private until
 * graduation per CLAUDE.md §12.
 */
export function OwnerBriefPanel({ projectId }: Props) {
  const [brief, setBrief] = useState<BuildBrief | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('build_briefs')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle()
      setBrief(data as BuildBrief | null)
      setLoading(false)
    })()
  }, [projectId])

  if (loading) return null
  if (!brief) return null

  const stack = brief.stack_fingerprint ?? {}
  const failures = (brief.failure_log ?? []) as Array<{ symptom: string; cause: string; fix: string; prevention?: string }>
  const decisions = (brief.decision_archaeology ?? []) as Array<{ original_plan?: string; final_choice?: string; outcome?: string; chose?: string; over?: string; reason?: string }>
  const delegation = (brief.ai_delegation_map ?? []) as Array<{ domain: string; ai_pct: number; human_pct: number; notes?: string }>
  const liveProof = (brief.live_proof ?? {}) as Record<string, string | undefined>

  const stackOrder: Array<{ key: string; label: string }> = [
    { key: 'runtime',      label: 'Runtime' },
    { key: 'frontend',     label: 'Frontend' },
    { key: 'backend',      label: 'Backend' },
    { key: 'database',     label: 'Database' },
    { key: 'infra',        label: 'Infra' },
    { key: 'ai_layer',     label: 'AI layer' },
    { key: 'external_api', label: 'External APIs' },
    { key: 'auth',         label: 'Auth' },
    { key: 'special',      label: 'Special' },
  ]

  return (
    <div className="card-navy p-6 space-y-6" style={{ borderRadius: '2px', borderColor: 'rgba(240,192,64,0.25)' }}>
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // PRIVATE DASHBOARD · OWNER ONLY
          </div>
          <h3 className="font-display font-bold text-lg mt-1" style={{ color: 'var(--cream)' }}>
            Build Brief (Phase 2 details)
          </h3>
          <p className="font-mono text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            The public only sees the summary. These specifics unlock for everyone once this build earns Encore.
          </p>
        </div>
        <span className="font-mono text-xs px-2 py-1" style={{
          background: 'rgba(240,192,64,0.1)',
          border: '1px solid rgba(240,192,64,0.35)',
          color: 'var(--gold-500)',
          borderRadius: '2px',
        }}>
          Integrity {brief.integrity_score} / 10
        </span>
      </div>

      {/* Stack fingerprint */}
      <BriefSection title="STACK FINGERPRINT">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
          {stackOrder.map(({ key, label }) => {
            const v = (stack as Record<string, string | undefined>)[key]
            return <KV key={key} k={label} v={v ?? ''} />
          })}
        </div>
      </BriefSection>

      {/* Failure log */}
      <BriefSection title={`FAILURE LOG · ${failures.length} entr${failures.length === 1 ? 'y' : 'ies'}`}>
        {failures.length === 0 && <Empty />}
        {failures.map((f, i) => (
          <div key={i} className="mb-3 pb-3 last:mb-0 last:pb-0" style={{ borderBottom: i < failures.length - 1 ? '1px dashed rgba(255,255,255,0.05)' : 'none' }}>
            <div className="font-mono text-xs font-medium mb-1" style={{ color: 'var(--cream)' }}>
              #{i + 1} · {f.symptom || '—'}
            </div>
            {f.cause      && <Row label="Cause"      value={f.cause} />}
            {f.fix        && <Row label="Fix"        value={f.fix} />}
            {f.prevention && <Row label="Prevention" value={f.prevention} />}
          </div>
        ))}
      </BriefSection>

      {/* Decision archaeology */}
      <BriefSection title={`DECISION ARCHAEOLOGY · ${decisions.length} entr${decisions.length === 1 ? 'y' : 'ies'}`}>
        {decisions.length === 0 && <Empty />}
        {decisions.map((d, i) => {
          const originalPlan = d.original_plan ?? d.over ?? ''
          const finalChoice  = d.final_choice  ?? d.chose ?? ''
          const outcome      = d.outcome ?? d.reason ?? ''
          return (
            <div key={i} className="mb-2">
              <div className="font-mono text-xs" style={{ color: 'var(--cream)' }}>
                #{i + 1} · <span style={{ color: 'var(--text-secondary)' }}>{originalPlan || '?'}</span>
                <span style={{ color: 'rgba(248,245,238,0.35)' }}> → </span>
                <span style={{ color: 'var(--gold-500)' }}>{finalChoice || '?'}</span>
              </div>
              {outcome && <Row label="Outcome" value={outcome} />}
            </div>
          )
        })}
      </BriefSection>

      {/* AI delegation map */}
      <BriefSection title={`AI DELEGATION MAP · ${delegation.length} rows`}>
        {delegation.length === 0 && <Empty />}
        {delegation.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-3 py-1 text-xs items-center">
            <span style={{ color: 'var(--cream)' }}>{r.domain}</span>
            <span className="font-mono">
              <span style={{ color: '#7B6CD9' }}>AI {r.ai_pct}%</span>
              <span style={{ color: 'rgba(248,245,238,0.3)' }}> · </span>
              <span style={{ color: 'var(--cream)' }}>Me {r.human_pct}%</span>
            </span>
          </div>
        ))}
      </BriefSection>

      {/* Live proof */}
      <BriefSection title="LIVE PROOF">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
          <KV k="Deployed URL"  v={liveProof.deployed_url ?? ''} />
          <KV k="GitHub URL"    v={liveProof.github_url ?? ''} />
          <KV k="API"           v={liveProof.api_endpoints ?? liveProof.api_url ?? ''} />
          <KV k="On-chain"      v={liveProof.contract_addresses ?? liveProof.contract_addr ?? ''} />
          <KV k="Other"         v={liveProof.other_evidence ?? ''} />
        </div>
      </BriefSection>

      {/* Next blocker */}
      {brief.next_blocker && (
        <BriefSection title="NEXT BLOCKER">
          <p className="text-xs font-light whitespace-pre-line" style={{ color: 'var(--text-primary)', lineHeight: 1.65 }}>
            {brief.next_blocker}
          </p>
        </BriefSection>
      )}
    </div>
  )
}

function BriefSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--text-label)' }}>{title}</div>
      <div className="pl-3" style={{ borderLeft: '1px solid rgba(240,192,64,0.15)' }}>{children}</div>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  const missing = !v || v === '?'
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-0.5 text-xs">
      <span className="font-mono uppercase" style={{ color: 'var(--text-muted)' }}>{k}</span>
      <span style={{ color: missing ? 'rgba(248,120,113,0.6)' : 'var(--cream)', lineHeight: 1.55 }}>
        {v || '(empty)'}
      </span>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
      → {label}: {value}
    </div>
  )
}

function Empty() {
  return <div className="text-xs" style={{ color: 'rgba(248,120,113,0.7)' }}>No entries.</div>
}
