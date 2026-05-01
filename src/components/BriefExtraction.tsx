import { useState, useMemo, useEffect } from 'react'
import {
  getExtractionPrompt,
  parseExtractionOutput,
  integrityScore,
  type ExtractedBrief,
  type ParseResult,
} from '../lib/extractionPrompt'
import { IconLock } from './icons'

type Phase = 'intro' | 'copy' | 'verify' | 'review'

interface BriefExtractionProps {
  githubUrl: string                           // needed to probe the repo
  onBriefReady: (brief: ExtractedBrief, raw: string, source: 'github' | 'paste') => void
  onBack: () => void
}

const PHASE_LABEL: Record<Phase, string> = {
  intro:  'How this works',
  copy:   'Copy template',
  verify: 'Check your repo',
  review: 'Review & confirm',
}

const PHASE_ORDER: Phase[] = ['intro', 'copy', 'verify', 'review']

const CANONICAL_PATH = '.commit/brief.md'

type FetchStatus = 'idle' | 'fetching' | 'found' | 'not_found' | 'error'

// Priority search order. Exact hits first; then fuzzy patterns.
// Legacy `.debut/` paths are still probed as a secondary fallback so early
// adopters who already committed the old path aren't broken instantly.
const EXACT_BRIEF_PATHS = [
  '.commit/brief.md', 'commit/brief.md', 'COMMIT.md', 'docs/commit-brief.md',
  '.debut/brief.md',  'debut/brief.md',  'DEBUT.md',  'docs/debut-brief.md',
]
const FUZZY_BRIEF_PATTERNS: RegExp[] = [
  /(^|\/)\.commit\/brief\.md$/i,
  /(^|\/)commit\/brief\.md$/i,
  /(^|\/)commit[-_]?brief\.md$/i,
  /(^|\/)COMMIT\.md$/i,
  /(^|\/)\.debut\/brief\.md$/i,
  /(^|\/)debut\/brief\.md$/i,
  /(^|\/)debut[-_]?brief\.md$/i,
  /(^|\/)DEBUT\.md$/i,
  /(^|\/)brief\.md$/i,
]

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/\s?#]+)/i)
  if (!m) return null
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') }
}

