// CMO Post Studio · admin-only marketing surface.
// Three sections, top to bottom:
//   1. Freeform tweet generator · prompt textarea → Claude → 3 variations
//   2. 5 trigger templates · DB-backed editable tweet copy + share-card SVG preview
//   3. Recent drafts · last 10 cmo_drafts rows for revisit
//
// The 5 share-card SVGs are still hardcoded React components (visual templates)
// while the editable surface is the *tweet copy* per trigger, persisted in
// cmo_templates. SVG slot editing is a follow-up.

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

// ── Shared card chrome ─────────────────────────────────────────────────────
const cardWidth = 1200
const cardHeight = 630

function CardFrame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${cardWidth} ${cardHeight}`} width="100%" style={{ display: 'block', borderRadius: '6px', border: '1px solid rgba(240,192,64,0.25)' }}>
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0F2040" />
          <stop offset="100%" stopColor="#060C1A" />
        </linearGradient>
        <linearGradient id="goldShimmer" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F0C040" />
          <stop offset="100%" stopColor="#D4A838" />
        </linearGradient>
      </defs>
      <rect width={cardWidth} height={cardHeight} fill="url(#bg)" />
      {children}
      <text x={64} y={68} fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={32} fill="#F0C040">commit<tspan fill="#F8F5EE" fontWeight={400}>.show</tspan></text>
      <text x={64} y={92} fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={12} fill="rgba(248,245,238,0.55)" letterSpacing="2">VIBE-CODING LEAGUE</text>
    </svg>
  )
}

function AuditCompleteCard() {
  return (
    <CardFrame>
      <text x={cardWidth - 64} y={68} textAnchor="end" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={20} fill="rgba(248,245,238,0.65)">maa-website</text>
      <text x={cardWidth - 64} y={92} textAnchor="end" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={12} fill="rgba(248,245,238,0.4)">audit complete</text>
      <text x={cardWidth / 2} y={210} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={150} fill="url(#goldShimmer)" letterSpacing="-1">82</text>
      <text x={cardWidth / 2} y={250} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={18} fill="rgba(248,245,238,0.6)" letterSpacing="3">/ 100 · STRONG</text>
      <text x={64} y={340} fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={16} fill="rgba(248,245,238,0.45)" letterSpacing="2">WHAT THIS BUILD MISSED</text>
      <text x={64} y={372} fontFamily="'DM Sans', sans-serif" fontSize={20} fill="#F8F5EE">↓ no API rate limiting on /auth — IP cap missing</text>
      <text x={64} y={400} fontFamily="'DM Sans', sans-serif" fontSize={20} fill="#F8F5EE">↓ Lighthouse a11y 72 · buttons missing aria-labels</text>
      <text x={64} y={450} fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={16} fill="rgba(248,245,238,0.45)" letterSpacing="2">WHAT IT GOT RIGHT</text>
      <text x={64} y={482} fontFamily="'DM Sans', sans-serif" fontSize={20} fill="#F8F5EE">↑ 50 RLS policies · every state-changing table covered</text>
      <rect x={64} y={528} width={cardWidth - 128} height={56} rx={3} fill="rgba(0,0,0,0.4)" stroke="rgba(240,192,64,0.4)" strokeWidth={1} />
      <text x={cardWidth / 2} y={563} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={20} fill="#F0C040">npx commitshow audit github.com/owner/maa-website</text>
    </CardFrame>
  )
}

function GraduationCard() {
  return (
    <CardFrame>
      <text x={cardWidth - 64} y={68} textAnchor="end" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={14} fill="rgba(248,245,238,0.4)" letterSpacing="2">SEASON ZERO · SPRING 2026</text>
      <text x={cardWidth / 2} y={250} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontStyle="italic" fontWeight={700} fontSize={88} fill="url(#goldShimmer)">Valedictorian</text>
      <text x={cardWidth / 2} y={330} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={56} fill="#F8F5EE">cal-clone</text>
      <text x={cardWidth / 2} y={370} textAnchor="middle" fontFamily="'DM Sans', sans-serif" fontSize={22} fill="rgba(248,245,238,0.65)">by @minji_dev</text>
      <text x={cardWidth / 2} y={460} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={18} fill="rgba(248,245,238,0.5)" letterSpacing="3">FINAL SCORE</text>
      <text x={cardWidth / 2} y={520} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={88} fill="url(#goldShimmer)">94</text>
      <text x={cardWidth / 2} y={580} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontStyle="italic" fontSize={20} fill="rgba(248,245,238,0.6)">Every commit, on stage.</text>
    </CardFrame>
  )
}

function MilestoneCard() {
  return (
    <CardFrame>
      <text x={cardWidth - 64} y={68} textAnchor="end" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={14} fill="rgba(248,245,238,0.4)" letterSpacing="2">MILESTONE · 100-DAY STREAK</text>
      <text x={cardWidth / 2} y={310} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={220} fill="url(#goldShimmer)" letterSpacing="-2">100</text>
      <text x={cardWidth / 2} y={360} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={22} fill="rgba(248,245,238,0.7)" letterSpacing="6">DAYS IN TOP 50</text>
      <text x={cardWidth / 2} y={460} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={48} fill="#F8F5EE">stripe-supabase-recipe</text>
      <text x={cardWidth / 2} y={500} textAnchor="middle" fontFamily="'DM Sans', sans-serif" fontSize={20} fill="rgba(248,245,238,0.55)">SaaS · ranked #4 in category</text>
      <text x={cardWidth / 2} y={580} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={16} fill="#F0C040" letterSpacing="2">commit.show/projects/[id]</text>
    </CardFrame>
  )
}

function WeeklyPicksCard() {
  const movers = [
    { rank: 1, name: 'cal-clone',          delta: '+12', score: 88 },
    { rank: 2, name: 'rag-quickstart',     delta:  '+9', score: 81 },
    { rank: 3, name: 'agentic-toolbench',  delta:  '+7', score: 79 },
  ]
  return (
    <CardFrame>
      <text x={cardWidth - 64} y={68} textAnchor="end" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={14} fill="rgba(248,245,238,0.4)" letterSpacing="2">WEEK 18 · 2026-05-04</text>
      <text x={cardWidth / 2} y={170} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontStyle="italic" fontWeight={700} fontSize={56} fill="url(#goldShimmer)">This Week in commit.show</text>
      <text x={cardWidth / 2} y={210} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={18} fill="rgba(248,245,238,0.55)" letterSpacing="3">TOP 3 CLIMBERS</text>
      {movers.map((m, i) => {
        const y = 310 + i * 80
        return (
          <g key={m.rank}>
            <text x={120} y={y + 8} fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={56} fill="url(#goldShimmer)">#{m.rank}</text>
            <text x={230} y={y - 8} fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={32} fill="#F8F5EE">{m.name}</text>
            <text x={230} y={y + 22} fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={18} fill="rgba(248,245,238,0.6)">{m.delta} pts · score {m.score}/100</text>
          </g>
        )
      })}
      <text x={cardWidth / 2} y={580} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontStyle="italic" fontSize={20} fill="rgba(248,245,238,0.55)">Every commit, on stage.</text>
    </CardFrame>
  )
}

function EarlySpotterCard() {
  return (
    <CardFrame>
      <text x={cardWidth - 64} y={68} textAnchor="end" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={14} fill="rgba(248,245,238,0.4)" letterSpacing="2">SCOUT EARLY SPOTTER · HIT #7</text>
      <text x={cardWidth / 2} y={200} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontStyle="italic" fontWeight={700} fontSize={66} fill="url(#goldShimmer)">Early Spotter</text>
      <text x={cardWidth / 2} y={290} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={16} fill="rgba(248,245,238,0.5)" letterSpacing="2">SPOTTED BY</text>
      <text x={cardWidth / 2} y={340} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={42} fill="#F8F5EE">@gold_scout_07</text>
      <text x={cardWidth / 2} y={368} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={14} fill="#F0C040" letterSpacing="3">GOLD SCOUT</text>
      <line x1={cardWidth / 2 - 60} y1={398} x2={cardWidth / 2 + 60} y2={398} stroke="rgba(240,192,64,0.35)" strokeWidth={1} />
      <text x={cardWidth / 2} y={440} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={16} fill="rgba(248,245,238,0.5)" letterSpacing="2">SPOTTED 14 DAYS BEFORE GRADUATION</text>
      <text x={cardWidth / 2} y={490} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={36} fill="#F8F5EE">cal-clone · Honors</text>
      <text x={cardWidth / 2} y={524} textAnchor="middle" fontFamily="'DM Sans', sans-serif" fontSize={20} fill="rgba(248,245,238,0.55)">final score 88/100</text>
      <text x={cardWidth / 2} y={585} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={14} fill="#F0C040" letterSpacing="2">commit.show/scouts/[id]</text>
    </CardFrame>
  )
}

const TEMPLATE_IMAGES: Record<string, () => React.ReactElement> = {
  audit_complete: AuditCompleteCard,
  graduation:     GraduationCard,
  milestone:      MilestoneCard,
  weekly_picks:   WeeklyPicksCard,
  early_spotter:  EarlySpotterCard,
}

type WorkspaceRow = {
  id:          number
  insights_md: string
  roadmap_md:  string
  updated_at:  string
}

type TemplateRow = {
  id:            string
  audience:      'marketing' | 'user_share'
  label:         string
  copy_template: string
  fires_when:    string
  data_source:   string
  updated_at:    string
}

type DraftRow = {
  id:             string
  prompt:         string
  variations:     Array<{ copy: string; hashtags?: string[]; pillar?: string; rationale?: string }>
  selected_index: number | null
  status:         'draft' | 'approved' | 'posted' | 'archived'
  notes:          string | null
  created_at:     string
}

// ── Page ───────────────────────────────────────────────────────────────────
export function CmoPreviewPage() {
  const { user, member, loading } = useAuth()
  const navigate = useNavigate()

  const [workspace,    setWorkspace]    = useState<WorkspaceRow | null>(null)
  const [templates,    setTemplates]    = useState<TemplateRow[]>([])
  const [drafts,       setDrafts]       = useState<DraftRow[]>([])
  const [loadErr,      setLoadErr]      = useState<string | null>(null)

  // Freeform generator state
  const [prompt,       setPrompt]       = useState('')
  const [genBusy,      setGenBusy]      = useState(false)
  const [genErr,       setGenErr]       = useState<string | null>(null)
  const [variations,   setVariations]   = useState<DraftRow['variations']>([])
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!user)             { navigate('/'); return }
    if (!member?.is_admin) { navigate('/'); return }
  }, [user, member, loading, navigate])

  const loadAll = useCallback(async () => {
    setLoadErr(null)
    const [wsRes, tplRes, draftRes] = await Promise.all([
      supabase.from('cmo_workspace').select('*').eq('id', 1).maybeSingle(),
      supabase.from('cmo_templates').select('*').order('audience').order('id'),
      supabase.from('cmo_drafts').select('*').order('created_at', { ascending: false }).limit(10),
    ])
    if (wsRes.error)    { setLoadErr(`workspace: ${wsRes.error.message}`);    return }
    if (tplRes.error)   { setLoadErr(`templates: ${tplRes.error.message}`);   return }
    if (draftRes.error) { setLoadErr(`drafts: ${draftRes.error.message}`);    return }
    setWorkspace(wsRes.data as WorkspaceRow | null)
    setTemplates(tplRes.data as TemplateRow[])
    setDrafts(draftRes.data as DraftRow[])
  }, [])

  useEffect(() => { if (member?.is_admin) void loadAll() }, [member?.is_admin, loadAll])

  const generate = async () => {
    if (!prompt.trim()) return
    setGenBusy(true)
    setGenErr(null)
    setVariations([])
    setActiveDraftId(null)
    try {
      const { data: sessionRes } = await supabase.auth.getSession()
      const token = sessionRes.session?.access_token
      if (!token) throw new Error('Sign-in expired · refresh and try again')
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-tweet-copy`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ prompt: prompt.trim() }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`)
      setVariations(j.variations ?? [])
      setActiveDraftId(j.draft_id ?? null)
      await loadAll()
    } catch (e) {
      setGenErr((e as Error)?.message ?? String(e))
    } finally {
      setGenBusy(false)
    }
  }

  if (loading || !user || !member?.is_admin) return null

  return (
    <div className="admin-shell relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen" style={{ background: 'var(--navy-950)', color: 'var(--cream)' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <header style={{ marginBottom: 32 }}>
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>// CMO'S ROOM</div>
          <h1 className="font-display text-3xl mb-1" style={{ color: 'var(--cream)' }}>Insights · Roadmap · Tweet drafts</h1>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
            M's strategic workspace. Top: insights + marketing roadmap (chat-editable). Below: freeform tweet generator that pulls roadmap as context, 5 trigger templates, recent draft history. Voice rules locked in CMO.md.
          </p>
        </header>

        {loadErr && (
          <div className="mb-4 p-3 font-mono text-xs" style={{ background: 'rgba(200,16,46,0.1)', border: '1px solid rgba(200,16,46,0.3)', color: 'var(--scarlet)' }}>
            {loadErr}
          </div>
        )}

        {/* ── 0. Workspace (insights + roadmap) ─────────────────────────── */}
        <section style={{ marginBottom: 48, display: 'grid', gap: 24, gridTemplateColumns: '1fr 1fr' }}>
          {workspace && (
            <>
              <WorkspacePanel
                field="insights"
                label="인사이트"
                hint="M 이 관찰한 청중 · 성과 · 기회. 한 화면 1분 스캔."
                md={workspace.insights_md}
                updatedAt={workspace.updated_at}
                onUpdate={() => loadAll()}
              />
              <WorkspacePanel
                field="roadmap"
                label="로드맵"
                hint="시점별 마케팅 플랜 · 이번 주 · 다음 주 · 한 달 마일스톤 · Phase 진행."
                md={workspace.roadmap_md}
                updatedAt={workspace.updated_at}
                onUpdate={() => loadAll()}
              />
            </>
          )}
        </section>

        {/* ── 1. Freeform tweet generator ────────────────────────────────── */}
        <section style={{ marginBottom: 48, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(240,192,64,0.18)', borderRadius: '4px', padding: 24 }}>
          <h2 className="font-display text-xl mb-1" style={{ color: 'var(--gold-500)' }}>Freeform · ask M for a tweet</h2>
          <p className="text-xs mb-4" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Examples: "launch tweet for commit.show" · "react to Cursor 1.0 release" · "celebrate first audit milestone (100 audits)" · "tease the upcoming season-end". M follows CMO.md voice rules.
          </p>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            disabled={genBusy}
            placeholder="we're launching today · platform tweet"
            rows={3}
            style={{
              width: '100%', padding: 12, background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(240,192,64,0.3)', borderRadius: '3px',
              color: 'var(--cream)', fontFamily: "'DM Mono', monospace", fontSize: 14,
              resize: 'vertical', marginBottom: 12,
            }}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={generate}
              disabled={genBusy || !prompt.trim()}
              className="px-5 py-2 font-mono text-xs tracking-widest"
              style={{
                background: genBusy ? 'rgba(240,192,64,0.4)' : 'var(--gold-500)',
                color: 'var(--navy-900)', border: 'none', borderRadius: '2px',
                cursor: genBusy ? 'wait' : 'pointer',
              }}
            >
              {genBusy ? 'M IS DRAFTING…' : 'GENERATE 3 VARIATIONS'}
            </button>
            {genErr && <span className="font-mono text-xs" style={{ color: 'var(--scarlet)' }}>{genErr}</span>}
          </div>

          {variations.length > 0 && (
            <div style={{ marginTop: 24, display: 'grid', gap: 16 }}>
              {variations.map((v, i) => (
                <VariationCard key={i} v={v} index={i} draftId={activeDraftId} onChange={() => loadAll()} />
              ))}
            </div>
          )}
        </section>

        {/* ── 2a. Marketing · M's outbound tweets ─────────────────────────── */}
        <section style={{ marginTop: 48 }}>
          <h2 className="font-display text-xl mb-3" style={{ color: 'var(--gold-500)' }}>마케팅 트윗 · M 발신 (자동)</h2>
          <p className="text-xs mb-6" style={{ color: 'rgba(255,255,255,0.55)' }}>
            DB 이벤트 발생 시 M 이 @commitshow 계정으로 자동 게시. 슬롯 placeholder (<code>{'{project_name}'}</code> 등) 는 게시 시점에 자동 채움. 톤은 3 인칭 관찰자.
          </p>
          <div style={{ display: 'grid', gap: 36 }}>
            {templates.filter(t => t.audience === 'marketing').map(t => (
              <TemplateCard key={`${t.id}-${t.audience}`} template={t} onSave={() => loadAll()} />
            ))}
            {templates.length === 0 && !loadErr && (
              <div className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>loading templates…</div>
            )}
          </div>
        </section>

        {/* ── 2b. User-share · 사용자 1-click 공유 템플릿 ───────────────── */}
        <section style={{ marginTop: 48 }}>
          <h2 className="font-display text-xl mb-3" style={{ color: 'var(--gold-500)' }}>사용자 공유 템플릿 · 1-click 게시</h2>
          <p className="text-xs mb-6" style={{ color: 'rgba(255,255,255,0.55)' }}>
            사용자 본인의 audit 결과 / 졸업 / milestone / Early Spotter 발생 시 "Share on X" 버튼 한 번으로 트윗. 플랫폼이 X intent URL 로 카피 + 프로젝트 링크 (per-project og:image 자동 attach) 미리채움. 톤은 1 인칭. 사용자가 게시 전 검토 가능.
          </p>
          <div style={{ display: 'grid', gap: 36 }}>
            {templates.filter(t => t.audience === 'user_share').map(t => (
              <TemplateCard key={`${t.id}-${t.audience}`} template={t} onSave={() => loadAll()} />
            ))}
          </div>
        </section>

        {/* ── 3. Recent drafts ───────────────────────────────────────────── */}
        <section style={{ marginTop: 48 }}>
          <h2 className="font-display text-xl mb-3" style={{ color: 'var(--gold-500)' }}>Recent drafts · last 10</h2>
          {drafts.length === 0 ? (
            <div className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>no drafts yet · generate one above</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {drafts.map(d => (
                <div key={d.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', padding: 14 }}>
                  <div className="flex items-start justify-between mb-2 gap-3">
                    <div className="font-mono text-[11px] flex-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
                      <span style={{ color: 'var(--gold-500)' }}>{d.status}</span> · {new Date(d.created_at).toLocaleString('ko-KR')} · {d.variations.length} variations
                    </div>
                  </div>
                  <div className="text-xs mb-2" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>prompt:</span> {d.prompt}
                  </div>
                  {d.selected_index !== null && d.variations[d.selected_index] && (
                    <pre className="font-mono text-[12px]" style={{ background: 'rgba(0,0,0,0.4)', padding: 10, borderRadius: 2, whiteSpace: 'pre-wrap', color: 'var(--cream)', margin: 0 }}>
                      {d.variations[d.selected_index].copy}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="font-mono text-xs mt-12" style={{ color: 'rgba(255,255,255,0.4)' }}>
          source · src/pages/CmoPreviewPage.tsx + supabase/functions/generate-tweet-copy
        </footer>
      </div>
    </div>
  )
}

// ── Workspace panel · insights / roadmap with chat-edit ────────────────────
function WorkspacePanel({ field, label, hint, md, updatedAt, onUpdate }: {
  field:     'insights' | 'roadmap'
  label:     string
  hint:      string
  md:        string
  updatedAt: string
  onUpdate:  () => void
}) {
  const [draftMd,  setDraftMd]  = useState(md)
  const [editing,  setEditing]  = useState(false)
  const [chatMsg,  setChatMsg]  = useState('')
  const [busy,     setBusy]     = useState<'save' | 'chat' | null>(null)
  const [out,      setOut]      = useState<string | null>(null)
  const dirty = draftMd !== md

  useEffect(() => { setDraftMd(md) }, [md])

  const saveDirect = async () => {
    setBusy('save'); setOut(null)
    const updateField = field === 'insights' ? { insights_md: draftMd } : { roadmap_md: draftMd }
    const { error } = await supabase.from('cmo_workspace').update(updateField).eq('id', 1)
    setBusy(null)
    if (error) { setOut(`save failed: ${error.message}`); return }
    setOut('saved')
    setEditing(false)
    onUpdate()
  }

  const sendChat = async () => {
    if (!chatMsg.trim()) return
    setBusy('chat'); setOut(null)
    try {
      const { data: sessionRes } = await supabase.auth.getSession()
      const token = sessionRes.session?.access_token
      if (!token) throw new Error('Sign-in expired')
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
      const res = await fetch(`${SUPABASE_URL}/functions/v1/update-cmo-workspace`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, message: chatMsg.trim(), current_md: md }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`)
      setOut(`updated · ${j.summary ?? '(no summary)'}`)
      setChatMsg('')
      onUpdate()
    } catch (e) {
      setOut(`chat failed: ${(e as Error)?.message ?? e}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(240,192,64,0.18)', borderRadius: '4px', padding: 20 }}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display text-lg" style={{ color: 'var(--gold-500)' }}>{label}</h2>
        <button
          onClick={() => { setEditing(e => !e); setOut(null) }}
          className="font-mono text-[10px]"
          style={{ background: 'transparent', color: 'rgba(255,255,255,0.55)', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
        >
          {editing ? '보기' : '직접 편집'}
        </button>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>{hint}</p>

      {editing ? (
        <>
          <textarea
            value={draftMd}
            onChange={e => setDraftMd(e.target.value)}
            rows={14}
            style={{
              width: '100%', padding: 12, background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(240,192,64,0.18)', borderRadius: '3px',
              color: 'var(--cream)', fontFamily: "'DM Mono', monospace", fontSize: 12,
              lineHeight: 1.55, resize: 'vertical', marginBottom: 8,
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{draftMd.length} chars{dirty ? ' · 저장 안 됨' : ''}</div>
            <button
              onClick={saveDirect}
              disabled={!dirty || busy === 'save'}
              className="px-3 py-1 font-mono text-[10px]"
              style={{ background: dirty ? 'var(--gold-500)' : 'rgba(255,255,255,0.05)', color: dirty ? 'var(--navy-900)' : 'rgba(255,255,255,0.3)', border: 'none', borderRadius: 2, cursor: dirty && busy !== 'save' ? 'pointer' : 'default' }}
            >
              {busy === 'save' ? '…' : '저장'}
            </button>
          </div>
        </>
      ) : (
        <pre style={{
          background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 3,
          fontFamily: "'DM Mono', monospace", fontSize: 12, lineHeight: 1.55,
          color: 'var(--cream)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          margin: 0, minHeight: 200, maxHeight: 400, overflowY: 'auto',
        }}>{md || '_(비어있음 · 아래 채팅으로 M 한테 채워달라고 요청)_'}</pre>
      )}

      {/* Chat-edit · ask M to update the doc */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="font-mono text-[10px] mb-1" style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: 2 }}>M 한테 업데이트 요청</div>
        <textarea
          value={chatMsg}
          onChange={e => setChatMsg(e.target.value)}
          disabled={busy === 'chat'}
          rows={2}
          placeholder={field === 'insights'
            ? '예: 팔로워 50명 됐고 Cursor 사용자 비중 높아 보임 · 인사이트 업데이트'
            : '예: W2 부터 LinkedIn 도 다루자 · X 는 일일 Pillar A 만 유지'
          }
          style={{
            width: '100%', padding: 10, background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px',
            color: 'var(--cream)', fontFamily: "'DM Mono', monospace", fontSize: 12,
            resize: 'vertical', marginBottom: 6,
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>업데이트 {new Date(updatedAt).toLocaleString('ko-KR')}</div>
          <button
            onClick={sendChat}
            disabled={!chatMsg.trim() || busy === 'chat'}
            className="px-3 py-1 font-mono text-[10px]"
            style={{
              background: chatMsg.trim() ? 'var(--gold-500)' : 'rgba(255,255,255,0.05)',
              color: chatMsg.trim() ? 'var(--navy-900)' : 'rgba(255,255,255,0.3)',
              border: 'none', borderRadius: 2,
              cursor: chatMsg.trim() && busy !== 'chat' ? 'pointer' : 'default',
            }}
          >
            {busy === 'chat' ? 'M 작성 중…' : '보내기'}
          </button>
        </div>
        {out && <div className="font-mono text-[11px] mt-2" style={{ color: out.includes('failed') ? 'var(--scarlet)' : 'var(--gold-500)' }}>{out}</div>}
      </div>
    </div>
  )
}

// ── Variation card · save / pick / copy ────────────────────────────────────
function VariationCard({ v, index, draftId, onChange }: {
  v: { copy: string; hashtags?: string[]; pillar?: string; rationale?: string }
  index: number
  draftId: string | null
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [out, setOut]   = useState<string | null>(null)
  const charCount = v.copy.length

  const copyToClipboard = async () => {
    try { await navigator.clipboard.writeText(v.copy); setOut('copied to clipboard') }
    catch { setOut('copy failed') }
  }

  const markSelected = async () => {
    if (!draftId) { setOut('no draft id · re-generate'); return }
    setBusy(true)
    const { error } = await supabase.from('cmo_drafts').update({ selected_index: index, status: 'approved' }).eq('id', draftId)
    setBusy(false)
    if (error) setOut(`save failed: ${error.message}`)
    else { setOut('saved · marked as approved'); onChange() }
  }

  return (
    <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(240,192,64,0.18)', borderRadius: '3px', padding: 16 }}>
      <div className="flex items-start justify-between mb-2 gap-3">
        <div className="font-mono text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }}>
          variation {index + 1}{v.pillar ? ` · pillar ${v.pillar}` : ''} · {charCount} chars
        </div>
        <div className="flex gap-2">
          <button onClick={copyToClipboard} className="px-3 py-1 font-mono text-[10px]" style={{ background: 'transparent', color: 'var(--gold-500)', border: '1px solid rgba(240,192,64,0.4)', borderRadius: 2, cursor: 'pointer' }}>COPY</button>
          <button onClick={markSelected} disabled={busy || !draftId} className="px-3 py-1 font-mono text-[10px]" style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: 2, cursor: busy ? 'wait' : 'pointer' }}>{busy ? '…' : 'PICK'}</button>
        </div>
      </div>
      <pre className="font-mono text-[13px]" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--cream)', margin: 0, lineHeight: 1.55 }}>{v.copy}</pre>
      {v.hashtags && v.hashtags.length > 0 && (
        <div className="font-mono text-[11px] mt-2" style={{ color: 'rgba(248,245,238,0.55)' }}>
          tags: {v.hashtags.map(t => `#${t}`).join(' ')}
        </div>
      )}
      {v.rationale && (
        <div className="font-mono text-[11px] mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
          ↳ {v.rationale}
        </div>
      )}
      {out && <div className="font-mono text-[11px] mt-2" style={{ color: out.includes('failed') ? 'var(--scarlet)' : 'var(--gold-500)' }}>{out}</div>}
    </div>
  )
}

