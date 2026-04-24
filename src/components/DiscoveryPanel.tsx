import { useEffect, useMemo, useState } from 'react'
import type { MDCategory, ArtifactIntent } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { FormatIcon } from './iconMaps'
import { IconGift } from './icons'
import {
  loadDiscoveriesForProject,
  dismissDiscovery,
  publishDiscovery,
  intentForFormat,
  type MDDiscoveryRow,
} from '../lib/mdDiscovery'
import {
  MD_CATEGORIES,
  ARTIFACT_FORMAT_LABELS,
  ARTIFACT_INTENTS,
  ARTIFACT_INTENT_LABELS,
  ARTIFACT_INTENT_HINTS,
  MIN_PAID_PRICE_CENTS,
} from '../lib/supabase'
import { supabase } from '../lib/supabase'

// Paid tier minimums mirror DB trigger enforce_md_library_rules (§15.2)
const PAID_MIN_GRADE = 'Builder'      // needed for $1+
const PREMIUM_MIN_GRADE = 'Maker'     // needed for $30+

interface DiscoveryPanelProps {
  projectId: string
  githubUrl: string | null
}

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

export function DiscoveryPanel({ projectId, githubUrl }: DiscoveryPanelProps) {
  const { user, member } = useAuth()
  const [items, setItems] = useState<MDDiscoveryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [publishTarget, setPublishTarget] = useState<MDDiscoveryRow | null>(null)

  const reload = async () => {
    setLoading(true)
    const rows = await loadDiscoveriesForProject(projectId)
    setItems(rows)
    setLoading(false)
  }

  useEffect(() => {
    reload()
    const start = Date.now()
    const id = window.setInterval(async () => {
      if (Date.now() - start > 90_000) { window.clearInterval(id); return }
      const rows = await loadDiscoveriesForProject(projectId)
      setItems(prev => rows.length > prev.length ? rows : prev)
    }, 6_000)
    return () => window.clearInterval(id)
  }, [projectId])

  const visible = useMemo(() => items.filter(i => i.status !== 'dismissed'), [items])

  if (loading) return null
  if (visible.length === 0) return null

  return (
    <div className="card-navy p-6" style={{ borderRadius: '2px', borderColor: 'rgba(240,192,64,0.25)' }}>
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // ARTIFACT DISCOVERY · GOOD NEWS
          </div>
          <h3 className="font-display font-bold text-lg mt-1" style={{ color: 'var(--cream)' }}>
            We found {visible.length} file{visible.length === 1 ? '' : 's'} worth sharing
          </h3>
        </div>
        <div className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          Format-tagged · one click to publish · reputation earns over time
        </div>
      </div>

      <p className="text-sm font-light mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
        Other vibe coders could save hours with these. <strong style={{ color: 'var(--cream)' }}>
        Publish free — every download lands +2 AP on your Scout tier</strong>, and each time one of your
        artifacts is applied to another project it counts toward your public "Library contributions" trophy.
      </p>

      <div className="space-y-3">
        {visible.map(d => (
          <DiscoveryCard
            key={d.id}
            item={d}
            githubUrl={githubUrl}
            onDismiss={async () => { await dismissDiscovery(d.id); reload() }}
            onPublish={() => setPublishTarget(d)}
          />
        ))}
      </div>

      {publishTarget && user && (
        <PublishDialog
          discovery={publishTarget}
          projectId={projectId}
          creatorId={user.id}
          authorGrade={member?.creator_grade ?? 'Rookie'}
          onClose={() => setPublishTarget(null)}
          onPublished={() => { setPublishTarget(null); reload() }}
        />
      )}
    </div>
  )
}