export function BriefExtraction({ githubUrl, onBriefReady, onBack }: BriefExtractionProps) {
  const [phase, setPhase] = useState<Phase>('intro')
  const [copied, setCopied] = useState(false)
  // Sticky flag — once the user has copied at least once, the "Next" CTA stays
  // gold so they don't get the active button taken away the instant the
  // ✓ COPIED toast fades. The transient `copied` flag still drives the COPY
  // button's confirmation state on each click.
  const [everCopied, setEverCopied] = useState(false)
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('idle')
  const [fetchErrorMsg, setFetchErrorMsg] = useState<string>('')
  const [foundPath, setFoundPath] = useState<string>('')
  const [candidateHints, setCandidateHints] = useState<string[]>([])
  const [privateRepoDetected, setPrivateRepoDetected] = useState(false)
  const [rawMd, setRawMd] = useState<string>('')
  const [source, setSource] = useState<'github' | 'paste'>('github')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const promptText = useMemo(() => getExtractionPrompt(), [])
  const phaseIndex = PHASE_ORDER.indexOf(phase)
  const repoParts = parseGithubUrl(githubUrl)

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(promptText) }
    catch {
      const ta = document.createElement('textarea')
      ta.value = promptText
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopied(true); setEverCopied(true); setTimeout(() => setCopied(false), 2500)
  }

  const fetchFromGitHub = async () => {
    if (!repoParts) return
    setFetchStatus('fetching')
    setFetchErrorMsg('')
    setCandidateHints([])
    setPrivateRepoDetected(false)
    setFoundPath('')

    const { owner, repo } = repoParts

    try {
      // 1) Full repo tree — lets us find the file wherever the AI put it.
      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
        { headers: { Accept: 'application/vnd.github+json' } },
      )

      if (!treeRes.ok) {
        if (treeRes.status === 404) {
          // 404 from the public API means either: repo is private, or typo in the name.
          // Disambiguate by probing the owner's public repo list — if the owner exists but
          // this specific name isn't in the public list, it's almost certainly private.
          let ownerExists = false
          try {
            const ownerRes = await fetch(`https://api.github.com/users/${owner}`, {
              headers: { Accept: 'application/vnd.github+json' },
            })
            ownerExists = ownerRes.ok
          } catch { /* best-effort */ }

          setFetchStatus('error')
          setPrivateRepoDetected(ownerExists)  // owner exists → likely private, not typo
          setFetchErrorMsg(ownerExists
            ? `Looks like ${owner}/${repo} is a private repository.`
            : `Couldn't find ${owner}/${repo} on GitHub. Double-check the owner and repository name (case/hyphens matter).`)
        } else if (treeRes.status === 403) {
          setFetchStatus('error')
          setFetchErrorMsg(`GitHub rate limit hit (403). Wait a minute and try again.`)
        } else {
          setFetchStatus('error')
          setFetchErrorMsg(`GitHub returned ${treeRes.status} for ${owner}/${repo}. Make sure the repo is public.`)
        }
        return
      }
      const treeData = await treeRes.json()
      const blobs: Array<{ path: string; type: string }> = (treeData.tree ?? []).filter((t: { type: string }) => t.type === 'blob')

      // 2) Exact priority match
      let matched: string | null = null
      for (const exact of EXACT_BRIEF_PATHS) {
        if (blobs.some(b => b.path === exact)) { matched = exact; break }
      }
      // 3) Fuzzy pattern fallback — any brief.md anywhere
      if (!matched) {
        for (const pattern of FUZZY_BRIEF_PATTERNS) {
          const hit = blobs.find(b => pattern.test(b.path))
          if (hit) { matched = hit.path; break }
        }
      }

      if (!matched) {
        // Show hints: any path containing "brief" / "commit" / "debut" so the user
        // can see what exists. Debut is kept for legacy brief files.
        const hints = blobs
          .filter(b => /brief|commit|debut/i.test(b.path))
          .map(b => b.path)
          .slice(0, 10)
        setCandidateHints(hints)
        setFetchStatus('not_found')
        return
      }

      // 4) Raw fetch the matched file
      const rawUrl = `https://raw.githubusercontent.com/${repoParts.owner}/${repoParts.repo}/HEAD/${encodeURI(matched)}`
      const res = await fetch(rawUrl)
      if (!res.ok) {
        setFetchStatus('error')
        setFetchErrorMsg(`Found at ${matched} but couldn't read raw file (HTTP ${res.status}).`)
        return
      }
      const text = await res.text()
      if (!text.trim()) {
        setFetchStatus('error')
        setFetchErrorMsg(`File at ${matched} is empty.`)
        return
      }

      setFoundPath(matched)
      setRawMd(text)
      setSource('github')
      setParseResult(parseExtractionOutput(text))
      setFetchStatus('found')
      setPhase('review')
    } catch (e) {
      setFetchStatus('error')
      setFetchErrorMsg(`Network error: ${(e as Error).message}`)
    }
  }

  useEffect(() => { setFetchStatus('idle') }, [phase])

  // When the GitHub URL prop changes (user went back to Step 1 and edited it),
  // clear all stale fetch state so the user doesn't see an old error referencing the wrong repo.
  useEffect(() => {
    setFetchStatus('idle')
    setFetchErrorMsg('')
    setCandidateHints([])
    setPrivateRepoDetected(false)
    setFoundPath('')
  }, [githubUrl])

  const usable = parseResult
    && parseResult.warnings.filter(w => /missing/i.test(w)).length === 0
    && parseResult.parsed.core_intent.problem
    && parseResult.parsed.stack_fingerprint.frontend

  return (
    <div className="space-y-8">
      {/* ── progress bar ── */}
      <div className="flex items-center gap-2">
        {PHASE_ORDER.map((p, i) => {
          const done = i < phaseIndex
          const active = i === phaseIndex
          return (
            <div key={p} className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-6 h-6 font-mono text-xs"
                  style={{
                    background: done ? 'rgba(0,212,170,0.15)' : active ? 'var(--gold-500)' : 'rgba(255,255,255,0.05)',
                    color: done ? '#00D4AA' : active ? 'var(--navy-900)' : 'rgba(248,245,238,0.3)',
                    border: done ? '1px solid rgba(0,212,170,0.35)' : 'none',
                    borderRadius: '2px',
                  }}>
                  {done ? '✓' : i + 1}
                </div>
                <span className="font-mono text-xs tracking-wide hidden md:inline"
                  style={{ color: active ? 'var(--gold-500)' : done ? 'rgba(248,245,238,0.5)' : 'rgba(248,245,238,0.3)' }}>
                  {PHASE_LABEL[p]}
                </span>
              </div>
              {i < PHASE_ORDER.length - 1 && (
                <div className="flex-1 h-px" style={{ background: done ? 'rgba(0,212,170,0.35)' : 'rgba(255,255,255,0.06)' }} />
              )}
            </div>
          )
        })}
      </div>

      {/* ── Phase: intro ── */}
      {phase === 'intro' && (
        <div className="space-y-5">
          <div>
            <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>// STEP 2 · BUILD BRIEF</div>
            <h3 className="font-display font-bold text-2xl mb-3" style={{ color: 'var(--cream)' }}>
              Commit your Build Brief to the repo.
            </h3>
            <p className="font-light" style={{ color: 'rgba(248,245,238,0.65)', lineHeight: 1.75 }}>
              No forms to fill. Your AI generates the brief from actual project state and commits it as
              <code className="mx-1.5 px-1.5 py-0.5" style={{ background: 'rgba(240,192,64,0.1)', color: 'var(--gold-500)', borderRadius: '2px', fontSize: '0.9em' }}>.commit/brief.md</code>
              — we read it from Git with commit proof.
            </p>
          </div>

          <div className="card-navy p-5" style={{ borderRadius: '2px', borderColor: 'rgba(240,192,64,0.2)' }}>
            <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>WHAT YOU'LL DO</div>
            <div className="space-y-3">
              {[
                { n: '1', h: 'Open the AI coding tool you built this project with', d: 'Any agent that can read your codebase and write files to your repo.' },
                { n: '2', h: 'Paste the prompt — your agent writes the file', d: `It will create ${CANONICAL_PATH} and commit it. You do not need to paste the content back; we read the file directly from the commit.` },
                { n: '3', h: 'Click "Check my repo" here', d: "We fetch the committed file, verify its signature, and run the evaluation. Zero copy-paste." },
              ].map(i => (
                <div key={i.n} className="grid grid-cols-[32px_1fr] gap-3">
                  <div className="font-mono text-xs flex items-center justify-center h-6 w-6"
                    style={{ color: 'var(--gold-500)', border: '1px solid rgba(240,192,64,0.3)', borderRadius: '2px' }}>{i.n}</div>
                  <div>
                    <div className="font-medium text-sm" style={{ color: 'var(--cream)' }}>{i.h}</div>
                    <div className="text-xs font-light mt-0.5" style={{ color: 'rgba(248,245,238,0.5)', lineHeight: 1.6 }}>{i.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pl-3 py-2 pr-3 font-mono text-xs" style={{
            borderLeft: '2px solid var(--gold-500)', background: 'rgba(240,192,64,0.04)',
            color: 'rgba(248,245,238,0.6)', lineHeight: 1.6,
          }}>
            Why commit to the repo? Git history becomes the integrity proof — we can verify the brief
            against the SHA at submission time. Pasting only happens as a fallback if you really can't commit.
          </div>

          <div className="flex justify-between pt-2">
            <button onClick={onBack} className="px-4 py-2 font-mono text-xs tracking-wide"
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(248,245,238,0.5)', borderRadius: '2px', cursor: 'pointer' }}>
              ← BACK
            </button>
            <button onClick={() => setPhase('copy')} className="px-6 py-2 font-mono text-xs font-medium tracking-wide"
              style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}>
              GOT IT · NEXT →
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: copy ── */}
      {phase === 'copy' && (
        <div className="space-y-5">
          <div>
            <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>// PHASE 2/4</div>
            <h3 className="font-display font-bold text-xl mb-2" style={{ color: 'var(--cream)' }}>
              Copy this prompt into your AI.
            </h3>
            <p className="text-sm font-light" style={{ color: 'rgba(248,245,238,0.6)', lineHeight: 1.7 }}>
              Paste it as a new message. The prompt already tells your AI to <strong style={{ color: 'var(--cream)' }}>
              write <code>{CANONICAL_PATH}</code> and commit & push</strong> — it should not print the content in chat.
              Just confirm "file created and pushed" when it's done.
            </p>
          </div>

          <div className="relative"
            style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(240,192,64,0.2)', borderRadius: '2px' }}>
            <div className="flex items-center justify-between px-4 py-2.5"
              style={{ borderBottom: '1px solid rgba(240,192,64,0.12)' }}>
              <span className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
                PROJECT REVIEW TEMPLATE
              </span>
              <button onClick={handleCopy} className="font-mono text-xs tracking-wide px-3 py-1 transition-colors"
                style={{
                  background: copied ? 'rgba(0,212,170,0.15)' : 'rgba(240,192,64,0.1)',
                  border: `1px solid ${copied ? 'rgba(0,212,170,0.4)' : 'rgba(240,192,64,0.3)'}`,
                  color: copied ? '#00D4AA' : 'var(--gold-500)',
                  borderRadius: '2px', cursor: 'pointer',
                }}>
                {copied ? '✓ COPIED' : '📋 COPY'}
              </button>
            </div>
            <pre className="p-4 font-mono text-[11px] leading-[1.55] overflow-auto whitespace-pre-wrap"
              style={{ color: 'rgba(248,245,238,0.7)', maxHeight: '280px' }}>
              {promptText}
            </pre>
          </div>

          <div className="pl-3 py-2 pr-3 font-mono text-xs" style={{
            borderLeft: '2px solid var(--gold-500)',
            background: 'rgba(240,192,64,0.04)',
            color: 'rgba(248,245,238,0.6)',
            lineHeight: 1.6,
          }}>
            The prompt above is self-contained — it tells your AI to write the file and commit directly.
            If your AI can't write files (e.g. plain chat-only), it will fall back to outputting the markdown;
            in that case use the paste fallback in the next step.
          </div>

          <div className="flex justify-between pt-2">
            <button onClick={() => setPhase('intro')} className="px-4 py-2 font-mono text-xs tracking-wide"
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(248,245,238,0.5)', borderRadius: '2px', cursor: 'pointer' }}>
              ← BACK
            </button>
            <button onClick={() => setPhase('verify')} className="px-6 py-2 font-mono text-xs font-medium tracking-wide"
              style={{
                background: everCopied ? 'var(--gold-500)' : 'rgba(240,192,64,0.2)',
                color: everCopied ? 'var(--navy-900)' : 'rgba(248,245,238,0.6)',
                border: 'none', borderRadius: '2px', cursor: 'pointer',
              }}>
              TEMPLATE COPIED · NEXT →
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: verify (fetch from GitHub) ── */}
      {phase === 'verify' && (
        <div className="space-y-5">
          <div>
            <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>// PHASE 3/4</div>
            <h3 className="font-display font-bold text-xl mb-2" style={{ color: 'var(--cream)' }}>
              Check that the brief is committed.
            </h3>
            <p className="text-sm font-light" style={{ color: 'rgba(248,245,238,0.6)', lineHeight: 1.7 }}>
              Once your AI has created and pushed <code>{CANONICAL_PATH}</code> (or similar), click the button below.
              We fetch from <span style={{ color: 'var(--cream)' }}>{repoParts ? `${repoParts.owner}/${repoParts.repo}` : 'your repo'}</span>
              {' '}and verify.
            </p>
          </div>

          <div className="card-navy p-5 text-center" style={{ borderRadius: '2px' }}>
            <button onClick={fetchFromGitHub}
              disabled={!repoParts || fetchStatus === 'fetching'}
              className="px-6 py-2.5 font-mono text-sm font-medium tracking-wide transition-all"
              style={{
                background: fetchStatus === 'fetching' ? 'rgba(240,192,64,0.4)' : 'var(--gold-500)',
                color: 'var(--navy-900)', border: 'none', borderRadius: '2px',
                cursor: (!repoParts || fetchStatus === 'fetching') ? 'not-allowed' : 'pointer',
              }}>
              {fetchStatus === 'fetching' ? 'SCANNING REPO…' : '🔍 CHECK MY REPO'}
            </button>

            {fetchStatus === 'not_found' && (
              <div className="mt-4 pl-3 py-2 pr-3 text-left font-mono text-xs"
                style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)', lineHeight: 1.65 }}>
                <div>Brief file not found anywhere in the repo tree.</div>
                <div style={{ color: 'rgba(248,245,238,0.4)', marginTop: '4px' }}>
                  Expected: <code>.commit/brief.md</code> · or any <code>brief.md</code> under a commit-related folder.
                </div>
                {candidateHints.length > 0 && (
                  <div className="mt-3" style={{ color: 'rgba(248,245,238,0.7)' }}>
                    <div style={{ color: 'var(--gold-500)' }}>Files containing "brief", "commit", or "debut" we did find:</div>
                    <ul className="mt-1 pl-4" style={{ listStyle: 'disc' }}>
                      {candidateHints.map(p => <li key={p}>{p}</li>)}
                    </ul>
                    <div className="mt-2" style={{ color: 'rgba(248,245,238,0.5)' }}>
                      If one of these is the right file, ask your AI to rename/move it to <code>.commit/brief.md</code>.
                    </div>
                  </div>
                )}
                {candidateHints.length === 0 && (
                  <div className="mt-2" style={{ color: 'rgba(248,245,238,0.55)' }}>
                    No brief-like files detected. Make sure your AI (a) wrote the file, (b) committed, (c) pushed to the default branch, and (d) the repo is public.
                  </div>
                )}
              </div>
            )}

            {fetchStatus === 'error' && !privateRepoDetected && (
              <div className="mt-4 pl-3 py-2 pr-3 text-left font-mono text-xs"
                style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)', lineHeight: 1.65 }}>
                <div>{fetchErrorMsg}</div>
              </div>
            )}

            {fetchStatus === 'error' && privateRepoDetected && repoParts && (
              <div className="mt-4 text-left"
                style={{ border: '1px solid rgba(240,192,64,0.35)', background: 'rgba(240,192,64,0.05)', borderRadius: '2px' }}>
                <div className="px-4 py-2.5"
                  style={{ borderBottom: '1px solid rgba(240,192,64,0.2)', background: 'rgba(240,192,64,0.08)' }}>
                  <div className="font-mono text-xs tracking-widest inline-flex items-center gap-1.5" style={{ color: 'var(--gold-500)' }}>
                    <IconLock size={12} /> PRIVATE REPOSITORY DETECTED
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'rgba(248,245,238,0.7)' }}>
                    {fetchErrorMsg} We can only analyze <strong style={{ color: 'var(--cream)' }}>public</strong> repos
                    — transparency is core to how Scouts evaluate projects.
                  </div>
                </div>

                <div className="px-4 py-3">
                  <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
                    HOW TO MAKE IT PUBLIC (30 seconds)
                  </div>
                  <ol className="space-y-2.5">
                    {[
                      <>Open <a href={`https://github.com/${repoParts.owner}/${repoParts.repo}/settings`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ color: 'var(--gold-500)', textDecoration: 'underline' }}>
                          Settings → General
                        </a> on GitHub.</>,
                      <>Scroll to the bottom section labeled <code style={{ color: 'var(--cream)' }}>Danger Zone</code>.</>,
                      <>Click <code style={{ color: 'var(--cream)' }}>Change visibility</code> → <code style={{ color: 'var(--cream)' }}>Change to public</code>.</>,
                      <>Type the repo name to confirm, then <code style={{ color: 'var(--cream)' }}>I understand, make this repository public</code>.</>,
                      <>Come back here and click <strong style={{ color: 'var(--gold-500)' }}>CHECK MY REPO</strong> again.</>,
                    ].map((step, i) => (
                      <li key={i} className="grid grid-cols-[24px_1fr] gap-2 text-xs" style={{ color: 'rgba(248,245,238,0.75)', lineHeight: 1.6 }}>
                        <div className="flex items-center justify-center font-mono"
                          style={{
                            width: '20px', height: '20px',
                            color: 'var(--gold-500)',
                            border: '1px solid rgba(240,192,64,0.35)',
                            borderRadius: '2px',
                            fontSize: '10px',
                          }}>
                          {i + 1}
                        </div>
                        <div>{step}</div>
                      </li>
                    ))}
                  </ol>

                  <a href={`https://github.com/${repoParts.owner}/${repoParts.repo}/settings`}
                    target="_blank" rel="noopener noreferrer"
                    className="mt-4 inline-block px-4 py-2 font-mono text-xs font-medium tracking-wide"
                    style={{
                      background: 'var(--gold-500)',
                      color: 'var(--navy-900)',
                      textDecoration: 'none',
                      borderRadius: '2px',
                    }}>
                    OPEN REPO SETTINGS ↗
                  </a>

                  <div className="mt-4 pl-3 py-2 pr-3 text-xs"
                    style={{ borderLeft: '2px solid rgba(248,245,238,0.2)', background: 'rgba(255,255,255,0.02)', color: 'rgba(248,245,238,0.55)', lineHeight: 1.6 }}>
                    <strong style={{ color: 'var(--cream)' }}>Why public?</strong> commit.show's league model requires
                    Scouts and the community to inspect the actual code to evaluate you.
                    A private repo can't be judged fairly. You can always re-privatize after the season ends.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Paste fallback — collapsed by default */}
          <div>
            <button onClick={() => setPasteOpen(!pasteOpen)}
              className="w-full text-left font-mono text-xs tracking-wide px-3 py-2 flex items-center justify-between"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(248,245,238,0.45)',
                borderRadius: '2px', cursor: 'pointer',
              }}>
              <span>{pasteOpen ? '▼' : '▶'} FALLBACK · paste MD manually (lower trust)</span>
              <span style={{ color: 'rgba(248,245,238,0.3)' }}>optional</span>
            </button>
            {pasteOpen && (
              <div className="mt-3 space-y-3">
                <p className="font-mono text-xs" style={{ color: 'rgba(248,245,238,0.4)', lineHeight: 1.6 }}>
                  If you genuinely can't commit (private repo, sandboxed AI), paste the MD here.
                  Tampering detection will flag this source as "pasted — unverified".
                </p>
                <textarea
                  value={source === 'paste' ? rawMd : ''}
                  onChange={e => { setRawMd(e.target.value); setSource('paste'); setParseResult(null) }}
                  placeholder="# Core Intent&#10;PROBLEM: ..."
                  rows={10}
                  className="w-full px-4 py-3 font-mono text-xs"
                  style={{ lineHeight: 1.65 }}
                />
                <button
                  onClick={() => {
                    if (!rawMd.trim()) return
                    setSource('paste')
                    setParseResult(parseExtractionOutput(rawMd))
                    setPhase('review')
                  }}
                  disabled={!rawMd.trim() || source !== 'paste'}
                  className="px-4 py-2 font-mono text-xs tracking-wide"
                  style={{
                    background: (rawMd.trim() && source === 'paste') ? 'rgba(240,192,64,0.5)' : 'rgba(255,255,255,0.06)',
                    color: (rawMd.trim() && source === 'paste') ? 'var(--navy-900)' : 'rgba(248,245,238,0.3)',
                    border: 'none', borderRadius: '2px',
                    cursor: (rawMd.trim() && source === 'paste') ? 'pointer' : 'not-allowed',
                  }}>
                  PARSE PASTED MD →
                </button>
              </div>
            )}
          </div>

          <div className="flex justify-between pt-2">
            <button onClick={() => setPhase('copy')} className="px-4 py-2 font-mono text-xs tracking-wide"
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(248,245,238,0.5)', borderRadius: '2px', cursor: 'pointer' }}>
              ← BACK
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: review ── */}
      {phase === 'review' && parseResult && (
        <div className="space-y-5">
          <div>
            <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>// PHASE 4/4</div>
            <h3 className="font-display font-bold text-xl mb-2" style={{ color: 'var(--cream)' }}>
              Review the brief.
            </h3>
            <div className="flex items-center gap-3 font-mono text-xs flex-wrap" style={{ color: 'rgba(248,245,238,0.55)' }}>
              <span>
                {parseResult.sectionsFound.length} section{parseResult.sectionsFound.length === 1 ? '' : 's'} · integrity {integrityScore(parseResult.parsed)}/10
              </span>
              <span className="px-2 py-0.5" style={{
                background: source === 'github' ? 'rgba(0,212,170,0.12)' : 'rgba(212,146,42,0.15)',
                color: source === 'github' ? '#00D4AA' : '#D4922A',
                border: `1px solid ${source === 'github' ? 'rgba(0,212,170,0.3)' : 'rgba(212,146,42,0.35)'}`,
                borderRadius: '2px',
              }}>
                {source === 'github' ? '✓ FROM GITHUB COMMIT' : '⚠ PASTED (UNVERIFIED)'}
              </span>
              {source === 'github' && foundPath && (
                <span style={{ color: 'rgba(248,245,238,0.4)' }}>
                  found at <code style={{ color: 'var(--gold-500)' }}>{foundPath}</code>
                </span>
              )}
            </div>
          </div>

          {parseResult.warnings.length > 0 && (
            <div className="pl-3 py-2.5 pr-3 font-mono text-xs"
              style={{ borderLeft: '2px solid var(--scarlet)', background: 'rgba(200,16,46,0.05)', color: 'rgba(248,120,113,0.85)', lineHeight: 1.6 }}>
              <div style={{ color: 'var(--scarlet)', marginBottom: '4px' }}>⚠ PARSING WARNINGS</div>
              {parseResult.warnings.map((w, i) => <div key={i}>· {w}</div>)}
              <div className="mt-2" style={{ color: 'rgba(248,245,238,0.5)' }}>
                Regenerate via your AI and re-commit, or continue knowing the analyzer will factor these in.
              </div>
            </div>
          )}

          <ParsePreview parsed={parseResult.parsed} />

          <div className="flex justify-between pt-2">
            <button onClick={() => setPhase('verify')} className="px-4 py-2 font-mono text-xs tracking-wide"
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(248,245,238,0.5)', borderRadius: '2px', cursor: 'pointer' }}>
              ← RE-FETCH / REPASTE
            </button>
            <button onClick={() => onBriefReady(parseResult.parsed, rawMd, source)} disabled={!usable}
              className="px-6 py-2 font-mono text-xs font-medium tracking-wide"
              style={{
                background: usable ? 'var(--gold-500)' : 'rgba(255,255,255,0.06)',
                color: usable ? 'var(--navy-900)' : 'rgba(248,245,238,0.3)',
                border: 'none', borderRadius: '2px', cursor: usable ? 'pointer' : 'not-allowed',
              }}>
              USE THIS BRIEF · RUN ANALYSIS →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Review preview sub-components (same as before) ───────────
function ParsePreview({ parsed }: { parsed: ExtractedBrief }) {
  return (
    <div className="card-navy p-5 space-y-5" style={{ borderRadius: '2px' }}>
      <Section title="CORE INTENT">
        <KV k="Problem"     v={parsed.core_intent.problem} />
        <KV k="Features"    v={parsed.core_intent.features} />
        <KV k="Target user" v={parsed.core_intent.target_user} />
      </Section>

      <Section title="STACK FINGERPRINT">
        {Object.entries(parsed.stack_fingerprint).map(([k, v]) => (
          <KV key={k} k={k.replace(/_/g, ' ')} v={v || '?'} />
        ))}
      </Section>

      <Section title={`FAILURE LOG · ${parsed.failure_log.length} entr${parsed.failure_log.length === 1 ? 'y' : 'ies'}`}>
        {parsed.failure_log.length === 0 && <EmptyHint />}
        {parsed.failure_log.map((f, i) => (
          <div key={i} className="mb-3 pb-3 last:mb-0 last:pb-0" style={{ borderBottom: i < parsed.failure_log.length - 1 ? '1px dashed rgba(255,255,255,0.05)' : 'none' }}>
            <div className="font-mono text-xs font-medium mb-1" style={{ color: 'var(--cream)' }}>#{i + 1} · {f.symptom || '—'}</div>
            {f.cause      && <div className="text-xs mt-0.5" style={{ color: 'rgba(248,245,238,0.55)' }}>→ Cause: {f.cause}</div>}
            {f.fix        && <div className="text-xs" style={{ color: 'rgba(248,245,238,0.55)' }}>→ Fix: {f.fix}</div>}
            {f.prevention && <div className="text-xs" style={{ color: 'rgba(248,245,238,0.55)' }}>→ Prevention: {f.prevention}</div>}
          </div>
        ))}
      </Section>

      <Section title={`DECISION ARCHAEOLOGY · ${parsed.decision_archaeology.length} entr${parsed.decision_archaeology.length === 1 ? 'y' : 'ies'}`}>
        {parsed.decision_archaeology.length === 0 && <EmptyHint />}
        {parsed.decision_archaeology.map((d, i) => (
          <div key={i} className="mb-2">
            <div className="font-mono text-xs" style={{ color: 'var(--cream)' }}>
              #{i + 1} · <span style={{ color: 'rgba(248,245,238,0.5)' }}>{d.original_plan || '?'}</span>
              <span style={{ color: 'rgba(248,245,238,0.35)' }}> → </span>
              <span style={{ color: 'var(--gold-500)' }}>{d.final_choice || '?'}</span>
            </div>
            {d.outcome && <div className="text-xs mt-0.5" style={{ color: 'rgba(248,245,238,0.55)' }}>Outcome: {d.outcome}</div>}
          </div>
        ))}
      </Section>

      <Section title={`AI DELEGATION MAP · ${parsed.ai_delegation_map.length} rows`}>
        {parsed.ai_delegation_map.length === 0 && <EmptyHint />}
        {parsed.ai_delegation_map.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-3 py-1 text-xs items-center">
            <span style={{ color: 'var(--cream)' }}>{r.domain}</span>
            <span className="font-mono">
              <span style={{ color: '#7B6CD9' }}>AI {r.ai_pct}%</span>
              <span style={{ color: 'rgba(248,245,238,0.3)' }}> · </span>
              <span style={{ color: 'var(--cream)' }}>Me {r.human_pct}%</span>
            </span>
          </div>
        ))}
      </Section>

      <Section title="LIVE PROOF">
        <KV k="Deployed URL" v={parsed.live_proof.deployed_url} />
        <KV k="GitHub URL"   v={parsed.live_proof.github_url} />
        <KV k="API"          v={parsed.live_proof.api_endpoints} />
        <KV k="On-chain"     v={parsed.live_proof.contract_addresses} />
        <KV k="Other"        v={parsed.live_proof.other_evidence} />
      </Section>

      <Section title="NEXT BLOCKER">
        <KV k="Blocker"       v={parsed.next_blocker.current_blocker} />
        <KV k="First AI task" v={parsed.next_blocker.first_ai_task} />
      </Section>

      <Section title="INTEGRITY SELF-CHECK">
        <KV k="Prompt version"  v={parsed.integrity_self_check.prompt_version || '(missing)'} />
        <KV k="Confidence"      v={parsed.integrity_self_check.confidence_score >= 0 ? `${parsed.integrity_self_check.confidence_score}/10` : '(missing)'} />
        <KV k="Verified"        v={parsed.integrity_self_check.verified_claims} />
        <KV k="Unverifiable"    v={parsed.integrity_self_check.unverifiable_claims} />
        <KV k="Divergences"     v={parsed.integrity_self_check.divergences} />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>{title}</div>
      <div className="pl-3" style={{ borderLeft: '1px solid rgba(240,192,64,0.15)' }}>
        {children}
      </div>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  const missing = !v || v === '?'
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-0.5 text-xs">
      <span className="font-mono uppercase" style={{ color: 'rgba(248,245,238,0.35)' }}>{k}</span>
      <span style={{ color: missing ? 'rgba(248,120,113,0.6)' : 'var(--cream)', lineHeight: 1.55 }}>{v || '(empty)'}</span>
    </div>
  )
}

function EmptyHint() {
  return <div className="text-xs" style={{ color: 'rgba(248,120,113,0.7)' }}>No entries parsed from this section.</div>
}
