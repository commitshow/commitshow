// /creators/:id · per-creator BUILDING activity.
//
// Counterpart to ScoutDetailPage (judgment side). Shows the member's
// product portfolio: every project they've audited / Encore'd /
// shipped, with score + status. Recent audits surface so visitors
// landing here from /creators can see WHAT THEY BUILD, not what they
// judge.
//
// Same hero shape as ScoutDetailPage so the two pages feel like a
// pair when crossing between them, but the body content is product-
// focused: portfolio cards instead of forecast bullets.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, PUBLIC_MEMBER_COLUMNS, type Member, type CreatorGrade } from '../lib/supabase'
import { isEncoreScore, fetchAllEncoresByProjectIds, type EncoreRow, type EncoreKind } from '../lib/encore'
import { EncoreBadge } from '../components/EncoreBadge'
import { TrustLevelChip } from '../components/TrustLevelChip'

const GRADE_COLOR: Record<CreatorGrade, string> = {
  Rookie:          '#6B7280',
  Builder:         '#60A5FA',
  Maker:           '#00D4AA',
  Architect:       '#A78BFA',
  'Vibe Engineer': '#F0C040',
  Legend:          '#C8102E',
}

interface ProductRow {
  id:            string
  project_name:  string
  description:   string | null
  thumbnail_url: string | null
  status:        string
  score_total:   number | null
  score_auto:    number | null
  audit_count:   number
  created_at:    string
}

interface CreatorMember extends Member {
  encore_count?:  number
  best_score?:    number | null
  total_audits?:  number
}