function DiscoveryCard({ item, githubUrl, onDismiss, onPublish }: {
  item: MDDiscoveryRow
  githubUrl: string | null
  onDismiss: () => void
  onPublish: () => void
}) {
  const rawLink = githubUrl
    ? `${githubUrl.replace(/\.git$/, '').replace(/\/$/, '')}/blob/HEAD/${item.file_path}`
    : null
  const isPublished = item.status === 'published'
  const formatLabel = item.detected_format ? ARTIFACT_FORMAT_LABELS[item.detected_format] : item.suggested_category

  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.015)', borderRadius: '2px' }}>
      <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
            <span className="font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5 flex items-center gap-1" style={{
              color: 'var(--gold-500)',
              background: 'rgba(240,192,64,0.08)',
              border: '1px solid rgba(240,192,64,0.25)',
              borderRadius: '2px',
            }}>
              <FormatIcon format={item.detected_format} size={12} />
              {formatLabel}
            </span>
            <code className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {item.file_path}
            </code>
            {item.bundle_paths.length > 0 && (
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                · bundle of {item.bundle_paths.length + 1}
              </span>
            )}
          </div>
          <div className="font-display font-bold text-base leading-tight" style={{ color: 'var(--cream)' }}>
            {item.suggested_title || '(untitled)'}
          </div>
          <p className="text-xs font-light mt-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {item.suggested_description || '—'}
          </p>

          {/* Tool chips */}
          {item.detected_tools.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {item.detected_tools.slice(0, 4).map(t => (
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

          {/* Variable chips */}
          {item.detected_variables.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>variables:</span>
              {item.detected_variables.slice(0, 5).map(v => (
                <code key={v.name} className="font-mono text-[10px] px-1.5 py-0.5" style={{
                  background: 'rgba(0,212,170,0.04)',
                  border: '1px solid rgba(0,212,170,0.2)',
                  color: '#00D4AA',
                  borderRadius: '2px',
                }}>
                  {`{{${v.name}}}`}
                </code>
              ))}
            </div>
          )}
        </div>

      </div>

      <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex gap-2">
          {rawLink && (
            <a
              href={rawLink}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs tracking-wide px-3 py-1"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '2px',
                textDecoration: 'none',
              }}
            >
              PREVIEW ↗
            </a>
          )}
        </div>
        <div className="flex gap-2">
          {isPublished ? (
            <span className="font-mono text-xs tracking-wide px-3 py-1" style={{
              background: 'rgba(0,212,170,0.12)', color: '#00D4AA',
              border: '1px solid rgba(0,212,170,0.35)', borderRadius: '2px',
            }}>
              ✓ PUBLISHED
            </span>
          ) : (
            <>
              <button
                onClick={onDismiss}
                className="font-mono text-xs tracking-wide px-3 py-1"
                style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'rgba(248,120,113,0.9)'; e.currentTarget.style.borderColor = 'rgba(200,16,46,0.35)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
              >
                Not this one
              </button>
              <button
                onClick={onPublish}
                className="font-mono text-xs font-medium tracking-wide px-3 py-1"
                style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
              >
                <span className="inline-flex items-center gap-1.5"><IconGift size={12} /> SHARE FREE →</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Publish dialog ────────────────────────────────────────────
interface PublishDialogProps {
  discovery: MDDiscoveryRow
  projectId: string
  creatorId: string
  authorGrade: string
  onClose: () => void
  onPublished: () => void
}

function PublishDialog({ discovery, projectId, creatorId, authorGrade, onClose, onPublished }: PublishDialogProps) {
  const [title, setTitle] = useState(discovery.suggested_title ?? '')
  const [description, setDescription] = useState(discovery.suggested_description ?? '')
  const [category, setCategory] = useState<MDCategory>(discovery.suggested_category)
  // v2 · Library primary axis (§15.1) · default from format heuristic.
  const [intent, setIntent] = useState<ArtifactIntent>(intentForFormat(discovery.detected_format))
  const [priceDollars, setPriceDollars] = useState('0')  // default free
  const [tags, setTags] = useState('')
  const [contentMd, setContentMd] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canSellPaid    = ['Builder', 'Maker', 'Architect', 'Vibe Engineer', 'Legend'].includes(authorGrade)
  const canSellPremium = ['Maker', 'Architect', 'Vibe Engineer', 'Legend'].includes(authorGrade)
  const canSellScaffold = ['Architect', 'Vibe Engineer', 'Legend'].includes(authorGrade)
  const isPromptPack   = discovery.detected_format === 'prompt_pack'  // always free

  // Format is auto-detected by Discovery — not editable (determines which
  // tools / variables make sense for this artifact).
  const detectedFormat = discovery.detected_format

  useEffect(() => {
    ;(async () => {
      try {
        const { data: project } = await supabase
          .from('projects')
          .select('github_url')
          .eq('id', projectId)
          .single()
        if (!project?.github_url) { setError('Project GitHub URL missing.'); setLoadingContent(false); return }
        const m = project.github_url.match(/github\.com\/([^/]+)\/([^/\s?#]+)/i)
        if (!m) { setError('Cannot parse GitHub URL.'); setLoadingContent(false); return }
        const owner = m[1], repo = m[2].replace(/\.git$/, '')
        const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${encodeURI(discovery.file_path)}`)
        if (!res.ok) throw new Error(`Fetch failed ${res.status}`)
        setContentMd(await res.text())
      } catch (e) {
        setError(`Could not load file content: ${(e as Error).message}`)
      } finally {
        setLoadingContent(false)
      }
    })()
  }, [discovery.file_path, projectId])

  const priceCents = Math.max(0, Math.round(parseFloat(priceDollars || '0') * 100))
  const isPaid = priceCents > 0
  const priceBelowMin = isPaid && priceCents < MIN_PAID_PRICE_CENTS
  const tryingPaid      = isPaid && !canSellPaid
  const tryingPremium   = priceCents > 2999 && !canSellPremium
  const tryingScaffold  = priceCents > 9999 && !canSellScaffold
  const tryingPromptPaid = isPaid && isPromptPack
  const canPublish = !busy && !loadingContent && !!contentMd && title.trim().length > 0
                   && !priceBelowMin && !tryingPaid && !tryingPremium && !tryingScaffold && !tryingPromptPaid

  const handleSubmit = async () => {
    if (!contentMd) return
    setBusy(true); setError('')
    try {
      await publishDiscovery({
        discoveryId: discovery.id,
        title: title.trim(),
        description: description.trim(),
        category,
        contentMd,
        priceCents,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        authorGrade: authorGrade as never,
        linkedProjectId: projectId,
        creatorId,
        intent,
        targetFormat: detectedFormat,
        targetTools: discovery.detected_tools,
        variables: discovery.detected_variables.map(v => ({ name: v.name, sample: v.sample })),
        bundleFiles: [],  // V1: populate from bundle_paths (zip + upload)
        stackTags: [],    // V1: inferred from project.tech_layers
        discoveryTotalScore: discovery.total_score,
      })
      onPublished()
    } catch (e) {
      setError((e as Error).message || 'Publish failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(6,12,26,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="card-navy p-7 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        style={{ borderRadius: '2px' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
          // SHARE TO ARTIFACT LIBRARY
        </div>
        <h3 className="font-display font-bold text-xl mb-1" style={{ color: 'var(--cream)' }}>
          Review and share
        </h3>
        <p className="font-mono text-xs mb-5" style={{ color: 'var(--text-muted)' }}>
          {detectedFormat && (
            <span>Format: <strong style={{ color: 'var(--gold-500)' }}>{ARTIFACT_FORMAT_LABELS[detectedFormat]}</strong> · </span>
          )}
          Grade: <strong style={{ color: 'var(--cream)' }}>{authorGrade}</strong>
        </p>

        <div className="space-y-4">
          <Field label="Title">
            <input value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 font-mono text-sm" />
          </Field>
          <Field label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full px-3 py-2 font-mono text-xs" />
          </Field>

          {/* v2 · Intent primary axis (§15.1) · drives Library nav */}
          <Field label="Intent · what is someone using this for?">
            <div className="flex items-center gap-1.5 flex-wrap">
              {ARTIFACT_INTENTS.map(i => {
                const active = intent === i
                return (
                  <button
                    type="button"
                    key={i}
                    onClick={() => setIntent(i)}
                    title={ARTIFACT_INTENT_HINTS[i]}
                    className="font-mono text-[11px] tracking-wide px-2.5 py-1 transition-colors"
                    style={{
                      background:   active ? 'rgba(240,192,64,0.12)' : 'transparent',
                      color:        active ? 'var(--gold-500)' : 'var(--text-secondary)',
                      border:       `1px solid ${active ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: '2px',
                      cursor:       'pointer',
                    }}
                  >
                    {ARTIFACT_INTENT_LABELS[i]}
                  </button>
                )
              })}
            </div>
            <p className="mt-1 font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {ARTIFACT_INTENT_HINTS[intent]}
            </p>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select value={category} onChange={e => setCategory(e.target.value as MDCategory)} className="w-full px-3 py-2 font-mono text-xs">
                {MD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Tags (comma-separated)">
              <input value={tags} onChange={e => setTags(e.target.value)} placeholder="rls, supabase, production" className="w-full px-3 py-2 font-mono text-xs" />
            </Field>
          </div>

          <div className="pl-3 py-2 pr-3 font-mono text-xs" style={{
            borderLeft: '2px solid rgba(240,192,64,0.5)',
            background: 'rgba(240,192,64,0.04)',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}>
            File: <code style={{ color: 'var(--gold-500)' }}>{discovery.file_path}</code>
            <br />
            {loadingContent ? 'Loading file content from your repo…' : contentMd ? `${contentMd.length.toLocaleString()} chars will be shared.` : '(no content)'}
            {discovery.bundle_paths.length > 0 && (
              <>
                <br />
                <span style={{ color: 'var(--text-muted)' }}>
                  Bundle sibling files: {discovery.bundle_paths.length} (bundled upload coming in V1).
                </span>
              </>
            )}
          </div>

          {/* Price · single input · $0 default, paid requires Builder+ */}
          <div>
            <span className="block font-mono text-xs tracking-widest mb-1.5" style={{ color: 'var(--gold-500)' }}>
              PRICE · USD
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm" style={{ color: 'var(--text-muted)' }}>$</span>
              <input
                type="number"
                min={0}
                step="1"
                value={priceDollars}
                onChange={e => setPriceDollars(e.target.value)}
                className="flex-1 px-3 py-2 font-mono text-sm"
                style={{ maxWidth: '140px' }}
              />
              <span className="font-mono text-xs" style={{ color: isPaid ? 'var(--gold-500)' : '#00D4AA' }}>
                {isPaid ? 'Paid' : 'Free'}
              </span>
            </div>
            <p className="font-mono text-[10px] mt-1.5" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {isPromptPack
                ? 'Prompt packs must stay free — commoditized. Leave at $0.'
                : !canSellPaid
                  ? `Default $0 · graduate 1 project to unlock paid publishing (${PAID_MIN_GRADE}+).`
                  : !canSellPremium
                    ? `Builder · you can price up to $30. Premium (> $30) opens at ${PREMIUM_MIN_GRADE}.`
                    : !canSellScaffold
                      ? 'Maker · up to $100. Scaffold tier (> $100) opens at Architect.'
                      : 'You can price anywhere from $0 upward. You keep 80%, platform takes 20%.'}
            </p>
          </div>

          <div className="pl-3 py-2 pr-3 font-mono text-[11px]" style={{
            borderLeft: '2px solid rgba(0,212,170,0.4)',
            background: 'rgba(0,212,170,0.04)',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}>
            Reputation compounds over time — creator grade + downloads + adopted-by projects + graduated-with-this
            become your quality signal. Every Apply-to-my-repo lands on your public "Library contributions" profile.
            {isPaid && <> Paid artifacts pay out 80/20 (Creator / platform).</>}
          </div>

          {tryingPaid && (
            <div className="pl-3 py-2 pr-3 font-mono text-xs"
              style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
              Paid listings require <strong>{PAID_MIN_GRADE}</strong> grade (1 graduation). Switch to free — you still earn AP.
            </div>
          )}
          {tryingPremium && (
            <div className="pl-3 py-2 pr-3 font-mono text-xs"
              style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
              Premium pricing (above $30) requires <strong>{PREMIUM_MIN_GRADE}</strong> grade (2 graduations).
            </div>
          )}
          {tryingScaffold && (
            <div className="pl-3 py-2 pr-3 font-mono text-xs"
              style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
              Scaffold pricing (above $100) requires <strong>Architect</strong> grade (3 graduations).
            </div>
          )}
          {tryingPromptPaid && (
            <div className="pl-3 py-2 pr-3 font-mono text-xs"
              style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
              Prompt packs must be published free — they are commoditized.
            </div>
          )}
          {priceBelowMin && (
            <div className="pl-3 py-2 pr-3 font-mono text-xs"
              style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
              Minimum paid price is $1.00. Set free or $1+.
            </div>
          )}
          {error && (
            <div className="pl-3 py-2 pr-3 font-mono text-xs"
              style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 mt-6">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 font-mono text-xs tracking-wide"
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-secondary)', borderRadius: '2px', cursor: busy ? 'wait' : 'pointer' }}>
            CANCEL
          </button>
          <button onClick={handleSubmit} disabled={!canPublish} className="px-5 py-2 font-mono text-xs font-medium tracking-wide"
            style={{
              background: canPublish ? 'var(--gold-500)' : 'rgba(255,255,255,0.06)',
              color: canPublish ? 'var(--navy-900)' : 'var(--text-muted)',
              border: 'none', borderRadius: '2px',
              cursor: canPublish ? 'pointer' : 'not-allowed',
            }}>
            {busy ? 'SHARING…' : isPaid ? (
              `PUBLISH AT $${priceDollars} →`
            ) : (
              <span className="inline-flex items-center gap-1.5"><IconGift size={12} /> PUBLISH FREE →</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-mono text-xs tracking-widest mb-1.5" style={{ color: 'var(--gold-500)' }}>
        {label.toUpperCase()}
      </span>
      {children}
    </label>
  )
}

