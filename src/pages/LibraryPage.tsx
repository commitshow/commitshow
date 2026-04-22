import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  supabase,
  ARTIFACT_FORMATS,
  ARTIFACT_FORMAT_LABELS,
  type ArtifactFormat,
  type MDLibraryFeedItem,
  type CreatorGrade,
} from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { loadEffectiveStack } from '../lib/memberStack'
import { IconGraduation, IconWand } from '../components/icons'
import { DirectUploadModal } from '../components/DirectUploadModal'

type PriceFilter = 'any' | 'free' | 'paid'
type SortMode = 'reputation' | 'verified' | 'applied' | 'downloads' | 'newest' | 'price_low'

const GRADE_COLORS: Record<CreatorGrade, string> = {
  Rookie: '#6B7280', Builder: '#60A5FA', Maker: '#00D4AA',
  Architect: '#A78BFA', 'Vibe Engineer': '#F0C040', Legend: '#C8102E',
}

// Display labels for the tool chips on cards
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
  'universal':        'Any',
}

export function LibraryPage() {
  const { user, member } = useAuth()
  const [rows, setRows] = useState<MDLibraryFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [format, setFormat] = useState<'any' | ArtifactFormat>('any')
  const [priceFilter, setPriceFilter] = useState<PriceFilter>('any')
  const [sort, setSort] = useState<SortMode>('reputation')
  const [memberStack, setMemberStack] = useState<string[]>([])
  const [stackFilter, setStackFilter] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

  const reloadFeed = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('md_library_feed')
      .select('*')
    setRows((data ?? []) as MDLibraryFeedItem[])
    setLoading(false)
  }

  useEffect(() => { void reloadFeed() }, [])

  // Load member's effective stack for the "Matches my stack" filter.
  useEffect(() => {
    if (!user?.id) { setMemberStack([]); return }
    loadEffectiveStack(user.id).then(res => setMemberStack(res.stack ?? []))
  }, [user?.id])

  const filtered = useMemo(() => {
    let list = rows.slice()
    if (format !== 'any') list = list.filter(r => r.target_format === format)
    if (priceFilter === 'free') list = list.filter(r => r.is_free)
    if (priceFilter === 'paid') list = list.filter(r => !r.is_free)
    if (stackFilter && memberStack.length > 0) {
      const mine = new Set(memberStack.map(t => t.toLowerCase()))
      list = list.filter(r =>
        (r.stack_tags ?? []).some(t => mine.has(t.toLowerCase())) ||
        (r.tags ?? []).some(t => mine.has(t.toLowerCase()))
      )
    }
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(r =>
      r.title.toLowerCase().includes(q) ||
      (r.description ?? '').toLowerCase().includes(q) ||
      (r.tags ?? []).some(t => t.toLowerCase().includes(q)) ||
      (r.target_tools ?? []).some(t => t.toLowerCase().includes(q)) ||
      (r.stack_tags ?? []).some(t => t.toLowerCase().includes(q))
    )
    switch (sort) {
      case 'applied':
        // Trophy sort — actual adoption (PRs opened into other repos)
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
        // v1.7 · composite reputation from DB view (grade + downloads +
        // adopted-by + graduated-with-this + verified_badge bonus).
        list.sort((a, b) => (b.reputation_score ?? 0) - (a.reputation_score ?? 0))
    }
    return list
  }, [rows, format, priceFilter, search, sort, stackFilter, memberStack])

  const anyFilter = format !== 'any' || priceFilter !== 'any' || !!search.trim() || stackFilter
  const formatCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    rows.forEach(r => {
      if (r.target_format) counts[r.target_format] = (counts[r.target_format] ?? 0) + 1
    })
    return counts
  }, [rows])

  return (
    <section className="relative z-10 pt-20 pb-16 px-6 min-h-screen">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
              // ARTIFACT LIBRARY
            </div>
            <h1 className="font-display font-black text-3xl md:text-4xl mb-1" style={{ color: 'var(--cream)' }}>
              Vibe-coding artifacts worth keeping
            </h1>
            <p className="font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
              MCP configs · IDE rules · agent skills · project rules · patch recipes.
              Published by creators · ranked by community signal.
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

        {/* ── Format tabs ── */}
        <div className="card-navy p-1 flex items-center gap-1 overflow-x-auto mb-3" style={{ borderRadius: '2px' }}>
          <FormatTab active={format === 'any'} count={rows.length} onClick={() => setFormat('any')}>All</FormatTab>
          {ARTIFACT_FORMATS.map(f => (
            <FormatTab
              key={f}
              active={format === f}
              count={formatCounts[f] ?? 0}
              onClick={() => setFormat(f)}
            >
              {ARTIFACT_FORMAT_LABELS[f]}
            </FormatTab>
          ))}
        </div>

        {/* ── Search + price + sort + stack filter ── */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex-1 min-w-[220px] relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>⌕</span>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search title · description · tag · tool · stack…"
              className="w-full pl-8 pr-3 py-2 font-mono text-xs"
              style={{ lineHeight: 1.4 }}
            />
          </div>
          {memberStack.length > 0 && (
            <button
              onClick={() => setStackFilter(v => !v)}
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
              <span className="font-mono text-[10px]" style={{ opacity: 0.7 }}>
                ({memberStack.length})
              </span>
            </button>
          )}
          <Select
            value={priceFilter}
            onChange={v => setPriceFilter(v as PriceFilter)}
            options={[
              { value: 'any',  label: 'Any price' },
              { value: 'free', label: 'Free only' },
              { value: 'paid', label: 'Paid only' },
            ]}
          />
          <Select
            value={sort}
            onChange={v => setSort(v as SortMode)}
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

        {/* ── Summary ── */}
        <div className="flex items-center justify-between mb-5 font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>{anyFilter ? 'Filters applied' : 'Everything published'}</span>
          <span>{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
        </div>

        {/* ── Grid ── */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card-navy p-4" style={{ borderRadius: '2px' }}>
                <div className="h-4 w-20 mb-3" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }} />
                <div className="h-5 w-4/5 mb-2" style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }} />
                <div className="h-3 w-full mb-1" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }} />
                <div className="h-3 w-3/5" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card-navy p-10 text-center" style={{ borderRadius: '2px' }}>
            <div className="font-display font-bold text-xl mb-2" style={{ color: 'var(--text-muted)' }}>
              No library items match
            </div>
            <p className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>
              Try broadening the format tab, or clear the search term.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(item => <LibraryCard key={item.id} item={item} />)}
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

