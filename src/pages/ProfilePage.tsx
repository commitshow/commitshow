import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase, PUBLIC_PROJECT_COLUMNS, type Project, type MDLibraryItem, type MemberStats, type ScoutTier } from '../lib/supabase'
import { AvatarPicker } from '../components/AvatarPicker'
import { deleteProject } from '../lib/projectQueries'
import { loadEffectiveStack } from '../lib/memberStack'
import { IconGraduation, IconWand } from '../components/icons'
import { VerifiedIdentities } from '../components/VerifiedIdentities'
import { ShareUserTemplateButton } from '../components/ShareUserTemplateButton'
import { BackstageSection } from '../components/BackstageSection'
import { StageBadge } from '../components/StageBadge'
import { TicketWalletCard } from '../components/TicketWalletCard'

const TIER_COLOR: Record<ScoutTier, string> = {
  Bronze: '#B98B4E', Silver: '#D1D5DB', Gold: '#F0C040', Platinum: '#A78BFA',
}

const CREATOR_GRADE_COLOR: Record<string, string> = {
  Rookie: '#6B7280', Builder: '#60A5FA', Maker: '#00D4AA',
  Architect: '#A78BFA', 'Vibe Engineer': '#F0C040', Legend: '#C8102E',
}

export function ProfilePage() {
  const navigate = useNavigate()
  const { user, member, updateMember } = useAuth()
  const [stats, setStats] = useState<MemberStats | null>(null)
  const [applications, setApplications] = useState<Project[]>([])
  // Most recent correct Forecast where the linked project graduated · drives
  // the "Share Early Spotter hit" button. null when no correct vote yet,
  // or when the vote target hasn't graduated. Computed once on mount.
  const [earlyHit, setEarlyHit] = useState<{
    project_name: string; project_id: string; project_slug: string | null; grade: string;
    days_before:  number; hit_count: number;
  } | null>(null)
  const [library, setLibrary] = useState<Array<MDLibraryItem & { projects_applied: number; projects_graduated: number }>>([])
  const [loading, setLoading] = useState(true)

  // Profile editing
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      const [statsRes, appsRes, libRes] = await Promise.all([
        supabase.from('member_stats').select('*').eq('id', user.id).maybeSingle(),
        // Auditioned projects only · backstage rows are surfaced by
        // BackstageSection (audit done, not on the league yet).
        supabase.from('projects').select(PUBLIC_PROJECT_COLUMNS)
          .eq('creator_id', user.id)
          .in('status', ['active', 'graduated', 'valedictorian', 'retry'])
          .order('created_at', { ascending: false }),
        supabase.from('md_library').select('*').eq('creator_id', user.id).order('created_at', { ascending: false }),
      ])
      setStats((statsRes.data as MemberStats | null) ?? null)
      setApplications((appsRes.data ?? []) as unknown as Project[])

      // Merge adoption counts from md_library_adoption view for trophy stats.
      const libItems = (libRes.data ?? []) as MDLibraryItem[]
      if (libItems.length > 0) {
        const { data: adopt } = await supabase
          .from('md_library_adoption')
          .select('md_id, projects_applied, projects_graduated')
          .in('md_id', libItems.map(l => l.id))
        const adoptMap = new Map<string, { projects_applied: number; projects_graduated: number }>()
        ;(adopt ?? []).forEach((r: { md_id: string; projects_applied: number; projects_graduated: number }) =>
          adoptMap.set(r.md_id, { projects_applied: r.projects_applied ?? 0, projects_graduated: r.projects_graduated ?? 0 }))
        setLibrary(libItems.map(l => ({
          ...l,
          projects_applied:   adoptMap.get(l.id)?.projects_applied   ?? 0,
          projects_graduated: adoptMap.get(l.id)?.projects_graduated ?? 0,
        })))
      } else {
        setLibrary([])
      }
      setLoading(false)

      // Early Spotter hit · most recent correct Forecast where the
      // linked project actually graduated. Best-effort; failure or no
      // hit just leaves the share button hidden.
      const { data: vote } = await supabase
        .from('votes')
        .select('created_at, project_id')
        .eq('member_id', user.id)
        .eq('is_correct', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (vote?.project_id) {
        const { data: proj } = await supabase
          .from('projects')
          .select('id, slug, project_name, graduation_grade, graduated_at')
          .eq('id', vote.project_id)
          .maybeSingle()
        if (proj?.graduation_grade && proj?.graduated_at) {
          const days = Math.max(1, Math.floor(
            (new Date(proj.graduated_at).getTime() - new Date(vote.created_at).getTime()) / 86_400_000
          ))
          const { count } = await supabase
            .from('votes')
            .select('id', { count: 'exact', head: true })
            .eq('member_id', user.id)
            .eq('is_correct', true)
          setEarlyHit({
            project_name: proj.project_name ?? 'a project',
            project_id:   proj.id,
            project_slug: (proj as { slug?: string | null }).slug ?? null,
            grade:        proj.graduation_grade,
            days_before:  days,
            hit_count:    count ?? 1,
          })
        }
      }
    })()
  }, [user?.id])

  useEffect(() => {
    if (member?.display_name) setDraftName(member.display_name)
  }, [member?.display_name])

  if (!user) {
    return (
      <section className="pt-24 pb-16 px-6 text-center min-h-[60vh]">
        <div className="font-display font-bold text-2xl mb-2" style={{ color: 'var(--cream)' }}>Sign in required</div>
        <p className="font-mono text-xs mb-6" style={{ color: 'var(--text-muted)' }}>Your profile lives behind auth.</p>
        <button
          onClick={() => navigate('/')}
          className="px-5 py-2 font-mono text-xs tracking-wide"
          style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
        >
          BACK TO HOME
        </button>
      </section>
    )
  }

  const tier = (member?.tier ?? 'Bronze') as ScoutTier
  const grade = member?.creator_grade ?? 'Rookie'
  const gradeColor = CREATOR_GRADE_COLOR[grade] || '#6B7280'
  const displayNameResolved = member?.display_name || user.email || ''
  const initial = displayNameResolved.slice(0, 1).toUpperCase()

  const saveName = async () => {
    const clean = draftName.trim().slice(0, 40)
    if (!clean) { setSaveError('Display name cannot be empty.'); return }
    setSaving(true); setSaveError('')
    const { error } = await updateMember({ display_name: clean })
    setSaving(false)
    if (error) setSaveError(error)
    else setEditingName(false)
  }

  const onAvatarUploaded = async (url: string) => {
    await updateMember({ avatar_url: url })
  }

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-5xl mx-auto">
        {/* ── Header ── */}
        <header className="card-navy p-4 sm:p-6 mb-6" style={{ borderRadius: '2px' }}>
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>
            // MEMBER PROFILE
          </div>

          {/* Identity row · avatar inline-left of name/email/edit. Always
              horizontal so the page reads like a typical profile header. */}
          <div className="flex items-start gap-4 mb-5">
            <AvatarPicker
              currentUrl={member?.avatar_url ?? null}
              displayInitial={initial}
              onUploaded={onAvatarUploaded}
            />
            <div className="flex-1 min-w-0">
              <label className="font-mono text-[10px] tracking-widest block mb-1.5" style={{ color: 'var(--text-label)' }}>
                DISPLAY NAME
              </label>
                {editingName ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <input
                      value={draftName}
                      onChange={e => setDraftName(e.target.value)}
                      maxLength={40}
                      placeholder="Your display name"
                      className="w-full sm:flex-1 sm:min-w-[200px] px-3 py-2 font-display text-lg"
                      style={{ background: 'rgba(6,12,26,0.5)', border: '1px solid rgba(240,192,64,0.35)', color: 'var(--cream)', borderRadius: '2px' }}
                    />
                    <div className="flex gap-2">
                      <button onClick={saveName} disabled={saving}
                        className="flex-1 sm:flex-none px-3 py-2.5 font-mono text-xs tracking-wide"
                        style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: saving ? 'wait' : 'pointer' }}>
                        {saving ? 'SAVING…' : 'SAVE'}
                      </button>
                      <button onClick={() => { setEditingName(false); setDraftName(member?.display_name || ''); setSaveError('') }}
                        className="flex-1 sm:flex-none px-3 py-2.5 font-mono text-xs tracking-wide"
                        style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '2px', cursor: 'pointer' }}>
                        CANCEL
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="font-display font-black text-xl sm:text-2xl leading-tight min-w-0 break-words" style={{ color: 'var(--cream)', overflowWrap: 'anywhere' }}>
                      {displayNameResolved}
                    </h1>
                    <button
                      onClick={() => setEditingName(true)}
                      aria-label="Edit display name"
                      title="Edit display name"
                      className="inline-flex items-center justify-center"
                      style={{
                        background: 'transparent',
                        color: 'var(--gold-500)',
                        border: '1px solid rgba(240,192,64,0.3)',
                        borderRadius: '2px',
                        width: 28, height: 28,
                        padding: 0,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  </div>
                )}
                {saveError && (
                  <div className="mt-1 font-mono text-[10px]" style={{ color: '#F87171' }}>{saveError}</div>
                )}
                <div className="font-mono text-[10px] mt-1 break-all" style={{ color: 'var(--text-muted)' }}>
                  {user.email}
                </div>
                {/* Gentle nudge when display_name is still unset · others see your
                    email prefix on cards until you set one. */}
                {!member?.display_name && !editingName && (
                  <div
                    className="mt-3 pl-3 py-2 pr-3 font-mono text-[11px]"
                    style={{
                      borderLeft: '2px solid var(--gold-500)',
                      background: 'rgba(240,192,64,0.06)',
                      color: 'var(--text-primary)',
                      lineHeight: 1.55,
                    }}
                  >
                    <span style={{ color: 'var(--gold-500)' }}>Display name not set.</span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {' '}Everyone else sees your email prefix on project cards and library rows.
                      Click <strong>EDIT</strong> above to introduce yourself.
                    </span>
                  </div>
                )}

            </div>
          </div>

          {/* Verified-by chip strip · spans full row below identity. */}
          <VerifiedIdentities />

          {/* ── Three-axis standings · full-width vertical stack ── */}
          <div className="mt-6">
            <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// YOUR STANDINGS</div>
            <div className="space-y-2">
                <StandingRow
                  label="Creator Grade"
                  value={grade}
                  color={gradeColor}
                  hint={`Career tier · based on Encore products (score ≥ 84). ${stats?.graduated_count ?? 0} Encore / ${applications.length} total.`}
                />
                <StandingRow
                  label="Scout Tier"
                  value={tier}
                  color={TIER_COLOR[tier]}
                  hint={`Voting activity · ${member?.activity_points ?? 0} AP earned. ${stats?.total_votes_cast ?? 0} forecasts cast.`}
                />
                <StandingRow
                  label="Monthly votes left"
                  value={stats ? `${stats.monthly_votes_remaining} / ${stats.monthly_vote_cap}` : '— / —'}
                  color="var(--cream)"
                  hint="Your Scout tier determines how many Forecasts you can cast each month."
                />

                {/* ── Audition tickets · separate balance (free + paid) ── */}
                {user?.id && (
                  <div className="pt-2">
                    <TicketWalletCard memberId={user.id} />
                  </div>
                )}

                {/* Early Spotter share · only when the most recent correct
                    Forecast points at a product that earned Encore. Slot fills:
                    project_name + grade + days_before + scout tier +
                    cumulative correct count. Hidden when no hit yet. */}
                {earlyHit && (
                  <div style={{ marginTop: 12, padding: 12, background: 'rgba(240,192,64,0.06)', border: '1px solid rgba(240,192,64,0.25)', borderRadius: '3px' }}>
                    <div className="font-mono text-[10px] mb-1" style={{ color: 'var(--gold-500)', letterSpacing: 2 }}>EARLY SPOTTER · HIT #{earlyHit.hit_count}</div>
                    <div className="text-xs mb-2" style={{ color: 'rgba(248,245,238,0.85)' }}>
                      Called <strong>{earlyHit.project_name}</strong> · earned Encore · {earlyHit.days_before} days early.
                    </div>
                    <ShareUserTemplateButton
                      templateId="early_spotter"
                      slots={{
                        scout_handle:   member?.x_handle || member?.display_name || 'me',
                        project_name:   earlyHit.project_name,
                        days_before:    earlyHit.days_before,
                        grade:          earlyHit.grade,
                        scout_tier:     tier,
                        hit_count:      earlyHit.hit_count,
                        scout_id:       user.id,
                      }}
                      url={`https://commit.show/projects/${earlyHit.project_slug ?? earlyHit.project_id}`}
                      variant="gold"
                      label="Share Early Spotter"
                    />
                  </div>
                )}
            </div>
          </div>
        </header>

        {/* ── Your Stack editor ── */}
        <YourStackSection />

        {/* ── Graduation explainer ── */}
        <GraduationExplainer currentGrade={grade} graduatedCount={stats?.graduated_count ?? 0} />

        {/* ── BACKSTAGE · audited but not yet on the league ── */}
        {user?.id && <BackstageSection memberId={user.id} />}

        {/* ── My Products · summary card · full grid moved to /me/products ── */}
        <div className="mb-8">
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <div>
              <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>// MY PRODUCTS</div>
              <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {loading ? '…' : `${applications.length} product${applications.length === 1 ? '' : 's'} auditioned`}
              </div>
            </div>
            <NavLink
              to="/me/products"
              className="font-mono text-xs font-medium tracking-wide px-3 py-2 text-center whitespace-nowrap"
              style={{ background: 'transparent', color: 'var(--gold-500)', border: '1px solid rgba(240,192,64,0.4)', borderRadius: '2px', textDecoration: 'none' }}
            >
              Open portfolio →
            </NavLink>
          </div>
          {!loading && applications.length === 0 && (
            <div className="card-navy p-8 text-center" style={{ borderRadius: '2px' }}>
              <div className="font-display text-lg font-bold mb-2" style={{ color: 'var(--text-muted)' }}>No auditions yet</div>
              <NavLink
                to="/submit"
                className="inline-block font-mono text-xs tracking-wide px-4 py-2"
                style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', textDecoration: 'none' }}
              >
                AUDITION YOUR FIRST PRODUCT →
              </NavLink>
            </div>
          )}
          {!loading && applications.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {applications.slice(0, 6).map(p => (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className="block transition-all"
                  style={{
                    background:     'rgba(255,255,255,0.02)',
                    border:         '1px solid rgba(255,255,255,0.06)',
                    borderRadius:   '2px',
                    textDecoration: 'none',
                    overflow:       'hidden',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.4)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
                >
                  <div className="relative" style={{ aspectRatio: '16 / 9', background: 'var(--navy-800)' }}>
                    {p.thumbnail_url ? (
                      <img
                        src={p.thumbnail_url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 w-full h-full"
                        style={{ objectFit: 'cover' }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
                        no preview
                      </div>
                    )}
                    {p.score_total != null && (
                      <span className="absolute top-1 right-1 px-1.5 py-0.5 font-mono text-[10px] tabular-nums" style={{
                        background: 'rgba(6,12,26,0.85)',
                        color:      p.score_total >= 85 ? 'var(--gold-500)' : 'var(--cream)',
                        borderRadius: '2px',
                      }}>
                        {p.score_total}
                      </span>
                    )}
                    {/* StageBadge bottom-left · matches FeaturedLaneCard
                        + ProjectDetail. Skipped on retry (already shown
                        as separate ROOKIE CIRCLE pill elsewhere). */}
                    <div className="absolute bottom-1 left-1">
                      <StageBadge project={p} size="xs" iconless />
                    </div>
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="font-mono text-[11px] truncate" style={{ color: 'var(--cream)' }}>
                      {p.project_name}
                    </div>
                  </div>
                </Link>
              ))}
              {applications.length > 6 && (
                <Link
                  to="/me/products"
                  className="flex items-center justify-center font-mono text-xs"
                  style={{
                    background:     'rgba(240,192,64,0.05)',
                    border:         '1px dashed rgba(240,192,64,0.3)',
                    borderRadius:   '2px',
                    textDecoration: 'none',
                    color:          'var(--gold-500)',
                    aspectRatio:    '16 / 9',
                  }}
                >
                  +{applications.length - 6} more →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* ── My MD Library ── */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>// MY MD LIBRARY</div>
              <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Your published knowledge artifacts · from Discovery panel
              </div>
            </div>
          </div>
          {loading ? (
            <div className="card-navy p-8 font-mono text-xs text-center" style={{ color: 'var(--text-muted)', borderRadius: '2px' }}>
              Loading…
            </div>
          ) : library.length === 0 ? (
            <div className="card-navy p-10 text-center" style={{ borderRadius: '2px' }}>
              <div className="font-display text-xl font-bold mb-2" style={{ color: 'var(--text-muted)' }}>No library items yet</div>
              <p className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>
                After your first analysis, library-worthy files from your repo appear on the product page — publish them from there.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {library.map(item => <LibraryRow key={item.id} item={item} />)}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function StandingRow({ label, value, color, hint }: { label: string; value: string; color: string; hint: string }) {
  return (
    <div className="px-3 py-2.5" style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: '2px',
    }}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-label)' }}>{label}</span>
        <span className="font-display font-bold text-base" style={{ color }}>{value}</span>
      </div>
      <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>{hint}</div>
    </div>
  )
}

// ── Encore career ladder ──────────────────────────────────────
// Career tier criteria · 'graduated' replaced with 'Encore' (score ≥ 84)
// per the 2026-05-05 rebrand. Variable name kept so call-sites in
// GraduationExplainer don't churn while the rest of the file is rewritten.
const GRADUATION_MILESTONES = [
  { grade: 'Rookie',        threshold: '0 Encore',                                       note: 'Starting line — every audited product counts before Encore.' },
  { grade: 'Builder',       threshold: '1 Encore · avg score ≥ 60',                      note: 'You can ship one product across the bar.' },
  { grade: 'Maker',         threshold: '2 Encore · avg ≥ 70',                            note: 'Consistency kicks in.' },
  { grade: 'Architect',     threshold: '3 Encore · avg ≥ 75 · tech diversity',           note: 'Range across infra, AI, frontend, Web3, etc.' },
  { grade: 'Vibe Engineer', threshold: '5 Encore · avg ≥ 80 · 20+ applauds received',    note: 'Craft quality recognized by the community.' },
  { grade: 'Legend',        threshold: '10+ Encore · community influence',               note: 'Permanent fixture at the top of /creators.' },
]

// ── Your Stack section ────────────────────────────────────────
// Editable stack chips · auto-inferred from projects.tech_layers unless
// the member has saved a preferred_stack override (§15.6 v1.5).
function YourStackSection() {
  const { user, updateMember } = useAuth()
  const [stack, setStack] = useState<string[]>([])
  const [autoStack, setAutoStack] = useState<string[]>([])
  const [isAutoInferred, setIsAutoInferred] = useState(true)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    loadEffectiveStack(user.id).then(res => {
      setStack(res.stack)
      setAutoStack(res.autoStack)
      setIsAutoInferred(res.isAutoInferred)
      setLoading(false)
    })
  }, [user?.id])

  const save = async (nextStack: string[] | null) => {
    if (!user?.id) return
    setSaving(true)
    await updateMember({ preferred_stack: nextStack })
    setSaving(false)
    if (nextStack === null) {
      // Reset to auto — refetch
      const res = await loadEffectiveStack(user.id)
      setStack(res.stack)
      setIsAutoInferred(true)
    } else {
      setStack(nextStack)
      setIsAutoInferred(false)
    }
  }

  const addChip = () => {
    const clean = draft.trim().toLowerCase().replace(/[^a-z0-9-_ ]/g, '')
    if (!clean) return
    if (stack.includes(clean)) { setDraft(''); return }
    save([...stack, clean])
    setDraft('')
  }

  const removeChip = (tag: string) => save(stack.filter(t => t !== tag))
  const resetToAuto = () => save(null)

  if (loading || !user) return null

  return (
    <div className="card-navy mb-6" style={{ borderRadius: '2px' }}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-3 text-left p-5"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // YOUR STACK
          </div>
          <div className="font-display font-bold text-lg mt-1" style={{ color: 'var(--cream)' }}>
            What you build with
          </div>
          {!expanded && (
            <div className="mt-1 flex flex-wrap gap-1.5 items-center">
              {stack.length === 0 ? (
                <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  None yet · will auto-fill after your first analysis
                </span>
              ) : (
                <>
                  {stack.slice(0, 6).map(t => (
                    <span key={t} className="font-mono text-[10px] px-1.5 py-0.5" style={{
                      background: 'rgba(240,192,64,0.08)',
                      border: '1px solid rgba(240,192,64,0.25)',
                      color: 'var(--gold-500)',
                      borderRadius: '2px',
                    }}>{t}</span>
                  ))}
                  {stack.length > 6 && (
                    <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      +{stack.length - 6}
                    </span>
                  )}
                  <span className="font-mono text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>
                    {isAutoInferred ? '· auto' : '· custom'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <span className="font-mono text-sm flex-shrink-0" style={{ color: 'var(--gold-500)' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-5" style={{ borderTop: '1px solid rgba(240,192,64,0.12)' }}>
          <p className="font-light text-sm mt-4 mb-4" style={{ color: 'var(--text-primary)', lineHeight: 1.65 }}>
            We match Library items to your stack so you see artifacts that plug into what you already use.
            {' '}
            <span style={{ color: 'var(--text-secondary)' }}>
              Default is auto-derived from your audited projects — override anytime.
            </span>
          </p>

          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>
              {isAutoInferred ? 'AUTO-INFERRED FROM YOUR PROJECTS' : 'CUSTOM OVERRIDE'}
            </span>
            {!isAutoInferred && autoStack.length > 0 && (
              <button
                onClick={resetToAuto}
                disabled={saving}
                className="font-mono text-[10px] tracking-widest px-2 py-0.5"
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '2px',
                  cursor: saving ? 'wait' : 'pointer',
                }}
              >
                Reset to auto ({autoStack.length})
              </button>
            )}
          </div>

          {stack.length === 0 ? (
            <div className="font-mono text-xs p-6 text-center" style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(255,255,255,0.08)',
              color: 'var(--text-muted)',
              borderRadius: '2px',
            }}>
              No stack detected yet. Add a chip below, or audit a project to let us infer it automatically.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {stack.map(t => (
                <span key={t} className="font-mono text-[11px] inline-flex items-center gap-1.5 px-2 py-0.5" style={{
                  background: 'rgba(240,192,64,0.08)',
                  border: '1px solid rgba(240,192,64,0.3)',
                  color: 'var(--gold-500)',
                  borderRadius: '2px',
                }}>
                  {t}
                  <button
                    onClick={() => removeChip(t)}
                    disabled={saving}
                    aria-label={`Remove ${t}`}
                    style={{
                      background: 'transparent', border: 'none', color: 'inherit',
                      cursor: saving ? 'wait' : 'pointer', padding: 0, fontSize: '13px', lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addChip() } }}
              placeholder="Add stack chip · e.g. nextjs, supabase, stripe"
              className="flex-1 px-3 py-2 font-mono text-xs"
              disabled={saving}
            />
            <button
              onClick={addChip}
              disabled={saving || !draft.trim()}
              className="font-mono text-xs tracking-wide px-3 py-2"
              style={{
                background: draft.trim() ? 'var(--gold-500)' : 'rgba(255,255,255,0.06)',
                color: draft.trim() ? 'var(--navy-900)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: '2px',
                cursor: draft.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              ADD
            </button>
          </div>
          <div className="font-mono text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
            Tip · use lowercase single-word tags (e.g. nextjs · tailwind · drizzle · supabase · stripe).
          </div>
        </div>
      )}
    </div>
  )
}

function GraduationExplainer({ currentGrade, graduatedCount }: { currentGrade: string; graduatedCount: number }) {
  const [open, setOpen] = useState(false)    // collapsed by default
  const idx = GRADUATION_MILESTONES.findIndex(m => m.grade === currentGrade)
  const next = idx >= 0 ? GRADUATION_MILESTONES[idx + 1] : null

  return (
    <div className="card-navy mb-8" style={{ borderRadius: '2px' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 text-left p-5"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // WHAT "ENCORE" MEANS
          </div>
          <div className="font-display font-bold text-lg mt-1" style={{ color: 'var(--cream)' }}>
            A product earns Encore when its score crosses 84
          </div>
          {!open && next && (
            <div className="mt-1 font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              Next tier: <span style={{ color: 'var(--gold-500)' }}>{next.grade}</span> · {next.threshold}
            </div>
          )}
        </div>
        <span className="font-mono text-sm flex-shrink-0" style={{ color: 'var(--gold-500)' }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5" style={{ borderTop: '1px solid rgba(240,192,64,0.12)' }}>
          <p className="font-light text-sm mt-4 mb-4" style={{ color: 'var(--text-primary)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--gold-500)' }}>Encore</strong> is a score threshold,
            not a season-end ceremony. Total score (Audit 50 + Scout 30 + Community 20) crosses
            <strong> 84</strong> and the product earns the badge — permanently visible on its card,
            kept while the score holds. The product needs a live URL, two audit snapshots, and
            a submitted Build Brief Phase 1 for the badge to apply. Creator Grade advances as
            Encore products accumulate — career track, not a single-score snapshot.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {GRADUATION_MILESTONES.map((m, i) => {
              const isCurrent = m.grade === currentGrade
              const isPast = idx > i
              return (
                <div
                  key={m.grade}
                  className="px-3 py-2"
                  style={{
                    background: isCurrent ? 'rgba(240,192,64,0.08)' : 'rgba(255,255,255,0.015)',
                    border: `1px solid ${isCurrent ? 'rgba(240,192,64,0.35)' : 'rgba(255,255,255,0.05)'}`,
                    borderRadius: '2px',
                    opacity: isPast ? 0.45 : 1,
                  }}
                >
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="font-display font-bold text-sm" style={{ color: CREATOR_GRADE_COLOR[m.grade] || 'var(--cream)' }}>
                      {m.grade}
                    </span>
                    <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{m.threshold}</span>
                  </div>
                  <div className="font-mono text-[10px]" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{m.note}</div>
                </div>
              )
            })}
          </div>

          {next && (
            <div className="mt-3 pl-3 py-2 pr-3 font-mono text-xs"
              style={{ borderLeft: '2px solid var(--gold-500)', background: 'rgba(240,192,64,0.04)', color: 'var(--text-primary)', lineHeight: 1.6 }}>
              Next: <strong style={{ color: 'var(--gold-500)' }}>{next.grade}</strong> · {next.threshold}
              {graduatedCount > 0 ? ` · you have ${graduatedCount} Encore product${graduatedCount === 1 ? '' : 's'} so far.` : ' · cross 84 on a product to start climbing.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Application row ───────────────────────────────────────────
export function ApplicationRow({ project: p, onDeleted }: { project: Project; onDeleted: () => void }) {
  const navigate = useNavigate()
  // Confirmation lives in a real modal — the previous inline two-step
  // (DELETE → CONFIRM) was easy to fat-finger through on mobile because
  // both buttons sat in the same 18-px-tall row. A portal modal forces
  // a deliberate second tap on a generous target.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const scoreColor = p.score_total >= 75 ? '#00D4AA' : p.score_total >= 50 ? '#F0C040' : '#C8102E'

  const openDetail = () => navigate(`/projects/${p.id}`)

  const handleDelete = async () => {
    setDeleting(true); setError('')
    const { error: e } = await deleteProject(p.id)
    setDeleting(false)
    if (e) {
      setError(e)
      // keep the modal open so the user sees the failure
    } else {
      setConfirmOpen(false)
      onDeleted()
    }
  }

  return (
    <div
      className="card-navy overflow-hidden transition-colors group flex"
      style={{ borderRadius: '2px' }}
    >
      <div
        role="button" tabIndex={0}
        onClick={openDetail}
        onKeyDown={e => { if (e.key === 'Enter') openDetail() }}
        className="cursor-pointer"
        style={{ width: '96px', height: '96px', background: 'var(--navy-800)', flexShrink: 0 }}
      >
        {p.thumbnail_url ? (
          <img src={p.thumbnail_url} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>NO IMG</div>
        )}
      </div>
      <div className="p-3 flex-1 min-w-0 flex flex-col justify-between">
        <div role="button" tabIndex={0} onClick={openDetail} onKeyDown={e => { if (e.key === 'Enter') openDetail() }} className="cursor-pointer">
          <div className="font-display font-bold text-sm truncate" style={{ color: 'var(--cream)' }}>{p.project_name}</div>
          <div className="font-mono text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{p.description}</div>
        </div>
        <div className="flex items-center justify-between mt-1 gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5" style={{
            color: p.status === 'graduated' ? '#00D4AA' : 'var(--text-secondary)',
            border: `1px solid ${p.status === 'graduated' ? 'rgba(0,212,170,0.35)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '2px',
          }}>{p.status}</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs tabular-nums font-medium" style={{ color: scoreColor }}>
              {p.score_total}/100
            </span>
            <button
              onClick={() => { setError(''); setConfirmOpen(true) }}
              title="Delete this product"
              className="font-mono text-[11px] tracking-widest px-2 py-1.5"
              style={{
                background: 'transparent',
                color: 'var(--text-muted)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '2px',
                cursor: 'pointer',
                minHeight: '32px',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--scarlet)'; e.currentTarget.style.borderColor = 'rgba(200,16,46,0.4)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
            >
              DELETE
            </button>
          </div>
        </div>
        {error && !confirmOpen && (
          <div className="font-mono text-[10px] mt-1" style={{ color: '#F87171' }}>{error}</div>
        )}
      </div>

      {confirmOpen && createPortal(
        <div
          onClick={() => { if (!deleting) setConfirmOpen(false) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(6,12,26,0.78)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="card-navy"
            style={{
              maxWidth: '440px', width: '100%',
              border: '1px solid rgba(200,16,46,0.4)',
              borderRadius: '2px',
              padding: '24px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div className="font-mono text-xs tracking-widest mb-3" style={{ color: '#F87171' }}>
              // DELETE PROJECT
            </div>
            <div className="font-display font-bold text-xl mb-2" style={{ color: 'var(--cream)', lineHeight: 1.3 }}>
              Delete "{p.project_name}"
            </div>
            <p className="font-light text-sm mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              This permanently removes the project, its audit history, brief,
              comments, and forecasts. The action cannot be undone.
            </p>
            {error && (
              <div className="font-mono text-[11px] mb-3 px-3 py-2" style={{
                color: '#F87171',
                background: 'rgba(200,16,46,0.08)',
                border: '1px solid rgba(200,16,46,0.25)',
                borderRadius: '2px',
              }}>
                {error}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { if (!deleting) setConfirmOpen(false) }}
                disabled={deleting}
                className="flex-1 font-mono text-xs tracking-wide"
                style={{
                  padding: '12px',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '2px',
                  cursor: deleting ? 'wait' : 'pointer',
                  minHeight: '44px',
                }}
              >
                CANCEL
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 font-mono text-xs font-medium tracking-wide"
                style={{
                  padding: '12px',
                  background: 'var(--scarlet)',
                  color: 'var(--cream)',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: deleting ? 'wait' : 'pointer',
                  minHeight: '44px',
                }}
              >
                {deleting ? 'DELETING…' : 'DELETE PROJECT'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function LibraryRow({ item }: { item: MDLibraryItem & { projects_applied: number; projects_graduated: number } }) {
  const navigate = useNavigate()
  return (
    <div
      role="button" tabIndex={0}
      onClick={() => navigate(`/library/${item.id}`)}
      onKeyDown={e => { if (e.key === 'Enter') navigate(`/library/${item.id}`) }}
      className="card-navy p-3 cursor-pointer transition-colors"
      style={{ borderRadius: '2px' }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5" style={{
          color: 'var(--gold-500)',
          background: 'rgba(240,192,64,0.08)',
          border: '1px solid rgba(240,192,64,0.25)',
          borderRadius: '2px',
        }}>
          {item.category}
        </span>
        {item.verified_badge && (
          <span className="font-mono text-[10px]" style={{ color: '#00D4AA' }}>✓ VERIFIED</span>
        )}
      </div>
      <div className="font-display font-bold text-sm leading-tight" style={{ color: 'var(--cream)' }}>
        {item.title}
      </div>
      {item.description && (
        <div className="font-mono text-[10px] mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {item.description}
        </div>
      )}
      <div className="flex items-center gap-3 mt-2 font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
        <span style={{ color: item.is_free ? '#00D4AA' : 'var(--gold-500)' }}>
          {item.is_free ? 'FREE' : `$${(item.price_cents / 100).toFixed(0)}`}
        </span>
        {item.projects_graduated > 0 && (
          <span className="inline-flex items-center gap-1" style={{ color: '#00D4AA' }}>
            <IconGraduation size={10} /> {item.projects_graduated} Encore
          </span>
        )}
        {item.projects_applied > 0 && (
          <span className="inline-flex items-center gap-1" style={{ color: 'var(--gold-500)' }}>
            <IconWand size={10} /> {item.projects_applied} applied
          </span>
        )}
        <span>{item.downloads_count} ↓</span>
        <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
        <span>{item.status}</span>
      </div>
    </div>
  )
}