// ── Template card · editable copy + share-card preview ─────────────────────
function TemplateCard({ template, onSave }: { template: TemplateRow; onSave: () => void }) {
  const [copy, setCopy]   = useState(template.copy_template)
  const [busy, setBusy]   = useState(false)
  const [out,  setOut]    = useState<string | null>(null)
  const dirty = copy !== template.copy_template
  const Image = TEMPLATE_IMAGES[template.id]

  useEffect(() => { setCopy(template.copy_template) }, [template.copy_template])

  const save = async () => {
    setBusy(true)
    setOut(null)
    const { error } = await supabase.from('cmo_templates').update({ copy_template: copy })
      .eq('id', template.id).eq('audience', template.audience)
    setBusy(false)
    if (error) setOut(`save failed: ${error.message}`)
    else { setOut('saved'); onSave() }
  }

  return (
    <section style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <h3 className="font-display text-lg mb-1" style={{ color: 'var(--gold-500)' }}>{template.label}</h3>
        <div className="font-mono text-[11px] mb-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
          fires when: <span style={{ color: 'rgba(255,255,255,0.8)' }}>{template.fires_when}</span>
        </div>
        <div className="font-mono text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }}>
          data: <span style={{ color: 'rgba(255,255,255,0.8)' }}>{template.data_source}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24, alignItems: 'start' }}>
        <div>
          <div className="font-mono text-[10px] mb-2" style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: 2 }}>SHARE CARD · 1200×630 (sample data)</div>
          {Image ? <Image /> : <div className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>no image template</div>}
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: 2 }}>TWEET COPY · {copy.length} CHARS{dirty ? ' · UNSAVED' : ''}</div>
            <button
              onClick={save}
              disabled={!dirty || busy}
              className="px-3 py-1 font-mono text-[10px]"
              style={{
                background: dirty ? 'var(--gold-500)' : 'rgba(255,255,255,0.05)',
                color: dirty ? 'var(--navy-900)' : 'rgba(255,255,255,0.3)',
                border: 'none', borderRadius: 2,
                cursor: dirty && !busy ? 'pointer' : 'default',
              }}
            >
              {busy ? '…' : 'SAVE'}
            </button>
          </div>
          <textarea
            value={copy}
            onChange={e => setCopy(e.target.value)}
            rows={12}
            style={{
              width: '100%', padding: 12, background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(240,192,64,0.18)', borderRadius: '3px',
              color: 'var(--cream)', fontFamily: "'DM Mono', monospace", fontSize: 12,
              lineHeight: 1.55, resize: 'vertical',
            }}
          />
          {out && <div className="font-mono text-[11px] mt-1" style={{ color: out.includes('failed') ? 'var(--scarlet)' : 'var(--gold-500)' }}>{out}</div>}
          <div className="font-mono text-[10px] mt-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
            updated {new Date(template.updated_at).toLocaleString('ko-KR')}
          </div>
        </div>
      </div>
    </section>
  )
}
