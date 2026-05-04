// Public-facing Backstage panel — surfaces the Phase 2 brief data on a
// project detail page. Per CLAUDE.md §12, Phase 2 (Stack Fingerprint ·
// Failure Log · Decision Archaeology · AI Delegation Map · Live Proof ·
// Next Blocker) is private until Encore (score ≥ 84), then permanently public.
//
// This component shows:
//   · Encore products    → full content + Verified mark
//   · below the bar       → locked teaser with counts (proves data exists)
//   · no brief           → renders nothing (don't tease emptiness)
//
// Owner still has the editable OwnerBriefPanel below this, separately.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, type BuildBrief, type Project } from '../lib/supabase'

interface Props {
  project: Project
}

// 2026-05-05 rebrand · was status-based ('graduated'/'valedictorian'/...).
// Backstage is now Encore-gated · score_total ≥ 84 unlocks the panel,
// score below keeps it teased. Score is the only thing that earns the
// reveal, consistent with the rest of the rebrand.
import { isEncoreScore } from '../lib/encore'

export function BackstagePanel({ project }: Props) {
  const [brief, setBrief] = useState<BuildBrief | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('build_briefs')
        .select('*')
        .eq('project_id', project.id)
        .maybeSingle()
      setBrief(data as BuildBrief | null)
      setLoading(false)
    })()
  }, [project.id])

  if (loading) return null
  if (!brief)  return null

  const failures   = (brief.failure_log         ?? []) as Array<{ symptom: string; cause: string; fix: string; prevention?: string }>
  const decisions  = (brief.decision_archaeology ?? []) as Array<{ original_plan?: string; final_choice?: string; outcome?: string; chose?: string; over?: string; reason?: string }>
  const delegation = (brief.ai_delegation_map    ?? []) as Array<{ domain: string; ai_pct: number; human_pct: number; notes?: string }>
  const stack      = (brief.stack_fingerprint    ?? {}) as Record<string, string | undefined>
  const liveProof  = (brief.live_proof           ?? {}) as Record<string, string | undefined>

  const totalDocumented = failures.length + decisions.length + delegation.length
  if (totalDocumented === 0 && !brief.next_blocker) return null

  const unlocked = isEncoreScore(project.score_total)

  return (
    <div
      className="card-navy p-6 space-y-5"
      style={{
        borderRadius: '2px',
        borderColor: unlocked ? 'rgba(240,192,64,0.35)' : 'rgba(255,255,255,0.08)',
      }}
    >
      {/* Header — same shape locked or unlocked */}
      <div className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // BACKSTAGE
          </div>
          <h3 className="font-display font-bold text-lg mt-1" style={{ color: 'var(--cream)' }}>
            What this Creator documented
          </h3>
          <p className="font-mono text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {unlocked
              ? 'Frozen at season-end · permanent record · the data nobody else captures.'
              : 'Filed at audit. Unlocks publicly when this project graduates.'}
          </p>
        </div>
        {unlocked ? (
          <span
            className="font-mono text-[10px] tracking-widest uppercase px-2 py-1"
            style={{
              background: 'rgba(0,212,170,0.12)',
              border: '1px solid rgba(0,212,170,0.4)',
              color: '#00D4AA',
              borderRadius: '2px',
            }}
          >
            Backstage Verified
          </span>
        ) : (
          <span
            className="font-mono text-[10px] tracking-widest uppercase px-2 py-1"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text-muted)',
              borderRadius: '2px',
            }}
          >
            Locked · graduates only
          </span>
        )}
      </div>

      {/* Counts strip — always visible · proves data exists */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="FAILURES"        value={failures.length}    suffix={failures.length === 1 ? 'entry' : 'entries'} />
        <Stat label="DECISIONS"       value={decisions.length}   suffix={decisions.length === 1 ? 'entry' : 'entries'} />
        <Stat label="DELEGATION"      value={delegation.length}  suffix={delegation.length === 1 ? 'row'   : 'rows'} />
        <Stat label="INTEGRITY"       value={brief.integrity_score ?? 0} suffix="/ 10" />
      </div>

      {unlocked ? (
        <UnlockedBody
          stack={stack}
          failures={failures}
          decisions={decisions}
          delegation={delegation}
          liveProof={liveProof}
          nextBlocker={brief.next_blocker}
        />
      ) : (
        <LockedTeaser projectName={project.project_name} />
      )}
    </div>
  )
}

function Stat({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '2px', border: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="font-display font-bold mt-0.5" style={{ color: 'var(--cream)' }}>
        <span className="text-xl">{value}</span>
        <span className="font-mono text-[10px] ml-1" style={{ color: 'var(--text-secondary)' }}>{suffix}</span>
      </div>
    </div>
  )
}

