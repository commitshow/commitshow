import { useEffect, useState } from 'react'
import {
  supabase, PUBLIC_PROJECT_COLUMNS,
  LADDER_CATEGORIES, LADDER_CATEGORY_LABELS, LADDER_CATEGORY_HINTS,
  type Project, type ProjectImage, type LadderCategory,
} from '../lib/supabase'
import { ProjectImagesPicker } from './ProjectImagesPicker'

interface Props {
  project: Project
  onClose: () => void
  /** Called after a successful save with the updated row. */
  onSaved: (updated: Project) => void
}

const MAX_NAME_LEN = 80
const MAX_DESC_LEN = 500

// Minimal metadata edit for the creator. Fields that materially change the
// evaluation (github_url) trigger a user-visible warning; the actual
// re-analysis decision is left to the owner — they can click Re-analyze
// after saving if the repo URL changed.
export function EditProjectModal({ project, onClose, onSaved }: Props) {
  const [projectName, setProjectName] = useState(project.project_name)
  const [description, setDescription]   = useState(project.description ?? '')
  const [liveUrl,     setLiveUrl]       = useState(project.live_url ?? '')
  const [githubUrl,   setGithubUrl]     = useState(project.github_url ?? '')
  const [images,      setImages]        = useState<ProjectImage[]>(project.images ?? [])
  const [techInput,   setTechInput]     = useState('')
  const [techLayers,  setTechLayers]    = useState<string[]>(project.tech_layers ?? [])
  // 7-category use-case taxonomy (2026-04-30 redesign · §11-NEW.1.1).
  // Auto-detector now SUGGESTS via project.detected_category; the user
  // confirms or overrides here. Defaults to existing business_category
  // first, then detector's suggestion.
  const [category,    setCategory]      = useState<LadderCategory | ''>(
    (project.business_category ?? project.detected_category ?? '') as LadderCategory | ''
  )
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const githubChanged = (githubUrl.trim() || null) !== (project.github_url ?? null)

  const valid =
    projectName.trim().length > 0 &&
    projectName.trim().length <= MAX_NAME_LEN &&
    description.trim().length <= MAX_DESC_LEN &&
    images.length >= 1 &&
    /^https?:\/\//i.test(liveUrl.trim()) &&
    /github\.com\//i.test(githubUrl.trim())

  const addTech = () => {
    const t = techInput.trim()
    if (!t) return
    if (techLayers.some(x => x.toLowerCase() === t.toLowerCase())) { setTechInput(''); return }
    if (techLayers.length >= 12) { setError('Max 12 tech layers.'); return }
    setTechLayers([...techLayers, t])
    setTechInput('')
  }

  const removeTech = (t: string) => setTechLayers(techLayers.filter(x => x !== t))

  const handleSave = async () => {
    if (!valid) return
    setBusy(true); setError('')
    const patch: Partial<Project> = {
      project_name:  projectName.trim(),
      description:   description.trim(),
      live_url:      liveUrl.trim(),
      github_url:    githubUrl.trim(),
      images,                  // DB trigger syncs thumbnail_url / thumbnail_path
      tech_layers:   techLayers,
      updated_at:    new Date().toISOString(),
      ...(category ? { business_category: category } : {}),
    }
    const { data, error: err } = await supabase
      .from('projects')
      .update(patch)
      .eq('id', project.id)
      .select(PUBLIC_PROJECT_COLUMNS)
      .single()
    if (err) {
      setError(err.message || 'Save failed.')
      setBusy(false)
      return
    }
    onSaved(data as unknown as Project)
  }

  return (
    <div
      role="dialog" aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(6,12,26,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="card-navy w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        style={{ borderRadius: '2px' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid rgba(240,192,64,0.15)' }}>
          <div>
            <div className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--gold-500)' }}>
              // EDIT PROJECT
            </div>
            <div className="font-display font-bold text-lg mt-0.5" style={{ color: 'var(--cream)' }}>
              {project.project_name}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="font-mono text-lg px-2"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-5">
          <Field label="Project name" hint={`${projectName.length} / ${MAX_NAME_LEN}`}>
            <input
              value={projectName}
              onChange={e => setProjectName(e.target.value.slice(0, MAX_NAME_LEN))}
              className="w-full px-3 py-2 font-mono text-sm"
            />
          </Field>

          <Field label="Description" hint={`${description.length} / ${MAX_DESC_LEN}`}>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, MAX_DESC_LEN))}
              rows={3}
              className="w-full px-3 py-2 font-mono text-xs"
              style={{ lineHeight: 1.55 }}
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Live URL">
              <input
                value={liveUrl}
                onChange={e => setLiveUrl(e.target.value)}
                placeholder="https://yourapp.com"
                className="w-full px-3 py-2 font-mono text-xs"
              />
            </Field>
            <Field label="GitHub URL" warn={githubChanged ? 'Changing this invalidates prior analysis — re-analyze after saving.' : undefined}>
              <input
                value={githubUrl}
                onChange={e => setGithubUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                className="w-full px-3 py-2 font-mono text-xs"
              />
            </Field>
          </div>

          <Field label={`Tech layers (${techLayers.length} / 12)`} hint="Press Enter to add">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {techLayers.map(t => (
                <span key={t} className="font-mono text-[11px] px-2 py-0.5 flex items-center gap-1" style={{
                  background: 'rgba(240,192,64,0.08)',
                  border: '1px solid rgba(240,192,64,0.3)',
                  color: 'var(--gold-500)',
                  borderRadius: '2px',
                }}>
                  {t}
                  <button
                    onClick={() => removeTech(t)}
                    className="ml-0.5"
                    aria-label={`Remove ${t}`}
                    style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 12 }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {techLayers.length === 0 && (
                <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  none yet · e.g. nextjs · supabase · stripe
                </span>
              )}
            </div>
            <input
              value={techInput}
              onChange={e => setTechInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTech() } }}
              placeholder="add layer…"
              className="w-full px-3 py-2 font-mono text-xs"
            />
          </Field>

          <div>
            <span className="block font-mono text-[11px] tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
              PROJECT IMAGES · UP TO 3
            </span>
            <ProjectImagesPicker value={images} onChange={setImages} max={3} required />
          </div>

          {/* Category — auto-detector suggests, user picks final */}
          <div>
            <span className="block font-mono text-[11px] tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
              CATEGORY · LADDER PLACEMENT
            </span>
            <p className="font-mono text-[11px] mb-3" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Pick the use-case that best describes your project — this determines which leaderboard
              you compete on. {project.detected_category && project.detected_category !== category && (
                <>The auto-detector suggested <strong style={{ color: 'var(--gold-500)' }}>
                  {LADDER_CATEGORY_LABELS[project.detected_category as LadderCategory]}
                </strong>, but the call is yours.</>
              )}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {LADDER_CATEGORIES.map(c => {
                const active = category === c
                const suggested = project.detected_category === c
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className="text-left px-3 py-2.5 transition-colors"
                    style={{
                      background:  active ? 'rgba(240,192,64,0.10)' : 'rgba(255,255,255,0.02)',
                      border:      `1px solid ${active ? 'rgba(240,192,64,0.5)' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: '2px',
                      cursor:      'pointer',
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs font-medium" style={{ color: active ? 'var(--gold-500)' : 'var(--cream)' }}>
                        {LADDER_CATEGORY_LABELS[c]}
                      </span>
                      {suggested && !active && (
                        <span className="font-mono text-[9px] tracking-widest px-1.5 py-0.5" style={{
                          background: 'rgba(240,192,64,0.08)', color: 'var(--gold-500)',
                          border: '1px solid rgba(240,192,64,0.25)', borderRadius: '2px',
                        }}>
                          SUGGESTED
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] mt-1" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {LADDER_CATEGORY_HINTS[c]}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {error && (
            <div className="pl-3 py-2 pr-3 font-mono text-xs"
              style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 p-5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            onClick={onClose}
            disabled={busy}
            className="font-mono text-xs tracking-wide px-3 py-2"
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '2px',
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            disabled={!valid || busy}
            className="font-mono text-xs font-medium tracking-wide px-4 py-2"
            style={{
              background: valid && !busy ? 'var(--gold-500)' : 'rgba(255,255,255,0.06)',
              color: valid && !busy ? 'var(--navy-900)' : 'var(--text-muted)',
              border: 'none',
              borderRadius: '2px',
              cursor: valid && !busy ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'SAVING…' : 'SAVE CHANGES'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, warn, children }: {
  label: string
  hint?: string
  warn?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--gold-500)' }}>
          {label.toUpperCase()}
        </span>
        {hint && !warn && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{hint}</span>
        )}
      </div>
      {children}
      {warn && (
        <div className="mt-1 font-mono text-[10px]" style={{ color: '#F0C040', lineHeight: 1.5 }}>
          ⚠ {warn}
        </div>
      )}
    </label>
  )
}
