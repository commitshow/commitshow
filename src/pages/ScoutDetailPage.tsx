// /scouts/:id · per-scout JUDGMENT activity.
//
// Shows the scout's forecast track record + applaud feed. Specifically
// scoped to the "judging" side of a member's activity — a creator
// landing here from /scouts uses this to decide whether to weigh this
// scout's vote on their product. Builder-side activity (their own
// products / audits) lives on /creators/:id (CreatorDetailPage).

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  supabase,
  PUBLIC_MEMBER_COLUMNS,
  type Member,
  type ScoutTier,
} from '../lib/supabase'
import { TrustLevelChip } from '../components/TrustLevelChip'

// Tier palette · mirrors ScoutsPage (kept inline so the detail page
// doesn't depend on supabase.ts re-exporting display constants).
const TIER_COLOR: Record<ScoutTier, string> = {
  Bronze:   '#CD7F32',
  Silver:   '#C0C0C0',
  Gold:     '#F0C040',
  Platinum: '#E5E4E2',
}

interface VoteRow {
  id:             string
  created_at:     string
  project_id:     string
  vote_count:     number
  predicted_score: number | null
  is_correct:     boolean | null
  spotter_tier:   'first' | 'early' | 'spotter' | null
  project_name:   string | null
  score_total:    number | null
}

interface ApplaudRow {
  id:           string
  created_at:   string
  target_type:  'product' | 'comment' | 'build_log' | 'stack' | 'brief' | 'recommit' | string
  target_id:    string
  target_label: string | null    // resolved best-effort per type
  target_link:  string | null
}

interface SupportRow {
  project_id:         string
  first_voted_at:     string
  last_voted_at:      string
  vote_count_total:   number
  first_spotter_tier: 'first' | 'early' | 'spotter' | null
  project_name:       string | null
  score_total:        number | null
  score_at_first_vote: number | null   // pulled from analysis_snapshots closest to first_voted_at
}

interface MemberStatsExt extends Member {
  total_votes_cast?:     number
  total_applauds_given?: number
  forecast_accuracy?:    number | null  // 0-100
  graduated_count?:      number
  spotter_hits?:         { first: number; early: number; spotter: number }
  supporting_count?:     number
}

