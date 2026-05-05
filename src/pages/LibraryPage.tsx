// Artifact Library · v2 Trending-style list (§15 · §15.6.5).
//
// Primary axis: Intent (build_feature · connect_service · tune_ai · start_project).
// Secondary filters: Time window · Format · Tool · Stack match · Price · Search · Sort.
// URL query params mirror the filter state so every view is bookmarkable.
//
//   ?intent=build-feature   ?format=mcp    ?tool=cursor
//   ?t=today|week|month|all ?price=any|free|paid
//   ?match=stack            ?sort=reputation|verified|applied|downloads|newest|price_low
//   ?q=<search>

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  supabase,
  ARTIFACT_FORMATS,
  ARTIFACT_FORMAT_LABELS,
  ARTIFACT_INTENTS,
  ARTIFACT_INTENT_LABELS,
  ARTIFACT_INTENT_HINTS,
  type ArtifactFormat,
  type ArtifactIntent,
  type CreatorGrade,
  type MDLibraryFeedItem,
} from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { loadEffectiveStack } from '../lib/memberStack'
import { LibraryPackRow } from '../components/LibraryPackRow'
import { DirectUploadModal } from '../components/DirectUploadModal'

type TimeWindow = 'today' | 'week' | 'month' | 'all'
type PriceFilter = 'any' | 'free' | 'paid'
type SortMode = 'reputation' | 'verified' | 'applied' | 'downloads' | 'newest' | 'price_low'
type IntentFilter = 'all' | ArtifactIntent
type FormatFilter = 'any' | ArtifactFormat

// Intent URL slug ↔ value mapping (human-friendly URLs).
const INTENT_SLUG: Record<ArtifactIntent, string> = {
  build_feature:   'build-feature',
  connect_service: 'connect-service',
  tune_ai:         'tune-ai',
  start_project:   'start-project',
}
const slugToIntent = Object.fromEntries(
  Object.entries(INTENT_SLUG).map(([k, v]) => [v, k]),
) as Record<string, ArtifactIntent>

const FORMAT_SLUG: Record<ArtifactFormat, string> = {
  mcp_config:    'mcp',
  ide_rules:     'ide-rules',
  agent_skill:   'skill',
  project_rules: 'rules',
  prompt_pack:   'prompt',
  patch_recipe:  'recipe',
  scaffold:      'scaffold',
}
const slugToFormat = Object.fromEntries(
  Object.entries(FORMAT_SLUG).map(([k, v]) => [v, k]),
) as Record<string, ArtifactFormat>

const DAY_MS = 24 * 60 * 60 * 1000

function windowCutoff(t: TimeWindow): Date | null {
  const now = new Date()
  switch (t) {
    case 'today': return new Date(now.getTime() - 1 * DAY_MS)
    case 'week':  return new Date(now.getTime() - 7 * DAY_MS)
    case 'month': return new Date(now.getTime() - 30 * DAY_MS)
    case 'all':   return null
  }
}

