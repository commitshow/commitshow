import { useEffect, useMemo, useRef, useState } from 'react'
import {
  supabase,
  ARTIFACT_FORMATS,
  ARTIFACT_FORMAT_LABELS,
  MD_CATEGORIES,
  MIN_PAID_PRICE_CENTS,
  type ArtifactFormat,
  type MDCategory,
  type CreatorGrade,
} from '../lib/supabase'
import { detectFromFile, type DetectionResult } from '../lib/formatDetect'
import { FormatIcon } from './iconMaps'
import { IconGift } from './icons'

// Direct upload · Creator publishes an artifact without going through Discovery.
// File contents are read client-side into content_md — no Storage needed for V0.5.
// Format/tools/variables are auto-detected from filename + content sniff, then
// the creator can override before publishing.

const PAID_MIN_GRADE     = 'Builder'
const PREMIUM_MIN_GRADE  = 'Maker'
const MAX_CONTENT_BYTES  = 200_000  // 200 KB ceiling — keep content_md rows sane

const ALL_TOOLS = [
  { value: 'cursor',           label: 'Cursor' },
  { value: 'windsurf',         label: 'Windsurf' },
  { value: 'continue',         label: 'Continue' },
  { value: 'cline',            label: 'Cline' },
  { value: 'claude-desktop',   label: 'Claude Desktop' },
  { value: 'claude-agent-sdk', label: 'Agent SDK' },
  { value: 'stripe',           label: 'Stripe' },
  { value: 'supabase',         label: 'Supabase' },
  { value: 'clerk',            label: 'Clerk' },
  { value: 'resend',           label: 'Resend' },
  { value: 'posthog',          label: 'PostHog' },
  { value: 'sentry',           label: 'Sentry' },
  { value: 'universal',        label: 'Any' },
]

interface Props {
  creatorId: string
  authorGrade: CreatorGrade
  onClose:     () => void
  onPublished: (mdId: string) => void
}

interface LoadedFile {
  name:     string
  content:  string
  sizeBytes: number
  detection: DetectionResult
}