export function ScoutDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [member, setMember]     = useState<MemberStatsExt | null>(null)
  const [votes, setVotes]       = useState<VoteRow[]>([])
  const [applauds, setApplauds] = useState<ApplaudRow[]>([])
  const [supports, setSupports] = useState<SupportRow[]>([])
  const [loaded, setLoaded]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    setLoaded(false); setError(null)
    ;(async () => {
      // 1. Member core (public columns + a few aggregates that ScoutsPage uses).
      const { data: m, error: e } = await supabase
        .from('members')
        .select(PUBLIC_MEMBER_COLUMNS)
        .eq('id', id)
        .maybeSingle()
      if (!alive) return
      if (e) { setError(e.message); setLoaded(true); return }
      if (!m) { setError('Scout not found.'); setLoaded(true); return }

      const memberCore = m as unknown as MemberStatsExt

      // 2. Aggregates · counts only (cheap RPC-less path).
      const [votesAgg, applaudsAgg, supportingCount] = await Promise.all([
        supabase.from('votes').select('id, is_correct, spotter_tier', { count: 'exact', head: false }).eq('member_id', id),
        supabase.from('applauds').select('id', { count: 'exact', head: true }).eq('member_id', id),
        supabase.from('supporters').select('id', { count: 'exact', head: true }).eq('supporter_id', id),
      ])
      const totalVotes = votesAgg.count ?? 0
      const voteAggRows = (votesAgg.data ?? []) as Array<{ is_correct: boolean | null; spotter_tier: 'first' | 'early' | 'spotter' | null }>
      const correctVotes = voteAggRows.filter(v => v.is_correct === true).length
      const evaluatedVotes = voteAggRows.filter(v => v.is_correct !== null).length
      memberCore.total_votes_cast     = totalVotes
      memberCore.total_applauds_given = applaudsAgg.count ?? 0
      memberCore.forecast_accuracy    = evaluatedVotes > 0 ? Math.round((correctVotes / evaluatedVotes) * 100) : null
      memberCore.supporting_count     = supportingCount.count ?? 0
      memberCore.spotter_hits = {
        first:   voteAggRows.filter(v => v.spotter_tier === 'first').length,
        early:   voteAggRows.filter(v => v.spotter_tier === 'early').length,
        spotter: voteAggRows.filter(v => v.spotter_tier === 'spotter').length,
      }

      // 3. Recent vote rows + project name lookup.
      const { data: vRaw } = await supabase
        .from('votes')
        .select('id, created_at, project_id, vote_count, predicted_score, is_correct, spotter_tier')
        .eq('member_id', id)
        .order('created_at', { ascending: false })
        .limit(15)
      const projectIds = Array.from(new Set(((vRaw ?? []) as Array<{ project_id: string }>).map(v => v.project_id)))
      const { data: pjRows } = projectIds.length > 0
        ? await supabase.from('projects').select('id, project_name, score_total').in('id', projectIds)
        : { data: [] as Array<{ id: string; project_name: string; score_total: number | null }> }
      const pjMap = new Map<string, { project_name: string; score_total: number | null }>(
        ((pjRows as Array<{ id: string; project_name: string; score_total: number | null }>) ?? [])
          .map(p => [p.id, { project_name: p.project_name, score_total: p.score_total }]),
      )
      const voteRows: VoteRow[] = ((vRaw ?? []) as Array<{
        id: string; created_at: string; project_id: string; vote_count: number;
        predicted_score: number | null; is_correct: boolean | null;
        spotter_tier: 'first' | 'early' | 'spotter' | null
      }>).map(v => ({
        id:              v.id,
        created_at:      v.created_at,
        project_id:      v.project_id,
        vote_count:      v.vote_count,
        predicted_score: v.predicted_score,
        is_correct:      v.is_correct,
        spotter_tier:    v.spotter_tier,
        project_name:    pjMap.get(v.project_id)?.project_name ?? null,
        score_total:     pjMap.get(v.project_id)?.score_total ?? null,
      }))

      // 4. Recent applauds · resolve best-effort labels.
      const { data: aRaw } = await supabase
        .from('applauds')
        .select('id, created_at, target_type, target_id')
        .eq('member_id', id)
        .order('created_at', { ascending: false })
        .limit(15)
      const aRows = ((aRaw ?? []) as Array<{ id: string; created_at: string; target_type: string; target_id: string }>)
      // Resolve product target_ids → project_name for the most common case.
      const productIds = aRows.filter(a => a.target_type === 'product').map(a => a.target_id)
      const { data: aPjRows } = productIds.length > 0
        ? await supabase.from('projects').select('id, project_name').in('id', productIds)
        : { data: [] as Array<{ id: string; project_name: string }> }
      const aPjMap = new Map<string, string>(
        ((aPjRows as Array<{ id: string; project_name: string }>) ?? []).map(p => [p.id, p.project_name]),
      )
      const applaudRows: ApplaudRow[] = aRows.map(a => {
        if (a.target_type === 'product') {
          return { ...a, target_label: aPjMap.get(a.target_id) ?? null, target_link: `/projects/${a.target_id}` }
        }
        return { ...a, target_label: null, target_link: null }
      })

      // 5. Supporting · the scout's slate. Sorted by first_voted_at DESC
      //    (most recent backings on top — feels like a feed). For each
      //    supported project we fetch the LATEST snapshot at-or-before
      //    first_voted_at so the page can show "called it at 67 · now 79".
      const { data: supRaw } = await supabase
        .from('supporters')
        .select('project_id, first_voted_at, last_voted_at, vote_count_total, first_spotter_tier')
        .eq('supporter_id', id)
        .order('first_voted_at', { ascending: false })
        .limit(50)
      const supRows = ((supRaw ?? []) as Array<{
        project_id: string; first_voted_at: string; last_voted_at: string;
        vote_count_total: number; first_spotter_tier: 'first' | 'early' | 'spotter' | null
      }>)
      const supProjIds = Array.from(new Set(supRows.map(s => s.project_id)))
      const { data: supProjRows } = supProjIds.length > 0
        ? await supabase.from('projects').select('id, project_name, score_total').in('id', supProjIds)
        : { data: [] as Array<{ id: string; project_name: string; score_total: number | null }> }
      const supProjMap = new Map<string, { project_name: string; score_total: number | null }>(
        ((supProjRows as Array<{ id: string; project_name: string; score_total: number | null }>) ?? [])
          .map(p => [p.id, { project_name: p.project_name, score_total: p.score_total }]),
      )
      // Score-at-first-vote · pull the snapshot whose created_at is the
      // greatest ≤ first_voted_at for each project. Cheaper to do it as
      // one query per project (capped 50) than a giant JOIN — supports
      // are read on profile only, not in hot paths.
      const scoreAtFirst: Record<string, number | null> = {}
      await Promise.all(supRows.map(async (s) => {
        const { data: sn } = await supabase
          .from('analysis_snapshots')
          .select('score_total')
          .eq('project_id', s.project_id)
          .lte('created_at', s.first_voted_at)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        scoreAtFirst[s.project_id] = (sn as { score_total: number | null } | null)?.score_total ?? null
      }))
      const supportRows: SupportRow[] = supRows.map(s => ({
        ...s,
        project_name:        supProjMap.get(s.project_id)?.project_name ?? null,
        score_total:         supProjMap.get(s.project_id)?.score_total ?? null,
        score_at_first_vote: scoreAtFirst[s.project_id] ?? null,
      }))

      if (!alive) return
      setMember(memberCore)
      setVotes(voteRows)
      setApplauds(applaudRows)
      setSupports(supportRows)
      setLoaded(true)
    })()
    return () => { alive = false }
  }, [id])

  const tier = (member?.tier as ScoutTier | undefined) ?? null
  const tierColor = tier ? TIER_COLOR[tier] : 'var(--text-muted)'
  const initial = (member?.display_name ?? 'M').slice(0, 1).toUpperCase()

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <Link to="/scouts" className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>← Scouts</Link>
        <div className="font-mono text-[10px] tracking-widest mt-3 mb-1" style={{ color: 'var(--gold-500)' }}>// SCOUT ACTIVITY</div>
        {!loaded && <div className="mt-8 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>loading scout…</div>}
        {loaded && error && <div className="mt-8 font-mono text-xs" style={{ color: 'var(--scarlet)' }}>{error}</div>}
        {loaded && !error && member && (
          <>
            {/* Hero */}
            <div className="mt-4 mb-6 grid gap-4 md:grid-cols-[88px_minmax(0,1fr)] items-start">
              <div className="flex items-center justify-center font-mono font-bold overflow-hidden flex-shrink-0"
                   style={{
                     width: 88, height: 88,
                     background: member.avatar_url ? 'var(--navy-800)' : tierColor,
                     color: 'var(--navy-900)',
                     border: '1px solid rgba(240,192,64,0.25)',
                     borderRadius: '2px',
                     fontSize: 28,
                   }}>
                {member.avatar_url
                  ? <img src={member.avatar_url} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
                  : initial}
              </div>
              <div className="min-w-0">
                <h1 className="font-display font-black text-3xl md:text-4xl mb-1 flex items-center gap-2 flex-wrap" style={{ color: 'var(--cream)' }}>
                  {member.display_name ?? 'Member'}
                  <TrustLevelChip level={member.trust_level} earnedAt={member.trust_level_at} />
                </h1>
                <div className="font-mono text-[11px] flex flex-wrap items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                  <span style={{ color: tierColor }}>{tier ?? 'Bronze'} Scout</span>
                  <span>·</span>
                  <span>Creator {member.creator_grade ?? 'Rookie'}</span>
                  {member.x_handle && <><span>·</span><a href={`https://x.com/${member.x_handle}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)' }}>@{member.x_handle}</a></>}
                  {member.github_handle && <><span>·</span><a href={`https://github.com/${member.github_handle}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)' }}>github.com/{member.github_handle}</a></>}
                </div>
              </div>
            </div>

            {/* Stats grid · Supporting before Accuracy because the rooting
                relationship is the more useful long-running signal — accuracy
                lights up only after season-end resolution. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <Stat label="Activity points" value={member.activity_points ?? 0} />
              <Stat label="Votes cast"      value={member.total_votes_cast ?? 0} />
              <Stat label="Supporting"      value={member.supporting_count ?? 0} hint="distinct projects" />
              <Stat label="Forecast accuracy" value={member.forecast_accuracy != null ? `${member.forecast_accuracy}%` : '—'} hint="evaluated votes only" />
            </div>

            {/* Spotter hits · only show if there's at least one (cold scout
                shouldn't see four zeros). Tooltip explains the bonuses. */}
            {member.spotter_hits && (member.spotter_hits.first + member.spotter_hits.early + member.spotter_hits.spotter) > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-6">
                <Stat label="First Spotter"  value={member.spotter_hits.first}   hint="≤ 24h after audit" tone="gold" />
                <Stat label="Early Spotter"  value={member.spotter_hits.early}   hint="≤ 3 days" tone="gold" />
                <Stat label="Spotter"        value={member.spotter_hits.spotter} hint="≤ 14 days" tone="gold" />
              </div>
            )}

            {/* Supporting · the slate. One row per distinct project the
                scout has voted on. Shows score-at-first-vote → current,
                so a visitor can see "called it at 67 · now 79 · +12 since".
                Sorted newest support first. */}
            <Section title="Supporting" emptyHint="Not supporting any product yet.">
              {supports.length > 0 && (
                <ol className="grid gap-1.5">
                  {supports.map(s => {
                    const initialScore = s.score_at_first_vote
                    const currentScore = s.score_total
                    const delta = (initialScore != null && currentScore != null)
                      ? currentScore - initialScore
                      : null
                    const deltaTone = delta == null ? 'var(--text-muted)'
                                    : delta > 0 ? '#00D4AA'
                                    : delta < 0 ? 'var(--scarlet)'
                                    : 'var(--text-muted)'
                    const deltaLabel = delta == null ? '—'
                                     : delta > 0 ? `+${delta}`
                                     : `${delta}`
                    const tierLabel = s.first_spotter_tier === 'first'   ? 'First'
                                    : s.first_spotter_tier === 'early'   ? 'Early'
                                    : s.first_spotter_tier === 'spotter' ? 'Spotter'
                                    : null
                    return (
                      <li key={s.project_id}>
                        <Link
                          to={`/projects/${s.project_id}`}
                          className="block px-3 py-2"
                          style={{ background: 'rgba(15,32,64,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px', textDecoration: 'none' }}
                        >
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="font-display font-bold truncate min-w-0" style={{ color: 'var(--cream)' }}>
                              {s.project_name ?? '—'}
                            </div>
                            <span
                              className="font-mono text-[11px] tabular-nums whitespace-nowrap"
                              title={initialScore != null && currentScore != null
                                ? `Score at first vote ${initialScore} · current ${currentScore}`
                                : 'Score history not available'}
                            >
                              <span style={{ color: 'var(--text-muted)' }}>{initialScore ?? '—'}</span>
                              <span style={{ color: 'var(--text-faint)' }}> → </span>
                              <span style={{ color: 'var(--cream)', fontWeight: 700 }}>{currentScore ?? '—'}</span>
                              <span style={{ color: deltaTone, marginLeft: 6 }}>({deltaLabel})</span>
                            </span>
                          </div>
                          <div className="font-mono text-[10px] mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                            <span>since {new Date(s.first_voted_at).toLocaleDateString()}</span>
                            <span>·</span>
                            <span>×{s.vote_count_total}</span>
                            {tierLabel && (
                              <>
                                <span>·</span>
                                <span style={{ color: 'var(--gold-500)' }} title="Spotter tier of the first vote on this project">
                                  ★ {tierLabel}
                                </span>
                              </>
                            )}
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ol>
              )}
            </Section>

            {/* Recent forecasts */}
            <Section title="Recent forecasts" emptyHint="No forecasts yet.">
              {votes.length > 0 && (
                <ol className="grid gap-1.5">
                  {votes.map(v => {
                    const correct  = v.is_correct
                    const tone     = correct === true  ? '#00D4AA'
                                  : correct === false ? 'var(--scarlet)'
                                  : 'var(--text-muted)'
                    // Pending forecasts get "predicted/current (pending)"
                    // so the user can see how their call is tracking
                    // even before the season-end stamp lands. Resolved
                    // forecasts keep the simple correct / missed label.
                    const pred     = v.predicted_score
                    const cur      = v.score_total
                    const labelEl  = correct === true  ? 'correct'
                                  : correct === false ? 'missed'
                                  : pred != null
                                    ? `${pred} / ${cur ?? '—'} (pending)`
                                    : 'pending'
                    return (
                      <li key={v.id}>
                        <Link
                          to={`/projects/${v.project_id}`}
                          className="block px-3 py-2"
                          style={{ background: 'rgba(15,32,64,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px', textDecoration: 'none' }}
                        >
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="font-display font-bold truncate min-w-0" style={{ color: 'var(--cream)' }}>
                              {v.project_name ?? '—'}
                            </div>
                            <span
                              className="font-mono text-[10px] tabular-nums whitespace-nowrap"
                              style={{ color: tone }}
                              title={correct === null && pred != null && cur != null
                                ? `predicted ${pred} · current score ${cur} · ${cur >= pred ? 'tracking up' : 'below your call'}`
                                : undefined}
                            >
                              {labelEl}
                            </span>
                          </div>
                          <div className="font-mono text-[10px] mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                            <span>{new Date(v.created_at).toLocaleDateString()}</span>
                            <span>·</span>
                            <span>×{v.vote_count}</span>
                            {v.spotter_tier && (
                              <>
                                <span>·</span>
                                <span style={{ color: 'var(--gold-500)' }} title={
                                  v.spotter_tier === 'first'   ? 'Caught within 24h of the first audit · +50 AP'
                                : v.spotter_tier === 'early'   ? 'Caught within 3 days of the first audit · +20 AP'
                                : 'Caught within 14 days of the first audit · +10 AP'
                                }>
                                  ★ {v.spotter_tier === 'first' ? 'First' : v.spotter_tier === 'early' ? 'Early' : 'Spotter'}
                                </span>
                              </>
                            )}
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ol>
              )}
            </Section>

            {/* Recent applauds */}
            <Section title="Recent applauds" emptyHint="Hasn't applauded anything yet.">
              {applauds.length > 0 && (
                <ol className="grid gap-1.5">
                  {applauds.map(a => (
                    <li key={a.id}>
                      {a.target_link ? (
                        <Link
                          to={a.target_link}
                          className="block px-3 py-2"
                          style={{ background: 'rgba(15,32,64,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px', textDecoration: 'none' }}
                        >
                          <ApplaudInner row={a} />
                        </Link>
                      ) : (
                        <div className="px-3 py-2" style={{ background: 'rgba(15,32,64,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px' }}>
                          <ApplaudInner row={a} />
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </>
        )}
      </div>
    </section>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: 'gold' }) {
  const valueColor = tone === 'gold' ? 'var(--gold-500)' : 'var(--cream)'
  const labelColor = tone === 'gold' ? 'var(--gold-500)' : 'var(--text-muted)'
  return (
    <div className="px-3 py-2.5" style={{
      background: tone === 'gold' ? 'rgba(240,192,64,0.05)' : 'rgba(15,32,64,0.45)',
      border: tone === 'gold' ? '1px solid rgba(240,192,64,0.25)' : '1px solid rgba(255,255,255,0.06)',
      borderRadius: '2px',
    }}>
      <div className="font-mono text-[9px] tracking-widest uppercase mb-1" style={{ color: labelColor, opacity: tone === 'gold' ? 0.85 : 1 }}>{label}</div>
      <div className="font-display font-bold tabular-nums" style={{ color: valueColor, fontSize: 22, lineHeight: 1.1 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {hint && <div className="font-mono text-[9px] mt-0.5" style={{ color: 'var(--text-faint)' }}>{hint}</div>}
    </div>
  )
}

function Section({ title, children, emptyHint }: { title: string; children?: React.ReactNode; emptyHint?: string }) {
  const isEmpty = !children || (Array.isArray(children) && children.length === 0)
  return (
    <div className="mb-5">
      <h2 className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: 'var(--gold-500)' }}>{title}</h2>
      {isEmpty ? (
        <div className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{emptyHint}</div>
      ) : children}
    </div>
  )
}

function ApplaudInner({ row }: { row: ApplaudRow }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <div className="font-display font-bold truncate" style={{ color: 'var(--cream)' }}>
          {row.target_label ?? `${row.target_type} ${row.target_id.slice(0, 8)}`}
        </div>
        <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {row.target_type} · {new Date(row.created_at).toLocaleDateString()}
        </div>
      </div>
      <span className="font-mono text-[10px]" style={{ color: 'var(--gold-500)' }}>👏</span>
    </div>
  )
}
