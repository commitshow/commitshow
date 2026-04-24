import { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import {
  ARTIFACT_FORMAT_LABELS,
  ARTIFACT_INTENT_LABELS,
  type ArtifactFormat,
  type ArtifactIntent,
  type CreatorGrade,
  type MDLibraryFeedItem,
} from '../lib/supabase'
import { fetchLibraryItem, recordDownload } from '../lib/libraryDetail'
import { ApplyToRepoModal } from '../components/ApplyToRepoModal'
import { FormatIcon } from '../components/iconMaps'
import { IconGraduation, IconWand } from '../components/icons'
import { useAuth } from '../lib/auth'
import { AuthModal } from '../components/AuthModal'
import { resolveCreatorName, resolveCreatorInitial } from '../lib/creatorName'

const GRADE_COLORS: Record<CreatorGrade, string> = {
  Rookie: '#6B7280', Builder: '#60A5FA', Maker: '#00D4AA',
  Architect: '#A78BFA', 'Vibe Engineer': '#F0C040', Legend: '#C8102E',
}

// v2 · Intent primary axis (§15.1) · used in header badge + left accent rule.
const INTENT_TONE: Record<ArtifactIntent, string> = {
  build_feature:   '#F0C040',
  connect_service: '#60A5FA',
  tune_ai:         '#A78BFA',
  start_project:   '#00D4AA',
}

const TOOL_LABEL: Record<string, string> = {
  'cursor': 'Cursor', 'windsurf': 'Windsurf', 'continue': 'Continue', 'cline': 'Cline',
  'claude-desktop': 'Claude Desktop', 'claude-agent-sdk': 'Agent SDK',
  'stripe': 'Stripe', 'supabase': 'Supabase', 'clerk': 'Clerk',
  'resend': 'Resend', 'posthog': 'PostHog', 'sentry': 'Sentry',
  'universal': 'Any tool',
}

const FORMAT_APPLY_HINT: Record<ArtifactFormat, string> = {
  mcp_config:    'Merge into your MCP client config (Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json · Cursor: .cursor/mcp.json). Remember to fill in API keys and restart the client.',
  ide_rules:     'Drop into your repo root (.cursorrules · .windsurfrules · .continuerules). The IDE picks up rules automatically on the next chat.',
  agent_skill:   'Place the skill directory under ~/.claude/skills/<name>/ (global) or .claude/skills/<name>/ (project-local). Restart any active agent sessions to pick it up.',
  project_rules: 'Add or merge into your repo\'s CLAUDE.md / AGENTS.md / RULES.md. Replace any {{VARIABLES}} with real values for your project.',
  prompt_pack:   'Save into prompts/ or your team\'s prompt library. These are ready-to-paste prompts — copy into your AI chat.',
  patch_recipe:  'Follow the step-by-step. Some steps touch configs or scripts — commit each in its own atomic change.',
  scaffold:      'Fork or clone the source repo. Run install and follow the setup checklist.',
}

export function LibraryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [item, setItem] = useState<MDLibraryFeedItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<'raw' | 'preview'>('raw')
  const [applyOpen, setApplyOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [lastPrUrl, setLastPrUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true); setNotFound(false)
    fetchLibraryItem(id).then(data => {
      if (!data) setNotFound(true)
      setItem(data)
      setLoading(false)
    })
  }, [id])

  const formatLabel = useMemo(() =>
    item?.target_format ? ARTIFACT_FORMAT_LABELS[item.target_format] : item?.category,
    [item?.target_format, item?.category],
  )

  if (loading) {
    return (
      <section className="pt-24 pb-16 px-6 text-center font-mono text-sm min-h-[60vh]" style={{ color: 'var(--text-muted)' }}>
        Loading library item…
      </section>
    )
  }
  if (notFound || !item) {
    return (
      <section className="pt-24 pb-16 px-6 text-center min-h-[60vh]">
        <div className="font-display font-bold text-2xl mb-2" style={{ color: 'var(--cream)' }}>Library item not found</div>
        <p className="font-mono text-xs mb-6" style={{ color: 'var(--text-muted)' }}>It may be unpublished or the URL is wrong.</p>
        <button
          onClick={() => navigate('/library')}
          className="px-5 py-2 font-mono text-xs tracking-wide"
          style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
        >
          BACK TO LIBRARY
        </button>
      </section>
    )
  }

  const authorName = resolveCreatorName({ display_name: item.author_name })
  const authorGrade = item.author_grade as CreatorGrade | null
  const gradeColor = authorGrade ? GRADE_COLORS[authorGrade] : '#6B7280'
  const applied    = item.projects_applied_count ?? 0
  const graduated  = item.projects_graduated_count ?? 0
  const priceLabel = item.is_free
    ? 'FREE'
    : `$${(item.price_cents / 100).toFixed(item.price_cents % 100 === 0 ? 0 : 2)}`
  const hasProvenance = !!item.source_project_name && (item.source_project_status === 'graduated' || item.verified_badge)
  const sourceScoreColor = (item.source_project_score ?? 0) >= 75
    ? '#00D4AA'
    : (item.source_project_score ?? 0) >= 50
      ? '#F0C040'
      : 'var(--text-muted)'

  const handleCopy = async () => {
    if (!item.content_md) return
    try { await navigator.clipboard.writeText(item.content_md) }
    catch {
      const ta = document.createElement('textarea')
      ta.value = item.content_md
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
    recordDownload(item.id).catch(() => {})
  }

  const handleDownload = () => {
    if (!item.content_md) return
    const ext = item.target_format === 'mcp_config' ? 'json' : 'md'
    const safe = (item.title || 'artifact').replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-').toLowerCase() || 'artifact'
    const blob = new Blob([item.content_md], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe}.${ext}`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
    recordDownload(item.id).catch(() => {})
  }

  return (
    <section className="relative z-10 pt-20 pb-16 px-6 min-h-screen">
      <div className="max-w-4xl mx-auto">
        {/* Back link */}
        <button
          onClick={() => navigate('/library')}
          className="mb-5 font-mono text-xs tracking-wide"
          style={{ background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
        >
          ← BACK TO LIBRARY
        </button>

        {/* Header */}
        <header className="card-navy p-6 mb-6" style={{ borderRadius: '2px', borderLeft: `3px solid ${INTENT_TONE[item.intent] ?? '#F0C040'}` }}>
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {/* v2 · Intent badge (§15.1) · primary axis · leads the header */}
              <span
                className="font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5"
                style={{
                  color:      INTENT_TONE[item.intent] ?? '#F0C040',
                  background: `${INTENT_TONE[item.intent] ?? '#F0C040'}1C`,
                  border:     `1px solid ${INTENT_TONE[item.intent] ?? '#F0C040'}55`,
                  borderRadius: '2px',
                }}
              >
                {ARTIFACT_INTENT_LABELS[item.intent]}
              </span>
              <span className="font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5 flex items-center gap-1" style={{
                color: 'var(--gold-500)',
                background: 'rgba(240,192,64,0.08)',
                border: '1px solid rgba(240,192,64,0.25)',
                borderRadius: '2px',
              }}>
                <FormatIcon format={item.target_format} size={12} /> {formatLabel}
              </span>
            </div>
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

          <h1 className="font-display font-black text-2xl md:text-3xl leading-tight mb-2" style={{ color: 'var(--cream)' }}>
            {item.title}
          </h1>
          {item.description && (
            <p className="font-light text-sm mb-4" style={{ color: 'var(--text-primary)', lineHeight: 1.65 }}>
              {item.description}
            </p>
          )}

          {/* Author + price strip */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="flex items-center justify-center font-mono text-[11px] font-bold overflow-hidden"
                style={{
                  width: 24, height: 24,
                  background: item.author_avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
                  color: 'var(--navy-900)',
                  border: '1px solid rgba(240,192,64,0.3)',
                  borderRadius: '2px',
                }}
              >
                {item.author_avatar_url
                  ? <img src={item.author_avatar_url} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
                  : resolveCreatorInitial({ display_name: item.author_name })}
              </div>
              <span className="font-mono text-xs" style={{ color: 'var(--cream)' }}>{authorName}</span>
              {authorGrade && (
                <span className="font-mono text-[11px]" style={{ color: gradeColor }}>· {authorGrade}</span>
              )}
            </div>
            <div className="flex items-center gap-3 font-mono text-xs">
              <span style={{ color: item.is_free ? '#00D4AA' : 'var(--gold-500)' }}>{priceLabel}</span>
              {graduated > 0 && (
                <span className="inline-flex items-center gap-1" style={{ color: '#00D4AA' }} title="Graduated projects that applied this artifact">
                  <IconGraduation size={12} /> {graduated} graduated
                </span>
              )}
              {applied > 0 && (
                <span className="inline-flex items-center gap-1" style={{ color: 'var(--gold-500)' }} title="Projects that opened a PR to apply this artifact">
                  <IconWand size={12} /> {applied} applied
                </span>
              )}
              <span style={{ color: 'var(--text-muted)' }}>· {item.downloads_count} downloads</span>
            </div>
          </div>

          {hasProvenance && (
            <div className="mt-3 pl-3 pr-3 py-2 flex items-center justify-between gap-2 font-mono text-[11px]" style={{
              background: 'rgba(0,212,170,0.04)',
              borderLeft: '2px solid rgba(0,212,170,0.4)',
              borderRadius: '0 2px 2px 0',
            }}>
              <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                <IconGraduation size={12} style={{ color: '#00D4AA' }} />
                <span>Traveled with <NavLink to={`/projects/${item.linked_project_id}`} style={{ color: 'var(--gold-500)', textDecoration: 'none' }}>
                  {item.source_project_name}
                </NavLink></span>
              </span>
              {item.source_project_score != null && (
                <span style={{ color: sourceScoreColor }}>score {item.source_project_score}</span>
              )}
            </div>
          )}
        </header>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={handleCopy}
            disabled={!item.content_md}
            className="font-mono text-xs font-medium tracking-wide px-4 py-2.5 transition-colors"
            style={{
              background: copied ? 'rgba(0,212,170,0.15)' : 'var(--gold-500)',
              color: copied ? '#00D4AA' : 'var(--navy-900)',
              border: copied ? '1px solid rgba(0,212,170,0.4)' : 'none',
              borderRadius: '2px',
              cursor: item.content_md ? 'pointer' : 'not-allowed',
            }}
          >
            {copied ? '✓ COPIED TO CLIPBOARD' : '📋 COPY CONTENT'}
          </button>
          <button
            onClick={handleDownload}
            disabled={!item.content_md}
            className="font-mono text-xs tracking-wide px-4 py-2.5"
            style={{
              background: 'transparent',
              color: 'var(--cream)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '2px',
              cursor: item.content_md ? 'pointer' : 'not-allowed',
            }}
          >
            ⬇ DOWNLOAD
          </button>
          <button
            onClick={() => {
              if (!user) { setAuthOpen(true); return }
              setApplyOpen(true)
            }}
            disabled={!item.content_md}
            className="font-mono text-xs font-medium tracking-wide px-4 py-2.5"
            style={{
              background: 'rgba(167,139,250,0.14)',
              color: '#A78BFA',
              border: '1px solid rgba(167,139,250,0.4)',
              borderRadius: '2px',
              cursor: item.content_md ? 'pointer' : 'not-allowed',
            }}
          >
            <span className="inline-flex items-center gap-1.5"><IconWand size={12} /> APPLY TO MY REPO</span>
          </button>
        </div>

        {lastPrUrl && (
          <div className="mb-6 pl-3 pr-3 py-2 flex items-center justify-between gap-3 font-mono text-[11px]"
            style={{ background: 'rgba(0,212,170,0.06)', border: '1px solid rgba(0,212,170,0.3)', borderRadius: '2px' }}>
            <span style={{ color: '#00D4AA' }}>✓ PR opened — review and merge to finish applying.</span>
            <a
              href={lastPrUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--gold-500)', textDecoration: 'underline' }}
            >
              OPEN PR →
            </a>
          </div>
        )}

        {/* Target tools + stack tags + variables */}
        <div className="card-navy p-4 mb-6" style={{ borderRadius: '2px' }}>
          {item.target_format && (
            <div className="mb-3 pl-3 py-2 pr-3 font-mono text-xs"
              style={{ borderLeft: '2px solid var(--gold-500)', background: 'rgba(240,192,64,0.04)', color: 'var(--text-primary)', lineHeight: 1.6 }}>
              <span style={{ color: 'var(--gold-500)' }}>How to apply:</span> {FORMAT_APPLY_HINT[item.target_format]}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(item.target_tools?.length ?? 0) > 0 && (
              <InfoList label="TARGET TOOLS">
                {item.target_tools.map(t => (
                  <Chip key={t} tone="purple">{TOOL_LABEL[t] ?? t}</Chip>
                ))}
              </InfoList>
            )}
            {(item.stack_tags?.length ?? 0) > 0 && (
              <InfoList label="STACK">
                {item.stack_tags.map(t => (
                  <Chip key={t} tone="neutral">{t}</Chip>
                ))}
              </InfoList>
            )}
            {(item.variables?.length ?? 0) > 0 && (
              <InfoList label="VARIABLES">
                {item.variables.map(v => (
                  <code key={v.name} className="font-mono text-[11px] px-1.5 py-0.5" style={{
                    background: 'rgba(0,212,170,0.04)',
                    border: '1px solid rgba(0,212,170,0.2)',
                    color: '#00D4AA',
                    borderRadius: '2px',
                  }}>
                    {`{{${v.name}}}`}
                  </code>
                ))}
              </InfoList>
            )}
          </div>
        </div>

        {/* Content body */}
        <div className="card-navy overflow-hidden mb-6" style={{ borderRadius: '2px' }}>
          <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
            <span className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
              // CONTENT
            </span>
            <div className="flex items-center gap-2 font-mono text-[10px]">
              <button
                onClick={() => setViewMode('raw')}
                className="px-2 py-0.5"
                style={{
                  background: viewMode === 'raw' ? 'rgba(240,192,64,0.1)' : 'transparent',
                  color: viewMode === 'raw' ? 'var(--gold-500)' : 'var(--text-muted)',
                  border: `1px solid ${viewMode === 'raw' ? 'rgba(240,192,64,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '2px',
                  cursor: 'pointer',
                }}
              >
                RAW
              </button>
              <button
                onClick={() => setViewMode('preview')}
                className="px-2 py-0.5"
                style={{
                  background: viewMode === 'preview' ? 'rgba(240,192,64,0.1)' : 'transparent',
                  color: viewMode === 'preview' ? 'var(--gold-500)' : 'var(--text-muted)',
                  border: `1px solid ${viewMode === 'preview' ? 'rgba(240,192,64,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '2px',
                  cursor: 'pointer',
                }}
              >
                PREVIEW
              </button>
            </div>
          </div>
          <pre
            className="font-mono text-xs p-5 overflow-auto"
            style={{
              background: 'rgba(6,12,26,0.4)',
              color: viewMode === 'raw' ? 'var(--text-primary)' : 'var(--cream)',
              lineHeight: 1.6,
              whiteSpace: viewMode === 'raw' ? 'pre' : 'pre-wrap',
              maxHeight: '72vh',
              fontSize: '12px',
            }}
          >
            {item.content_md ?? '(empty)'}
          </pre>
        </div>

        {/* Apply modal */}
        {applyOpen && user && (
          <ApplyToRepoModal
            item={item}
            onClose={() => setApplyOpen(false)}
            onSuccess={(prUrl) => { setLastPrUrl(prUrl); setApplyOpen(false) }}
          />
        )}

        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

        {/* Tags */}
        {(item.tags?.length ?? 0) > 0 && (
          <div className="flex gap-2 flex-wrap">
            {item.tags.map(t => (
              <span key={t} className="font-mono text-[10px] px-2 py-0.5" style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--text-secondary)',
                borderRadius: '2px',
              }}>
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function InfoList({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-widest mb-1.5" style={{ color: 'var(--text-label)' }}>{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({ children, tone }: { children: React.ReactNode; tone: 'purple' | 'neutral' }) {
  const style = tone === 'purple'
    ? { background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.25)', color: '#A78BFA' }
    : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }
  return (
    <span className="font-mono text-[11px] px-1.5 py-0.5" style={{ ...style, borderRadius: '2px' }}>
      {children}
    </span>
  )
}
