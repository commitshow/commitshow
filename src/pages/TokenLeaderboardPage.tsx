// /tokens · person-level token leaderboard (primary surface).
//
// Two tabs:
//   1. Verified · backed by `commitshow extract` (Claude Code) · trusted
//   2. Efficiency · score-per-1M-tokens leaderboard · the "token-maxxing
//      vs token-efficient" contrast — same data, different sort.
//
// Self-reported tier is gated to V1.5+ · we only ship verified data
// from the Claude Code path until the form/CLI flow has matured.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Tab = 'top' | 'efficiency'

interface TopRow {
  member_id:      string
  display_name:   string | null
  avatar_url:     string | null
  total_tokens:   number
  input_tokens:   number
  output_tokens:  number
  cache_create:   number
  cache_read:     number
  cost_usd:       number
  project_count:  number
  best_project_id:    string | null
  best_project_name:  string | null
  best_project_score: number | null
}

interface EffRow {
  project_id:       string
  project_name:     string
  score:            number
  total_tokens:     number
  efficiency_score: number
  member_id:        string | null
  display_name:     string | null
}

function fmtNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`
  return `$${n.toFixed(2)}`
}

export function TokenLeaderboardPage() {
  const [tab, setTab] = useState<Tab>('top')
  const [topRows, setTopRows] = useState<TopRow[] | null>(null)
  const [effRows, setEffRows] = useState<EffRow[] | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (tab === 'top' && topRows === null) {
        const { data, error } = await supabase.rpc('top_token_consumers', {
          p_source: 'claude_code',
          p_limit:  20,
        })
        if (!alive) return
        if (error) { console.error('top_token_consumers', error); setTopRows([]) }
        else setTopRows((data ?? []) as TopRow[])
      }
      if (tab === 'efficiency' && effRows === null) {
        const { data, error } = await supabase.rpc('top_token_efficiency', {
          p_source:     'claude_code',
          p_min_tokens: 100000,
          p_limit:      20,
        })
        if (!alive) return
        if (error) { console.error('top_token_efficiency', error); setEffRows([]) }
        else setEffRows((data ?? []) as EffRow[])
      }
    })()
    return () => { alive = false }
  }, [tab])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="mb-6">
          <Link to="/map" className="font-mono text-xs tracking-wide" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
            ← BACK TO AUDIT × SCOUT MAP
          </Link>
          <div className="font-mono text-xs tracking-widest mt-3 mb-2" style={{ color: 'var(--gold-500)' }}>
            // TOKEN LEADERBOARD · CLAUDE CODE
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl mb-2" style={{ color: 'var(--cream)' }}>
            Token-maxxers · with receipts
          </h1>
          <p className="font-light max-w-2xl" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Verified by your own Claude Code session log. Run{' '}
            <code className="font-mono text-xs px-1.5 py-0.5" style={{ background: 'rgba(240,192,64,0.12)', color: 'var(--gold-500)', borderRadius: '2px' }}>
              npx commitshow@latest extract
            </code>{' '}
            and paste the blob into your project's audition form.
          </p>
        </header>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-6">
          <TabButton active={tab === 'top'}        onClick={() => setTab('top')}>
            Most spent
          </TabButton>
          <TabButton active={tab === 'efficiency'} onClick={() => setTab('efficiency')}>
            Best efficiency
          </TabButton>
        </div>

        {/* Content */}
        {tab === 'top' ? (
          <TopList rows={topRows} />
        ) : (
          <EfficiencyList rows={effRows} />
        )}

        {/* Disclaimer */}
        <p className="mt-8 font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Receipt source · ~/.claude/projects/&lt;cwd-encoded&gt;/&lt;session&gt;.jsonl ·
          tokens extracted client-side · prompt content never leaves your machine.
        </p>
      </div>
    </section>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono text-xs tracking-wide px-3 py-1.5"
      style={{
        background:   active ? 'var(--gold-500)' : 'transparent',
        color:        active ? 'var(--navy-900)' : 'var(--gold-500)',
        border:       active ? 'none' : '1px solid rgba(240,192,64,0.4)',
        borderRadius: '2px',
        cursor:       'pointer',
        fontWeight:   active ? 600 : 400,
      }}
    >
      {children}
    </button>
  )
}

function TopList({ rows }: { rows: TopRow[] | null }) {
  if (rows === null) return <SkeletonList />
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nobody's submitted a receipt yet."
        body="Be the first · run `npx commitshow extract` and drop the blob on your project's page."
      />
    )
  }
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.member_id}>
          <div
            className="grid items-center gap-3 px-3 py-3"
            style={{
              gridTemplateColumns: 'auto 1fr auto auto',
              background: 'rgba(255,255,255,0.025)',
              borderLeft: `2px solid ${i === 0 ? 'var(--gold-500)' : 'rgba(240,192,64,0.25)'}`,
              borderRadius: '0 2px 2px 0',
            }}
          >
            <span className="font-mono text-xs tabular-nums" style={{ color: 'var(--text-muted)', width: 22 }}>
              {i + 1}.
            </span>
            <div className="min-w-0">
              <div className="font-display font-bold truncate" style={{ color: 'var(--cream)' }}>
                {r.display_name ?? 'anon'}
              </div>
              <div className="font-mono text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {r.project_count} project{r.project_count === 1 ? '' : 's'}
                {r.best_project_name && (
                  <>
                    {' · best · '}
                    <Link to={`/projects/${r.best_project_id}`} style={{ color: 'var(--text-secondary)' }}>
                      {r.best_project_name}
                    </Link>
                    {r.best_project_score != null && r.best_project_score > 0 ? ` (${r.best_project_score}/100)` : ''}
                  </>
                )}
              </div>
            </div>
            <span className="font-mono text-xs tabular-nums hidden sm:inline" style={{ color: 'var(--text-secondary)' }}>
              {fmtUsd(r.cost_usd)}
            </span>
            <span className="font-display font-bold tabular-nums" style={{ color: 'var(--gold-500)', minWidth: 64, textAlign: 'right' }}>
              {fmtNumber(r.total_tokens)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}

function EfficiencyList({ rows }: { rows: EffRow[] | null }) {
  if (rows === null) return <SkeletonList />
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Not enough verified projects yet."
        body="The efficiency leaderboard needs ≥ 100K tokens of receipts per project. Drop yours and the chart fills in."
      />
    )
  }
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.project_id}>
          <Link
            to={`/projects/${r.project_id}`}
            className="grid items-center gap-3 px-3 py-3"
            style={{
              gridTemplateColumns: 'auto 1fr auto auto',
              background: 'rgba(255,255,255,0.025)',
              borderLeft: `2px solid ${i === 0 ? '#3FA874' : 'rgba(63,168,116,0.4)'}`,
              borderRadius: '0 2px 2px 0',
              textDecoration: 'none',
            }}
          >
            <span className="font-mono text-xs tabular-nums" style={{ color: 'var(--text-muted)', width: 22 }}>
              {i + 1}.
            </span>
            <div className="min-w-0">
              <div className="font-display font-bold truncate" style={{ color: 'var(--cream)' }}>
                {r.project_name}
              </div>
              <div className="font-mono text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {r.display_name ?? 'anon'} · score {r.score}/100 · {fmtNumber(r.total_tokens)} tokens
              </div>
            </div>
            <span className="font-mono text-xs hidden sm:inline" style={{ color: 'var(--text-secondary)' }}>
              eff
            </span>
            <span className="font-display font-bold tabular-nums" style={{ color: '#3FA874', minWidth: 64, textAlign: 'right' }}>
              {Number(r.efficiency_score).toFixed(2)}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  )
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-12" style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '2px' }} />
      ))}
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="card-navy p-8 text-center" style={{ borderRadius: '2px', border: '1px solid rgba(240,192,64,0.18)' }}>
      <div className="font-display font-bold text-xl mb-2" style={{ color: 'var(--cream)' }}>{title}</div>
      <p className="font-light" style={{ color: 'var(--text-secondary)' }}>{body}</p>
    </div>
  )
}