export function CreatorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [member, setMember]     = useState<CreatorMember | null>(null)
  const [products, setProducts] = useState<ProductRow[]>([])
  const [encoresByProject, setEncoresByProject] = useState<Map<string, EncoreRow[]>>(new Map())
  const [loaded, setLoaded]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    setLoaded(false); setError(null)
    ;(async () => {
      const { data: m, error: e } = await supabase
        .from('members')
        .select(PUBLIC_MEMBER_COLUMNS)
        .eq('id', id)
        .maybeSingle()
      if (!alive) return
      if (e) { setError(e.message); setLoaded(true); return }
      if (!m) { setError('Creator not found.'); setLoaded(true); return }
      const memberCore = m as unknown as CreatorMember

      // Pull every product owned by this creator. Status filter keeps the
      // anonymous CLI walk-on previews out (they have NULL creator_id
      // by design but a stale row could leak through).
      const { data: pjs } = await supabase
        .from('projects')
        .select('id, project_name, description, thumbnail_url, status, score_total, score_auto, audit_count, created_at')
        .eq('creator_id', id)
        .in('status', ['active', 'graduated', 'valedictorian'])
        .order('score_total', { ascending: false, nullsFirst: false })
      if (!alive) return
      const productRows = (pjs ?? []) as ProductRow[]

      // Pull all 4-track Encores for this creator's portfolio so each
      // tile can show every honor it earned (Production / Streak /
      // Climb / Spotlight) instead of inferring "Encore" from score
      // alone. Score-based inference misses Climb/Spotlight by design.
      const encMap = await fetchAllEncoresByProjectIds(productRows.map(p => p.id))

      memberCore.encore_count = productRows.filter(p =>
        isEncoreScore(p.score_total) || (encMap.get(p.id)?.length ?? 0) > 0,
      ).length
      memberCore.best_score   = productRows.length === 0 ? null : Math.max(0, ...productRows.map(p => p.score_total ?? 0))
      memberCore.total_audits = productRows.reduce((sum, p) => sum + (p.audit_count ?? 0), 0)

      setMember(memberCore)
      setProducts(productRows)
      setEncoresByProject(encMap)
      setLoaded(true)
    })()
    return () => { alive = false }
  }, [id])

  const grade = (member?.creator_grade ?? 'Rookie') as CreatorGrade
  const gradeColor = GRADE_COLOR[grade]
  const initial = (member?.display_name ?? 'M').slice(0, 1).toUpperCase()

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-5xl mx-auto">
        <Link to="/creators" className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>← Creators</Link>
        <div className="font-mono text-[10px] tracking-widest mt-3 mb-1" style={{ color: '#A78BFA' }}>// CREATOR ACTIVITY</div>
        {!loaded && <div className="mt-8 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>loading creator…</div>}
        {loaded && error && <div className="mt-8 font-mono text-xs" style={{ color: 'var(--scarlet)' }}>{error}</div>}
        {loaded && !error && member && (
          <>
            {/* Hero */}
            <div className="mt-2 mb-6 grid gap-4 md:grid-cols-[88px_minmax(0,1fr)] items-start">
              <div className="flex items-center justify-center font-mono font-bold overflow-hidden flex-shrink-0"
                   style={{
                     width: 88, height: 88,
                     background: member.avatar_url ? 'var(--navy-800)' : gradeColor,
                     color: 'var(--navy-900)',
                     border: '1px solid rgba(167,139,250,0.35)',
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
                  <span style={{ color: gradeColor }}>{grade} Creator</span>
                  <span>·</span>
                  <span>Scout {member.tier ?? 'Bronze'}</span>
                  <span>·</span>
                  <Link to={`/scouts/${member.id}`} style={{ color: 'var(--gold-500)' }}>see Scout activity →</Link>
                </div>
              </div>
            </div>

            {/* Stats grid · creator-centric */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
              <Stat label="Products"      value={products.length} />
              <Stat label="Encore"        value={member.encore_count ?? 0} accent="#A78BFA" hint="any track" />
              <Stat label="Best score"    value={member.best_score != null ? `${member.best_score}/100` : '—'} />
              <Stat label="Total audits"  value={member.total_audits ?? 0} hint="across all products" />
            </div>

            {/* Product portfolio */}
            <div className="mb-5">
              <h2 className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: '#A78BFA' }}>Products</h2>
              {products.length === 0 ? (
                <div className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>No audited products yet.</div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {products.map(p => (
                    <ProductCard key={p.id} p={p} encores={encoresByProject.get(p.id) ?? []} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function Stat({ label, value, hint, accent }: { label: string; value: number | string; hint?: string; accent?: string }) {
  return (
    <div className="px-3 py-2.5" style={{
      background: accent ? `${accent}10` : 'rgba(15,32,64,0.45)',
      border: `1px solid ${accent ? `${accent}40` : 'rgba(255,255,255,0.06)'}`,
      borderRadius: '2px',
    }}>
      <div className="font-mono text-[9px] tracking-widest uppercase mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="font-display font-bold tabular-nums" style={{ color: accent ?? 'var(--cream)', fontSize: 22, lineHeight: 1.1 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {hint && <div className="font-mono text-[9px] mt-0.5" style={{ color: 'var(--text-faint)' }}>{hint}</div>}
    </div>
  )
}

function ProductCard({ p, encores }: { p: ProductRow; encores: EncoreRow[] }) {
  const isEncore = isEncoreScore(p.score_total) || encores.length > 0
  return (
    <Link
      to={`/projects/${p.id}`}
      className="block px-3 py-3 transition-colors"
      style={{
        background: 'rgba(15,32,64,0.4)',
        border: `1px solid ${isEncore ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: '2px',
        textDecoration: 'none',
      }}
    >
      <div className="flex items-start gap-3">
        {p.thumbnail_url ? (
          <img src={p.thumbnail_url} alt="" loading="lazy" className="flex-shrink-0" style={{ width: 64, height: 36, objectFit: 'cover', borderRadius: '2px' }} />
        ) : (
          <div className="flex-shrink-0 flex items-center justify-center font-mono text-[10px]" style={{
            width: 64, height: 36, background: 'var(--navy-800)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px', color: 'var(--text-faint)',
          }}>
            {(p.project_name ?? '·').slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5 flex-wrap">
            <div className="font-display font-bold truncate" style={{ color: 'var(--cream)' }}>{p.project_name}</div>
            <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
              {/* Render every Encore kind earned. Score-based fallback
                  renders production when score≥85 but no row exists yet
                  (e.g. trigger lag) — shouldn't happen in steady state
                  but keeps the badge visible if it does. */}
              {encores.length > 0
                ? encores.map(e => <EncoreBadge key={e.kind} kind={e.kind as EncoreKind} serial={e.serial} />)
                : isEncoreScore(p.score_total) && <EncoreBadge score={p.score_total} />
              }
              <span className="font-mono text-sm tabular-nums ml-1" style={{ color: isEncore ? 'var(--gold-500)' : 'var(--cream)' }}>
                {p.score_total ?? '—'}
              </span>
            </div>
          </div>
          {p.description && (
            <p className="font-light text-xs" style={{ color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</p>
          )}
          <div className="font-mono text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
            {p.audit_count} audit{p.audit_count === 1 ? '' : 's'} · {new Date(p.created_at).toLocaleDateString()}
          </div>
        </div>
      </div>
    </Link>
  )
}