function FormatTab({ active, count, onClick, children }: { active: boolean; count: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 px-3 py-2 font-mono text-xs tracking-wide whitespace-nowrap transition-colors flex items-center gap-1.5"
      style={{
        background: active ? 'var(--gold-500)' : 'transparent',
        color: active ? 'var(--navy-900)' : 'var(--text-secondary)',
        border: 'none',
        borderRadius: '2px',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--cream)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
    >
      {children}
      {count > 0 && (
        <span className="font-mono text-[10px]" style={{ opacity: 0.7 }}>{count}</span>
      )}
    </button>
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-2.5 py-2 font-mono text-xs"
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

function LibraryCard({ item }: { item: MDLibraryFeedItem }) {
  const navigate = useNavigate()
  const authorGrade = item.author_grade as CreatorGrade | null
  const gradeColor = authorGrade ? GRADE_COLORS[authorGrade] : '#6B7280'
  const authorName = item.author_name || 'Creator'
  const formatLabel = item.target_format ? ARTIFACT_FORMAT_LABELS[item.target_format] : item.category
  const applied = item.projects_applied_count ?? 0
  const graduated = item.projects_graduated_count ?? 0
  const priceLabel = item.is_free
    ? 'FREE'
    : `$${(item.price_cents / 100).toFixed(item.price_cents % 100 === 0 ? 0 : 2)}`

  const hasProvenance = !!item.source_project_name && (item.source_project_status === 'graduated' || item.verified_badge)
  const sourceScoreColor = (item.source_project_score ?? 0) >= 75
    ? '#00D4AA'
    : (item.source_project_score ?? 0) >= 50
      ? '#F0C040'
      : 'var(--text-muted)'

  return (
    <div
      className="card-navy p-4 cursor-pointer transition-all flex flex-col h-full"
      style={{ borderRadius: '2px' }}
      onClick={() => navigate(`/library/${item.id}`)}
    >
      {/* Format chip + verified */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <span className="font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5" style={{
          color: 'var(--gold-500)',
          background: 'rgba(240,192,64,0.08)',
          border: '1px solid rgba(240,192,64,0.25)',
          borderRadius: '2px',
        }}>
          {formatLabel}
        </span>
        {item.verified_badge && (
          <span className="font-mono text-[10px] tracking-widest px-1.5 py-0.5" style={{
            color: '#00D4AA',
            background: 'rgba(0,212,170,0.08)',
            border: '1px solid rgba(0,212,170,0.3)',
            borderRadius: '2px',
          }}>
            ✓ VERIFIED
          </span>
        )}
      </div>

      {/* Title + description */}
      <h3 className="font-display font-bold text-base leading-tight mb-2" style={{ color: 'var(--cream)' }}>
        {item.title}
      </h3>
      {item.description && (
        <p className="font-mono text-[11px] line-clamp-3 mb-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {item.description}
        </p>
      )}

      {/* Target tools chips */}
      {(item.target_tools ?? []).length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-2">
          {item.target_tools.slice(0, 4).map(t => (
            <span key={t} className="font-mono text-[10px] px-1.5 py-0.5" style={{
              background: 'rgba(167,139,250,0.06)',
              border: '1px solid rgba(167,139,250,0.25)',
              color: '#A78BFA',
              borderRadius: '2px',
            }}>
              {TOOL_LABEL[t] ?? t}
            </span>
          ))}
        </div>
      )}

      {/* Stack tags */}
      {(item.stack_tags ?? []).length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-3">
          {item.stack_tags.slice(0, 4).map(t => (
            <span key={t} className="font-mono text-[10px] px-1.5 py-0.5" style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'var(--text-muted)',
              borderRadius: '2px',
            }}>{t}</span>
          ))}
        </div>
      )}

      {/* Provenance strip */}
      {hasProvenance && (
        <div
          className="mb-3 pl-2 pr-2 py-1 flex items-center justify-between gap-2 font-mono text-[10px]"
          style={{
            background: 'rgba(0,212,170,0.04)',
            borderLeft: '2px solid rgba(0,212,170,0.4)',
            borderRadius: '0 2px 2px 0',
          }}
        >
          <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <IconGraduation size={10} style={{ color: '#00D4AA' }} />
            <span>from <strong style={{ color: 'var(--cream)' }}>{item.source_project_name}</strong></span>
          </span>
          {item.source_project_score != null && (
            <span style={{ color: sourceScoreColor }}>
              score {item.source_project_score}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto pt-3 flex items-center justify-between gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        {/* Author strip */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className="flex items-center justify-center font-mono text-[10px] font-bold overflow-hidden flex-shrink-0"
            style={{
              width: 20, height: 20,
              background: item.author_avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
              color: 'var(--navy-900)',
              border: '1px solid rgba(240,192,64,0.3)',
              borderRadius: '2px',
            }}
          >
            {item.author_avatar_url
              ? <img src={item.author_avatar_url} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
              : authorName.slice(0, 1).toUpperCase()}
          </div>
          <span className="font-mono text-[10px] truncate" style={{ color: 'var(--text-primary)' }}>
            {authorName}
          </span>
          {authorGrade && (
            <span className="font-mono text-[10px] flex-shrink-0" style={{ color: gradeColor }}>
              · {authorGrade}
            </span>
          )}
        </div>

        {/* Price · Adoption trophy stats · downloads */}
        <div className="flex items-center gap-2 flex-shrink-0 font-mono text-[10px]">
          <span style={{ color: item.is_free ? '#00D4AA' : 'var(--gold-500)' }}>{priceLabel}</span>
          {graduated > 0 && (
            <span title={`${graduated} graduated project${graduated === 1 ? '' : 's'} applied this artifact`}
              className="inline-flex items-center gap-0.5"
              style={{ color: '#00D4AA' }}>
              <IconGraduation size={10} /> {graduated}
            </span>
          )}
          {applied > 0 && (
            <span title={`${applied} project${applied === 1 ? '' : 's'} applied this artifact`}
              className="inline-flex items-center gap-0.5"
              style={{ color: 'var(--gold-500)' }}>
              <IconWand size={10} /> {applied}
            </span>
          )}
          <span style={{ color: 'var(--text-muted)' }}>{item.downloads_count} ↓</span>
        </div>
      </div>
    </div>
  )
}