export function DirectUploadModal({ creatorId, authorGrade, onClose, onPublished }: Props) {
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [fileError, setFileError] = useState('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [format, setFormat] = useState<ArtifactFormat>('project_rules')
  const [category, setCategory] = useState<MDCategory>('Project Rules')
  const [tools, setTools] = useState<string[]>([])
  const [tags, setTags] = useState('')
  const [priceDollars, setPriceDollars] = useState('0')
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(null)
  const [myProjects, setMyProjects] = useState<Array<{ id: string; project_name: string }>>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canSellPaid      = ['Builder', 'Maker', 'Architect', 'Vibe Engineer', 'Legend'].includes(authorGrade)
  const canSellPremium   = ['Maker', 'Architect', 'Vibe Engineer', 'Legend'].includes(authorGrade)
  const canSellScaffold  = ['Architect', 'Vibe Engineer', 'Legend'].includes(authorGrade)
  const isPromptPack     = format === 'prompt_pack'

  const priceCents = Math.max(0, Math.round(parseFloat(priceDollars || '0') * 100))
  const isPaid = priceCents > 0
  const priceBelowMin  = isPaid && priceCents < MIN_PAID_PRICE_CENTS
  const tryingPaid     = isPaid && !canSellPaid
  const tryingPremium  = priceCents > 2999 && !canSellPremium
  const tryingScaffold = priceCents > 9999 && !canSellScaffold
  const tryingPromptPaid = isPaid && isPromptPack

  const canPublish = !busy && !!file && title.trim().length > 0
    && !priceBelowMin && !tryingPaid && !tryingPremium && !tryingScaffold && !tryingPromptPaid

  // Pull the creator's own projects for the optional "Tied to a project?" dropdown.
  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, project_name')
        .eq('creator_id', creatorId)
        .order('created_at', { ascending: false })
      setMyProjects(data ?? [])
    })()
  }, [creatorId])

  // ── File handling ─────────────────────────────────────────
  const handleFile = async (f: File) => {
    setFileError('')
    if (f.size > MAX_CONTENT_BYTES) {
      setFileError(`File too large — max ${Math.round(MAX_CONTENT_BYTES / 1000)} KB.`)
      return
    }
    const text = await f.text()
    if (!text.trim()) {
      setFileError('File is empty.')
      return
    }
    const detection = detectFromFile(f.name, text)
    setFile({ name: f.name, content: text, sizeBytes: f.size, detection })
    // Seed editable fields with detection
    setTitle(detection.title)
    setFormat(detection.format)
    setCategory(detection.category)
    setTools(detection.tools)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) void handleFile(f)
  }

  const clearFile = () => {
    setFile(null)
    setTitle('')
    setDescription('')
    setFormat('project_rules')
    setCategory('Project Rules')
    setTools([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const toggleTool = (t: string) => {
    setTools(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  const detectedVariables = useMemo(() => file?.detection.variables ?? [], [file])

  const priceHint = isPromptPack
    ? 'Prompt packs must stay free — commoditized. Leave at $0.'
    : !canSellPaid
      ? `Default $0 · graduate 1 project to unlock paid publishing (${PAID_MIN_GRADE}+).`
      : !canSellPremium
        ? `Builder · you can price up to $30. Premium (> $30) opens at ${PREMIUM_MIN_GRADE}.`
        : !canSellScaffold
          ? 'Maker · up to $100. Scaffold tier (> $100) opens at Architect.'
          : 'You can price anywhere from $0 upward. You keep 80%, platform takes 20%.'

  const handleSubmit = async () => {
    if (!file) return
    setBusy(true); setError('')
    try {
      const { data: md, error: insertErr } = await supabase
        .from('md_library')
        .insert([{
          creator_id:            creatorId,
          linked_project_id:     linkedProjectId,
          title:                 title.trim(),
          description:           description.trim(),
          category,
          tags:                  tags.split(',').map(t => t.trim()).filter(Boolean),
          content_md:            file.content,
          price_cents:           priceCents,
          author_grade:          authorGrade,
          status:                'published',
          is_public:             true,
          target_format:         format,
          target_tools:          tools,
          variables:             detectedVariables.map(v => ({ name: v.name, sample: v.sample })),
          bundle_files:          [],
          stack_tags:            [],
          discovery_total_score: null,
        }])
        .select('id')
        .single()
      if (insertErr || !md) throw new Error(insertErr?.message ?? 'insert failed')
      onPublished(md.id)
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
        className="card-navy p-7 w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        style={{ borderRadius: '2px' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
          // PUBLISH ARTIFACT · DIRECT UPLOAD
        </div>
        <h3 className="font-display font-bold text-xl mb-1" style={{ color: 'var(--cream)' }}>
          Upload a file, publish to the library
        </h3>
        <p className="font-mono text-xs mb-5" style={{ color: 'var(--text-muted)' }}>
          Grade: <strong style={{ color: 'var(--cream)' }}>{authorGrade}</strong>
          {' · '}text-based artifacts (MD · JSON · rules files) · up to {Math.round(MAX_CONTENT_BYTES / 1000)} KB
        </p>

        {/* ── Step 1 · File picker ────────────────────────────── */}
        {!file ? (
          <label
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
            className="block text-center py-12 px-4 cursor-pointer transition-colors"
            style={{
              border: '1px dashed rgba(240,192,64,0.4)',
              background: 'rgba(240,192,64,0.03)',
              borderRadius: '2px',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".md,.mdc,.json,.txt,.cursorrules,.windsurfrules,.continuerules"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
              }}
            />
            <div className="font-display font-bold text-base mb-1.5" style={{ color: 'var(--gold-500)' }}>
              Drop a file here — or click to pick
            </div>
            <p className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              CLAUDE.md · .cursorrules · mcp.json · SKILL.md · patch recipes · prompt packs
            </p>
            {fileError && (
              <div className="mt-3 font-mono text-xs" style={{ color: 'rgba(248,120,113,0.85)' }}>
                {fileError}
              </div>
            )}
          </label>
        ) : (
          <div className="mb-5 pl-3 py-2 pr-3 flex items-center justify-between gap-2" style={{
            borderLeft: '2px solid var(--gold-500)',
            background: 'rgba(240,192,64,0.05)',
            borderRadius: '0 2px 2px 0',
          }}>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs truncate" style={{ color: 'var(--cream)' }}>
                {file.name}
              </div>
              <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {Math.round(file.sizeBytes / 100) / 10} KB · detected{' '}
                <strong style={{ color: 'var(--gold-500)' }}>
                  <FormatIcon format={file.detection.format} size={10} />{' '}
                  {ARTIFACT_FORMAT_LABELS[file.detection.format]}
                </strong>
                {file.detection.variables.length > 0 && (
                  <span> · {file.detection.variables.length} variable{file.detection.variables.length === 1 ? '' : 's'}</span>
                )}
              </div>
            </div>
            <button
              onClick={clearFile}
              className="font-mono text-[10px] tracking-wide px-2 py-1"
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--text-muted)',
                borderRadius: '2px',
                cursor: 'pointer',
              }}
            >
              SWAP FILE
            </button>
          </div>
        )}

        {/* ── Step 2 · Editable metadata ────────────────────────── */}
        {file && (
          <div className="space-y-4">
            <Field label="Title">
              <input value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 font-mono text-sm" />
            </Field>
            <Field label="Description">
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                placeholder="Who's it for · what problem does it solve · what makes it reusable?"
                className="w-full px-3 py-2 font-mono text-xs" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Format">
                <select value={format} onChange={e => {
                  const f = e.target.value as ArtifactFormat
                  setFormat(f)
                }} className="w-full px-3 py-2 font-mono text-xs">
                  {ARTIFACT_FORMATS.map(f => (
                    <option key={f} value={f}>{ARTIFACT_FORMAT_LABELS[f]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <select value={category} onChange={e => setCategory(e.target.value as MDCategory)} className="w-full px-3 py-2 font-mono text-xs">
                  {MD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Target tools · click to toggle">
              <div className="flex flex-wrap gap-1.5">
                {ALL_TOOLS.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => toggleTool(t.value)}
                    className="font-mono text-[10px] tracking-wide px-2 py-1"
                    style={{
                      background: tools.includes(t.value) ? 'rgba(240,192,64,0.12)' : 'rgba(255,255,255,0.02)',
                      border:     `1px solid ${tools.includes(t.value) ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.08)'}`,
                      color:      tools.includes(t.value) ? 'var(--gold-500)' : 'var(--text-secondary)',
                      borderRadius: '2px',
                      cursor: 'pointer',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Tags (comma-separated)">
              <input value={tags} onChange={e => setTags(e.target.value)}
                placeholder="rls, supabase, production"
                className="w-full px-3 py-2 font-mono text-xs" />
            </Field>

            {myProjects.length > 0 && (
              <Field label="Tied to one of your products? (optional)">
                <select
                  value={linkedProjectId ?? ''}
                  onChange={e => setLinkedProjectId(e.target.value || null)}
                  className="w-full px-3 py-2 font-mono text-xs"
                >
                  <option value="">Not tied to a product</option>
                  {myProjects.map(p => (
                    <option key={p.id} value={p.id}>{p.project_name}</option>
                  ))}
                </select>
              </Field>
            )}

            {detectedVariables.length > 0 && (
              <div className="pl-3 py-2 pr-3 font-mono text-[11px]" style={{
                borderLeft: '2px solid rgba(0,212,170,0.4)',
                background: 'rgba(0,212,170,0.04)',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}>
                Detected variables ({detectedVariables.length}):{' '}
                {detectedVariables.slice(0, 8).map((v, i) => (
                  <code key={v.name} style={{ color: '#00D4AA' }}>
                    {i > 0 && <span style={{ color: 'var(--text-muted)' }}>, </span>}
                    {`{{${v.name}}}`}
                  </code>
                ))}
                {' '}· buyers can fill these in via Apply-to-my-repo.
              </div>
            )}

            {/* Price */}
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
                  disabled={!canSellPaid}
                  className="flex-1 px-3 py-2 font-mono text-sm"
                  style={{ maxWidth: '140px', opacity: canSellPaid ? 1 : 0.5, cursor: canSellPaid ? 'text' : 'not-allowed' }}
                />
                <span className="font-mono text-xs" style={{ color: isPaid ? 'var(--gold-500)' : '#00D4AA' }}>
                  {isPaid ? 'Paid' : 'Free'}
                </span>
              </div>
              <p className="font-mono text-[10px] mt-1.5" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {priceHint}
              </p>
            </div>

            {/* Inline error banners */}
            {tryingPaid && (
              <div className="pl-3 py-2 pr-3 font-mono text-xs"
                style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
                Paid listings require <strong>{PAID_MIN_GRADE}</strong> grade.
              </div>
            )}
            {tryingPremium && (
              <div className="pl-3 py-2 pr-3 font-mono text-xs"
                style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
                Premium pricing (&gt; $30) requires <strong>{PREMIUM_MIN_GRADE}</strong> grade.
              </div>
            )}
            {tryingScaffold && (
              <div className="pl-3 py-2 pr-3 font-mono text-xs"
                style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
                Scaffold pricing (&gt; $100) requires <strong>Architect</strong> grade.
              </div>
            )}
            {tryingPromptPaid && (
              <div className="pl-3 py-2 pr-3 font-mono text-xs"
                style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
                Prompt packs must be free.
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
        )}

        <div className="flex justify-between gap-2 mt-6">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 font-mono text-xs tracking-wide"
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-secondary)', borderRadius: '2px', cursor: busy ? 'wait' : 'pointer' }}>
            CANCEL
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canPublish}
            className="px-5 py-2 font-mono text-xs font-medium tracking-wide"
            style={{
              background: canPublish ? 'var(--gold-500)' : 'rgba(255,255,255,0.06)',
              color:      canPublish ? 'var(--navy-900)' : 'var(--text-muted)',
              border: 'none', borderRadius: '2px',
              cursor: canPublish ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'PUBLISHING…' : isPaid ? (
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
