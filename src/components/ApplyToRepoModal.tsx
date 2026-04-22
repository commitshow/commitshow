import { useEffect, useMemo, useState } from 'react'
import { supabase, type MDLibraryFeedItem } from '../lib/supabase'
import { IconLink, IconWand } from './icons'
import {
  getGithubToken, isGithubLinked, linkGithub,
  listPublicRepos, suggestTargetPath,
  type GithubRepoSummary,
} from '../lib/github'

interface Props {
  item: MDLibraryFeedItem
  /** Optional: buyer's own project id to stamp into artifact_applications. */
  appliedToProject?: string | null
  onClose: () => void
  onSuccess: (prUrl: string) => void
}

type Step = 'auth' | 'repo' | 'form' | 'submitting' | 'done' | 'error'

export function ApplyToRepoModal({ item, appliedToProject, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('auth')
  const [repos, setRepos] = useState<GithubRepoSummary[]>([])
  const [repo, setRepo] = useState<GithubRepoSummary | null>(null)
  const [search, setSearch] = useState('')
  const [targetPath, setTargetPath] = useState('')
  const [variableValues, setVariableValues] = useState<Record<string, string>>({})
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const filePath = (item.storage_path ?? item.title ?? 'artifact.md')
  const suggestedPath = useMemo(
    () => suggestTargetPath(item.target_format ?? null, item.target_tools ?? [], filePath),
    [item.target_format, item.target_tools, filePath],
  )

  // Initial check: is GitHub linked + token present?
  useEffect(() => {
    (async () => {
      const linked = await isGithubLinked()
      const token = await getGithubToken()
      if (!linked || !token) { setStep('auth'); return }
      setStep('repo')
      const list = await listPublicRepos()
      setRepos(list)
    })()
  }, [])

  // When repo is chosen, precompute suggested path
  useEffect(() => {
    if (repo && !targetPath) setTargetPath(suggestedPath)
  }, [repo, suggestedPath, targetPath])

  const filteredRepos = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return repos
    return repos.filter(r => r.full_name.toLowerCase().includes(q))
  }, [repos, search])

  const handleLinkGithub = async () => {
    const { error } = await linkGithub(window.location.href)
    if (error) setErrorMsg(error)
  }

  const handleSubmit = async () => {
    setStep('submitting'); setErrorMsg(null)
    try {
      const token = await getGithubToken()
      if (!token) throw new Error('GitHub session expired. Re-link and try again.')
      if (!repo) throw new Error('Pick a repository first.')
      const [owner, repoName] = repo.full_name.split('/')

      const { data, error } = await supabase.functions.invoke('apply-artifact', {
        body: {
          md_id:              item.id,
          github_token:       token,
          owner,
          repo:               repoName,
          target_path:        targetPath,
          variable_values:    variableValues,
          applied_to_project: appliedToProject ?? null,
        },
      })
      if (error) throw new Error(error.message || 'Edge Function call failed')
      const resp = data as { ok: boolean; pr_url?: string; error?: string }
      if (!resp?.ok || !resp.pr_url) throw new Error(resp?.error || 'Unknown error creating PR')
      setPrUrl(resp.pr_url)
      setStep('done')
      onSuccess(resp.pr_url)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(6,12,26,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="card-navy w-full max-w-xl max-h-[90vh] overflow-auto"
        style={{ borderRadius: '2px' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid rgba(240,192,64,0.12)' }}>
          <div>
            <div className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--gold-500)' }}>
              // APPLY TO MY REPO
            </div>
            <div className="font-display font-bold text-lg mt-0.5" style={{ color: 'var(--cream)' }}>
              {item.title}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="font-mono text-lg"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          {step === 'auth' && <AuthStep onLink={handleLinkGithub} errorMsg={errorMsg} />}

          {step === 'repo' && (
            <RepoStep
              repos={filteredRepos}
              allRepos={repos}
              search={search}
              onSearch={setSearch}
              onPick={(r) => { setRepo(r); setStep('form') }}
            />
          )}

          {step === 'form' && repo && (
            <FormStep
              item={item}
              repo={repo}
              targetPath={targetPath}
              onTargetPath={setTargetPath}
              variableValues={variableValues}
              onVariableValues={setVariableValues}
              onBack={() => setStep('repo')}
              onSubmit={handleSubmit}
            />
          )}

          {step === 'submitting' && (
            <div className="py-10 text-center font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
              Opening pull request on {repo?.full_name}…
            </div>
          )}

          {step === 'done' && prUrl && (
            <div className="text-center py-6">
              <div className="font-display font-bold text-2xl mb-1" style={{ color: '#00D4AA' }}>✓ PR opened</div>
              <p className="font-mono text-xs mb-5" style={{ color: 'var(--text-secondary)' }}>
                Review the diff and merge when ready.
              </p>
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block font-mono text-xs font-medium tracking-wide px-4 py-2.5"
                style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', textDecoration: 'none', borderRadius: '2px' }}
              >
                OPEN PR ON GITHUB →
              </a>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-6">
              <div className="font-display font-bold text-lg mb-2" style={{ color: 'rgba(248,120,113,0.9)' }}>
                Something went wrong
              </div>
              <p className="font-mono text-xs mb-5" style={{ color: 'var(--text-secondary)' }}>
                {errorMsg}
              </p>
              <button
                onClick={() => setStep(repo ? 'form' : 'repo')}
                className="font-mono text-xs tracking-wide px-4 py-2.5"
                style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
              >
                TRY AGAIN
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Steps ───────────────────────────────────────────────────

function AuthStep({ onLink, errorMsg }: { onLink: () => void; errorMsg: string | null }) {
  return (
    <div className="text-center py-4">
      <div className="font-display font-bold text-lg mb-2" style={{ color: 'var(--cream)' }}>
        Link your GitHub first
      </div>
      <p className="font-mono text-[11px] mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        We use your GitHub login (scope: <code>public_repo</code>) to open a pull request on your behalf.
        No private-repo access, no write keys stored — just a single PR you review before merging.
      </p>
      <button
        onClick={onLink}
        className="font-mono text-xs font-medium tracking-wide px-4 py-2.5"
        style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
      >
        <span className="inline-flex items-center justify-center gap-1.5"><IconLink size={12} /> LINK GITHUB</span>
      </button>
      {errorMsg && (
        <p className="font-mono text-[11px] mt-4" style={{ color: 'rgba(248,120,113,0.85)' }}>{errorMsg}</p>
      )}
    </div>
  )
}

function RepoStep({
  repos, allRepos, search, onSearch, onPick,
}: {
  repos: GithubRepoSummary[]
  allRepos: GithubRepoSummary[]
  search: string
  onSearch: (s: string) => void
  onPick: (r: GithubRepoSummary) => void
}) {
  if (allRepos.length === 0) {
    return (
      <div className="text-center py-6 font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
        Loading your repos…
        <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
          (public repos only — private access isn't requested)
        </div>
      </div>
    )
  }
  return (
    <div>
      <label className="block font-mono text-[10px] tracking-widest mb-1.5" style={{ color: 'var(--text-label)' }}>
        REPOSITORY
      </label>
      <input
        type="text"
        value={search}
        onChange={e => onSearch(e.target.value)}
        placeholder="Search owner/repo…"
        className="w-full font-mono text-sm px-3 py-2 mb-3"
        style={{
          background: 'rgba(6,12,26,0.5)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'var(--cream)',
          borderRadius: '2px',
        }}
      />
      <div className="max-h-[50vh] overflow-auto space-y-1">
        {repos.length === 0 && (
          <div className="py-4 text-center font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            No matches.
          </div>
        )}
        {repos.map(r => (
          <button
            key={r.id}
            onClick={() => onPick(r)}
            className="w-full text-left px-3 py-2 font-mono text-xs flex items-center justify-between gap-2"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              color: 'var(--cream)',
              borderRadius: '2px',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,192,64,0.06)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
          >
            <span className="truncate">{r.full_name}</span>
            <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
              {r.default_branch}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function FormStep({
  item, repo, targetPath, onTargetPath, variableValues, onVariableValues, onBack, onSubmit,
}: {
  item: MDLibraryFeedItem
  repo: GithubRepoSummary
  targetPath: string
  onTargetPath: (v: string) => void
  variableValues: Record<string, string>
  onVariableValues: (v: Record<string, string>) => void
  onBack: () => void
  onSubmit: () => void
}) {
  const vars = item.variables ?? []
  const missing = vars.filter(v => !variableValues[v.name] || !variableValues[v.name].trim())
  const canSubmit = targetPath.trim().length > 0

  return (
    <div>
      <div className="mb-4 font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        Target: <span style={{ color: 'var(--cream)' }}>{repo.full_name}</span> · branch{' '}
        <span style={{ color: 'var(--cream)' }}>{repo.default_branch}</span>
      </div>

      <label className="block font-mono text-[10px] tracking-widest mb-1.5" style={{ color: 'var(--text-label)' }}>
        FILE PATH IN YOUR REPO
      </label>
      <input
        type="text"
        value={targetPath}
        onChange={e => onTargetPath(e.target.value)}
        placeholder="CLAUDE.md"
        className="w-full font-mono text-sm px-3 py-2 mb-4"
        style={{
          background: 'rgba(6,12,26,0.5)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'var(--cream)',
          borderRadius: '2px',
        }}
      />

      {vars.length > 0 && (
        <div className="mb-4">
          <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-label)' }}>
            FILL IN VARIABLES
          </div>
          <div className="space-y-2">
            {vars.map(v => (
              <div key={v.name}>
                <label className="block font-mono text-[11px] mb-1" style={{ color: 'var(--text-secondary)' }}>
                  <code style={{ color: '#00D4AA' }}>{`{{${v.name}}}`}</code>
                  {v.description && <span style={{ color: 'var(--text-muted)' }}> · {v.description}</span>}
                </label>
                <input
                  type="text"
                  value={variableValues[v.name] ?? v.default ?? ''}
                  onChange={e => onVariableValues({ ...variableValues, [v.name]: e.target.value })}
                  placeholder={v.default || ''}
                  className="w-full font-mono text-xs px-3 py-1.5"
                  style={{
                    background: 'rgba(6,12,26,0.5)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'var(--cream)',
                    borderRadius: '2px',
                  }}
                />
              </div>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="font-mono text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
              Tip: unfilled variables stay as <code>{'{{VAR}}'}</code> in the PR so you can replace them later.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <button
          onClick={onBack}
          className="font-mono text-xs tracking-wide px-3 py-2"
          style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px', cursor: 'pointer' }}
        >
          ← CHANGE REPO
        </button>
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="font-mono text-xs font-medium tracking-wide px-4 py-2"
          style={{
            background: canSubmit ? 'var(--gold-500)' : 'rgba(240,192,64,0.25)',
            color: 'var(--navy-900)',
            border: 'none',
            borderRadius: '2px',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          <span className="inline-flex items-center justify-center gap-1.5"><IconWand size={12} /> OPEN PR ON {repo.name.toUpperCase()}</span>
        </button>
      </div>
    </div>
  )
}