export function LibraryPage() {
  const { user, member } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [rows, setRows] = useState<MDLibraryFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [memberStack, setMemberStack] = useState<string[]>([])
  const [uploadOpen, setUploadOpen] = useState(false)

  // ── Filter state · URL-backed ───────────────────────────────
  const intent: IntentFilter =
    (slugToIntent[searchParams.get('intent') ?? ''] ?? 'all') as IntentFilter
  const format: FormatFilter =
    (slugToFormat[searchParams.get('format') ?? ''] ?? 'any') as FormatFilter
  const tool       = searchParams.get('tool')   ?? 'any'
  const timeWindow = (searchParams.get('t')     ?? 'week')  as TimeWindow
  const priceFilter = (searchParams.get('price') ?? 'any')  as PriceFilter
  const sort        = (searchParams.get('sort')  ?? 'reputation') as SortMode
  const stackFilter = searchParams.get('match') === 'stack'
  const search      = searchParams.get('q') ?? ''

  const patchParams = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(searchParams)
    Object.entries(next).forEach(([k, v]) => {
      if (v === null || v === '' || v === 'all' || v === 'any') merged.delete(k)
      else merged.set(k, v)
    })
    setSearchParams(merged, { replace: true })
  }

  // ── Data fetch ──────────────────────────────────────────────
  // Mount-scoped alive flag · prevents setState after unmount when a
  // re-mount or fast tab swap happens mid-fetch.
  const aliveRef = useRef(true)

  const reloadFeed = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('md_library_feed')
      .select('*')
      // Server-side ordering by reputation_score so the first frame
      // is already in the desired default sort. Cap at 200 — the
      // page paginates client-side so anything past that is
      // effectively invisible until filters narrow.
      .order('reputation_score', { ascending: false })
      .limit(200)
    if (!aliveRef.current) return
    setRows((data ?? []) as MDLibraryFeedItem[])
    setLoading(false)
  }
  useEffect(() => {
    aliveRef.current = true
    void reloadFeed()
    return () => { aliveRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let alive = true
    if (!user?.id) { setMemberStack([]); return }
    loadEffectiveStack(user.id).then(res => {
      if (!alive) return
      setMemberStack(res.stack ?? [])
    })
    return () => { alive = false }
  }, [user?.id])

  // ── Filter + sort pipeline ──────────────────────────────────
  const filtered = useMemo(() => {
    let list = rows.slice()

    // Intent primary
    if (intent !== 'all') list = list.filter(r => r.intent === intent)

    // Format secondary
    if (format !== 'any') list = list.filter(r => r.target_format === format)

    // Tool filter (matches target_tools array)
    if (tool !== 'any') {
      list = list.filter(r => (r.target_tools ?? []).includes(tool))
    }

    // Time window — created_at cutoff
    const cutoff = windowCutoff(timeWindow)
    if (cutoff) list = list.filter(r => new Date(r.created_at) >= cutoff)

    // Price
    if (priceFilter === 'free') list = list.filter(r => r.is_free)
    if (priceFilter === 'paid') list = list.filter(r => !r.is_free)

    // Stack match
    if (stackFilter && memberStack.length > 0) {
      const mine = new Set(memberStack.map(t => t.toLowerCase()))
      list = list.filter(r =>
        (r.stack_tags ?? []).some(t => mine.has(t.toLowerCase())) ||
        (r.tags ?? []).some(t => mine.has(t.toLowerCase())),
      )
    }

    // Search
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(r =>
      r.title.toLowerCase().includes(q) ||
      (r.description ?? '').toLowerCase().includes(q) ||
      (r.tags ?? []).some(t => t.toLowerCase().includes(q)) ||
      (r.target_tools ?? []).some(t => t.toLowerCase().includes(q)) ||
      (r.stack_tags ?? []).some(t => t.toLowerCase().includes(q)),
    )

    // Sort
    switch (sort) {
      case 'applied':
        list.sort((a, b) => (b.projects_applied_count ?? 0) - (a.projects_applied_count ?? 0))
        break
      case 'downloads':
        list.sort((a, b) => (b.downloads_count ?? 0) - (a.downloads_count ?? 0))
        break
      case 'newest':
        list.sort((a, b) => b.created_at.localeCompare(a.created_at))
        break
      case 'price_low':
        list.sort((a, b) => (a.price_cents ?? 0) - (b.price_cents ?? 0))
        break
      case 'verified':
        list.sort((a, b) => {
          if (a.verified_badge !== b.verified_badge) return a.verified_badge ? -1 : 1
          const gradA = a.projects_graduated_count ?? 0
          const gradB = b.projects_graduated_count ?? 0
          if (gradA !== gradB) return gradB - gradA
          return (b.projects_applied_count ?? 0) - (a.projects_applied_count ?? 0)
        })
        break
      case 'reputation':
      default:
        list.sort((a, b) => (b.reputation_score ?? 0) - (a.reputation_score ?? 0))
    }

    return list
  }, [rows, intent, format, tool, timeWindow, priceFilter, search, sort, stackFilter, memberStack])

  const intentCounts = useMemo(() => {
    const counts: Record<ArtifactIntent, number> = {
      build_feature: 0, connect_service: 0, tune_ai: 0, start_project: 0,
    }
    rows.forEach(r => { if (r.intent) counts[r.intent] = (counts[r.intent] ?? 0) + 1 })
    return counts
  }, [rows])

  // Collect the set of tools present in the current result set for the tool dropdown.
  const availableTools = useMemo(() => {
    const s = new Set<string>()
    rows.forEach(r => (r.target_tools ?? []).forEach(t => s.add(t)))
    return Array.from(s).sort()
  }, [rows])

  const hasAnyFilter =
    intent !== 'all' ||
    format !== 'any' ||
    tool !== 'any' ||
    timeWindow !== 'week' ||
    priceFilter !== 'any' ||
    stackFilter ||
    !!search.trim()

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* ── Header ──────────────────────────────── */}
        <header className="mb-5 flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
              // ARTIFACT LIBRARY
            </div>
            <h1 className="font-display font-black text-3xl md:text-4xl mb-1" style={{ color: 'var(--cream)' }}>
              What do you want to build right now?
            </h1>
            <p className="font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
              Vibe-coding artifacts ranked by how often they actually ship — not by who starred them loudest.
            </p>
          </div>
          {user && (
            <button
              onClick={() => setUploadOpen(true)}
              className="font-mono text-xs font-medium tracking-wide px-4 py-2 flex-shrink-0"
              style={{
                background: 'var(--gold-500)',
                color: 'var(--navy-900)',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--gold-400)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--gold-500)')}
            >
              PUBLISH ARTIFACT →
            </button>
          )}
        </header>

        {/* ── Intent primary strip (§15.1) · horizontal scroll on mobile ── */}
        <div className="mb-4">
          <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: 'var(--text-muted)' }}>
            INTENT
          </div>
          <div
            className="flex items-center gap-1.5 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <IntentChip
              active={intent === 'all'}
              onClick={() => patchParams({ intent: null })}
              label="All"
              count={rows.length}
              tone="var(--gold-500)"
            />
            {ARTIFACT_INTENTS.map(i => (
              <IntentChip
                key={i}
                active={intent === i}
                onClick={() => patchParams({ intent: INTENT_SLUG[i] })}
                label={ARTIFACT_INTENT_LABELS[i]}
                hint={ARTIFACT_INTENT_HINTS[i]}
                count={intentCounts[i]}
                tone={INTENT_TONE[i]}
              />
            ))}
          </div>
        </div>

        {/* ── Secondary: time + format + tool + price + sort ──
            Also horizontal-scrolls on mobile so 5 controls don't wrap into
            3 awkward rows. The negative-margin/padding pattern lets the
            scroll area bleed to the viewport edge while content keeps the
            section's normal indent. */}
        <div
          className="flex items-center gap-2 mb-3 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <TimeToggle
            value={timeWindow}
            onChange={v => patchParams({ t: v === 'week' ? null : v })}
          />
          <Select
            value={format}
            onChange={v => patchParams({ format: v === 'any' ? null : FORMAT_SLUG[v as ArtifactFormat] })}
            options={[
              { value: 'any', label: 'All formats' },
              ...ARTIFACT_FORMATS.map(f => ({ value: f, label: ARTIFACT_FORMAT_LABELS[f] })),
            ]}
          />
          {availableTools.length > 0 && (
            <Select
              value={tool}
              onChange={v => patchParams({ tool: v === 'any' ? null : v })}
              options={[
                { value: 'any', label: 'Any tool' },
                ...availableTools.map(t => ({ value: t, label: TOOL_LABEL[t] ?? t })),
              ]}
            />
          )}
          <Select
            value={priceFilter}
            onChange={v => patchParams({ price: v === 'any' ? null : v })}
            options={[
              { value: 'any',  label: 'Any price' },
              { value: 'free', label: 'Free only' },
              { value: 'paid', label: 'Paid only' },
            ]}
          />
          <Select
            value={sort}
            onChange={v => patchParams({ sort: v === 'reputation' ? null : v })}
            options={[
              { value: 'reputation', label: 'Sort · Reputation'       },
              { value: 'verified',   label: 'Sort · Verified first'   },
              { value: 'applied',    label: 'Sort · Most adopted'     },
              { value: 'downloads',  label: 'Sort · Most downloaded'  },
              { value: 'newest',     label: 'Sort · Newest'           },
              { value: 'price_low',  label: 'Sort · Price low → high' },
            ]}
          />
        </div>

        {/* ── Search + stack match ───────────────── */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <div className="flex-1 min-w-0 sm:min-w-[260px] relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>⌕</span>
            <input
              type="search"
              value={search}
              onChange={e => patchParams({ q: e.target.value || null })}
              placeholder="Search title · description · tag · tool · stack…"
              className="w-full pl-8 pr-3 py-2 font-mono text-xs"
              style={{ lineHeight: 1.4 }}
            />
          </div>
          {memberStack.length > 0 && (
            <button
              onClick={() => patchParams({ match: stackFilter ? null : 'stack' })}
              className="font-mono text-xs tracking-wide px-3 py-2 flex items-center gap-1.5"
              title={`Your stack: ${memberStack.join(' · ')}`}
              style={{
                background: stackFilter ? 'rgba(0,212,170,0.12)' : 'transparent',
                border: `1px solid ${stackFilter ? 'rgba(0,212,170,0.45)' : 'rgba(255,255,255,0.08)'}`,
                color: stackFilter ? '#00D4AA' : 'var(--cream)',
                borderRadius: '2px',
                cursor: 'pointer',
              }}
            >
              {stackFilter ? '✓' : '○'} Matches my stack
              <span className="font-mono text-[10px]" style={{ opacity: 0.7 }}>({memberStack.length})</span>
            </button>
          )}
        </div>

        {/* ── Summary line ─────────────────────── */}
        <div className="flex items-center justify-between mb-3 font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>{hasAnyFilter ? 'Filters applied' : 'Trending this week'}</span>
          <span>{filtered.length} artifact{filtered.length === 1 ? '' : 's'}</span>
        </div>

        {/* ── Row list ─────────────────────────── */}
        {loading ? (
          <div className="grid gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card-navy px-5 py-4" style={{ borderRadius: '2px' }}>
                <div className="h-5 w-2/5 mb-2" style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }} />
                <div className="h-3 w-3/5 mb-2" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }} />
                <div className="h-3 w-4/5" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            timeWindow={timeWindow}
            onWiden={() => patchParams({ t: 'all' })}
          />
        ) : (
          <div className="grid gap-3">
            {filtered.map(item => <LibraryPackRow key={item.id} item={item} />)}
          </div>
        )}
      </div>

      {uploadOpen && user && (
        <DirectUploadModal
          creatorId={user.id}
          authorGrade={(member?.creator_grade ?? 'Rookie') as CreatorGrade}
          onClose={() => setUploadOpen(false)}
          onPublished={() => { setUploadOpen(false); void reloadFeed() }}
        />
      )}
    </section>
  )
}