function LockedTeaser({ projectName }: { projectName: string }) {
  return (
    <div
      className="px-4 py-5 text-center"
      style={{
        background: 'rgba(240,192,64,0.04)',
        border: '1px dashed rgba(240,192,64,0.18)',
        borderRadius: '2px',
      }}
    >
      <div className="font-mono text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
        The full record stays sealed until <span style={{ color: 'var(--cream)' }}>{projectName}</span> graduates.
      </div>
      <div className="font-light text-xs mb-4" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Failure log · decisions · delegation map · next blocker · live proof —
        the entries above are real. Their content unlocks when the product earns Encore (score 84+).
      </div>
      <Link
        to="/backstage"
        className="font-mono text-xs tracking-wide inline-block px-4 py-2"
        style={{
          color: 'var(--gold-500)',
          border: '1px solid rgba(240,192,64,0.4)',
          borderRadius: '2px',
          textDecoration: 'none',
        }}
      >
        What is Backstage? →
      </Link>
    </div>
  )
}

function UnlockedBody({
  stack, failures, decisions, delegation, liveProof, nextBlocker,
}: {
  stack:      Record<string, string | undefined>
  failures:   Array<{ symptom: string; cause: string; fix: string; prevention?: string }>
  decisions:  Array<{ original_plan?: string; final_choice?: string; outcome?: string; chose?: string; over?: string; reason?: string }>
  delegation: Array<{ domain: string; ai_pct: number; human_pct: number; notes?: string }>
  liveProof:  Record<string, string | undefined>
  nextBlocker: string | null | undefined
}) {
  const stackOrder: Array<{ key: string; label: string }> = [
    { key: 'runtime',      label: 'Runtime' },
    { key: 'frontend',     label: 'Frontend' },
    { key: 'backend',      label: 'Backend' },
    { key: 'database',     label: 'Database' },
    { key: 'infra',        label: 'Infra' },
    { key: 'ai_layer',     label: 'AI layer' },
    { key: 'external_api', label: 'External APIs' },
    { key: 'auth',         label: 'Auth' },
  ]

  return (
    <div className="space-y-5">
      {/* Stack */}
      <BSection title="STACK FINGERPRINT">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
          {stackOrder.map(({ key, label }) => {
            const v = stack[key]
            if (!v) return null
            return <KV key={key} k={label} v={v} />
          })}
        </div>
      </BSection>

      {/* Failure Log */}
      {failures.length > 0 && (
        <BSection title={`FAILURE LOG · ${failures.length} entr${failures.length === 1 ? 'y' : 'ies'}`}>
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
        </BSection>
      )}

      {/* Decisions */}
      {decisions.length > 0 && (
        <BSection title={`DECISION ARCHAEOLOGY · ${decisions.length} entr${decisions.length === 1 ? 'y' : 'ies'}`}>
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
        </BSection>
      )}

      {/* Delegation */}
      {delegation.length > 0 && (
        <BSection title={`AI DELEGATION MAP · ${delegation.length} rows`}>
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
        </BSection>
      )}

      {/* Live Proof */}
      <BSection title="LIVE PROOF">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
          {liveProof.deployed_url      && <KV k="Deployed URL" v={liveProof.deployed_url} />}
          {liveProof.github_url        && <KV k="GitHub URL"   v={liveProof.github_url} />}
          {(liveProof.api_endpoints || liveProof.api_url) && (
            <KV k="API" v={liveProof.api_endpoints ?? liveProof.api_url ?? ''} />
          )}
          {(liveProof.contract_addresses || liveProof.contract_addr) && (
            <KV k="On-chain" v={liveProof.contract_addresses ?? liveProof.contract_addr ?? ''} />
          )}
          {liveProof.other_evidence    && <KV k="Other"        v={liveProof.other_evidence} />}
        </div>
      </BSection>

      {/* Next blocker */}
      {nextBlocker && (
        <BSection title="NEXT BLOCKER">
          <p className="text-xs font-light whitespace-pre-line" style={{ color: 'var(--text-primary)', lineHeight: 1.65 }}>
            {nextBlocker}
          </p>
        </BSection>
      )}
    </div>
  )
}

function BSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--text-label)' }}>{title}</div>
      <div className="pl-3" style={{ borderLeft: '1px solid rgba(240,192,64,0.15)' }}>{children}</div>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-0.5 text-xs">
      <span className="font-mono uppercase" style={{ color: 'var(--text-muted)' }}>{k}</span>
      <span style={{ color: 'var(--cream)', lineHeight: 1.55 }}>{v}</span>
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