// ── Intent chip · primary axis  (§15.1) ──────────────────────
const INTENT_TONE: Record<ArtifactIntent, string> = {
  build_feature:   '#F0C040',
  connect_service: '#60A5FA',
  tune_ai:         '#A78BFA',
  start_project:   '#00D4AA',
}

function IntentChip({
  active, onClick, label, hint, count, tone,
}: {
  active:   boolean
  onClick:  () => void
  label:    string
  hint?:    string
  count:    number
  tone:     string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className="font-mono text-[11px] tracking-wide px-3 py-1.5 transition-colors flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap"
      style={{
        background:   active ? `${tone}1C` : 'transparent',
        color:        active ? tone : 'var(--text-secondary)',
        border:       `1px solid ${active ? `${tone}55` : 'rgba(255,255,255,0.08)'}`,
        borderRadius: '2px',
        cursor:       'pointer',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--cream)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
    >
      {label}
      {count > 0 && (
        <span className="font-mono text-[10px] tabular-nums" style={{ opacity: 0.7 }}>
          {count}
        </span>
      )}
    </button>
  )
}

// ── Time toggle · 4-way pill ────────────────────────────────
function TimeToggle({ value, onChange }: { value: TimeWindow; onChange: (v: TimeWindow) => void }) {
  const opts: Array<{ value: TimeWindow; label: string }> = [
    { value: 'today', label: 'Today' },
    { value: 'week',  label: 'This week' },
    { value: 'month', label: 'This month' },
    { value: 'all',   label: 'All time' },
  ]
  return (
    <div
      className="flex items-center gap-0 overflow-hidden flex-shrink-0"
      style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px' }}
    >
      {opts.map(o => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="font-mono text-xs tracking-wide px-3 py-1.5 transition-colors"
            style={{
              background: active ? 'rgba(240,192,64,0.14)' : 'transparent',
              color:      active ? 'var(--gold-500)' : 'var(--text-secondary)',
              border:     'none',
              borderLeft: o.value === 'today' ? 'none' : '1px solid rgba(255,255,255,0.08)',
              cursor:     'pointer',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-2.5 py-2 font-mono text-xs flex-shrink-0"
      style={{
        background: 'rgba(6,12,26,0.6)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: 'var(--cream)',
        borderRadius: '2px',
        cursor: 'pointer',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function EmptyState({ timeWindow, onWiden }: { timeWindow: TimeWindow; onWiden: () => void }) {
  return (
    <div className="card-navy p-10 text-center" style={{ borderRadius: '2px' }}>
      <div className="font-display font-bold text-xl mb-2" style={{ color: 'var(--text-muted)' }}>
        No artifacts match right now
      </div>
      <p className="font-mono text-xs mb-4" style={{ color: 'var(--text-faint)' }}>
        Try widening the time window, removing the intent filter, or clearing the search term.
      </p>
      {timeWindow !== 'all' && (
        <button
          type="button"
          onClick={onWiden}
          className="font-mono text-xs tracking-wide px-3 py-1.5"
          style={{
            background: 'transparent',
            color: 'var(--gold-500)',
            border: '1px solid rgba(240,192,64,0.4)',
            borderRadius: '2px',
            cursor: 'pointer',
          }}
        >
          Expand to all time →
        </button>
      )}
    </div>
  )
}

// Display labels for tool filter chips + dropdown.
const TOOL_LABEL: Record<string, string> = {
  'cursor':           'Cursor',
  'windsurf':         'Windsurf',
  'continue':         'Continue',
  'cline':            'Cline',
  'claude-desktop':   'Claude Desktop',
  'claude-agent-sdk': 'Agent SDK',
  'stripe':           'Stripe',
  'supabase':         'Supabase',
  'clerk':            'Clerk',
  'resend':           'Resend',
  'posthog':          'PostHog',
  'sentry':           'Sentry',
  'universal':        'Any tool',
}
