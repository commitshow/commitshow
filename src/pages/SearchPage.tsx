// Cross-surface search · /search?q=<query>
//
// Hits three sources in parallel:
//   - projects       (project_name · description · creator_name)
//   - members        (display_name · x_handle · github_handle)
//   - md_library     (title · description · stack_tags · target_tools)
//
// Plain ilike for now — Postgres FTS would be more correct but adds a
// migration dependency. ilike on columns that already have b-tree
// indexes scales fine to current dataset; revisit when row counts get
// past O(10k).

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, PUBLIC_MEMBER_COLUMNS, type Member } from '../lib/supabase'

interface ProjectHit {
  id:            string
  project_name:  string
  description:   string | null
  creator_name:  string | null
  thumbnail_url: string | null
  status:        string
  score_total:   number | null
  audit_count:   number | null
}

interface LibraryHit {
  id:           string
  title:        string
  description:  string | null
  intent:       string
  target_format: string | null
  is_free:       boolean
}

const DEBOUNCE_MS = 220

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const navigate            = useNavigate()
  const initialQ            = params.get('q') ?? ''
  const [q, setQ]           = useState(initialQ)
  const [debounced, setDebounced] = useState(initialQ)
  const [loading, setLoading]     = useState(false)
  const [projects, setProjects]   = useState<ProjectHit[]>([])
  const [members,  setMembers]    = useState<Member[]>([])
  const [packs,    setPacks]      = useState<LibraryHit[]>([])

  // Debounce + URL sync
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    if (debounced) setParams({ q: debounced }, { replace: true })
    else setParams({}, { replace: true })
  }, [debounced, setParams])

  // Parallel fetch when debounced query changes
  useEffect(() => {
    let alive = true
    const term = debounced.trim()
    if (term.length < 2) {
      setProjects([]); setMembers([]); setPacks([])
      return
    }
    setLoading(true)
    const pat = `%${term}%`
    Promise.all([
      supabase
        .from('projects')
        .select('id, project_name, description, creator_name, thumbnail_url, status, score_total, audit_count')
        .or(`project_name.ilike.${pat},description.ilike.${pat},creator_name.ilike.${pat}`)
        .in('status', ['active', 'graduated', 'valedictorian'])
        .limit(15),
      supabase
        .from('members')
        .select(PUBLIC_MEMBER_COLUMNS)
        .or(`display_name.ilike.${pat},x_handle.ilike.${pat},github_handle.ilike.${pat}`)
        .limit(15),
      supabase
        .from('md_library')
        .select('id, title, description, intent, target_format, is_free')
        .eq('status', 'published')
        .or(`title.ilike.${pat},description.ilike.${pat}`)
        .limit(15),
    ]).then(([pj, mb, lib]) => {
      if (!alive) return
      setProjects((pj.data as unknown as ProjectHit[]) ?? [])
      setMembers((mb.data as unknown as Member[])      ?? [])
      setPacks((lib.data as unknown as LibraryHit[])   ?? [])
      setLoading(false)
    }).catch(() => {
      if (!alive) return
      setLoading(false)
    })
    return () => { alive = false }
  }, [debounced])

  const totalHits = projects.length + members.length + packs.length
  const showAny   = debounced.trim().length >= 2

  const sectionStyle = useMemo(() => ({
    padding: '14px 18px',
    background: 'rgba(15,32,64,0.4)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '2px',
  }), [])

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="mb-5">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // SEARCH
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl mb-1" style={{ color: 'var(--cream)' }}>
            Find a project, creator, or artifact
          </h1>
          <p className="font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
            Type at least 2 characters. Searches project names · descriptions · display names · X / GitHub handles · library titles.
          </p>
        </header>

        {/* Input */}
        <div className="relative mb-6">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm" style={{ color: 'var(--text-muted)' }}>⌕</span>
          <input
            type="search"
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setQ(''); navigate('/') }
            }}
            placeholder="Search…"
            className="w-full pl-9 pr-3 py-3 font-mono"
            style={{ lineHeight: 1.4 }}
          />
        </div>

        {/* Result strip · counter */}
        {showAny && (
          <div className="font-mono text-[11px] mb-4" style={{ color: 'var(--text-muted)' }}>
            {loading ? 'searching…' : (
              totalHits === 0
                ? 'no matches'
                : `${totalHits} match${totalHits === 1 ? '' : 'es'} · ${projects.length} project${projects.length === 1 ? '' : 's'} · ${members.length} creator${members.length === 1 ? '' : 's'} · ${packs.length} artifact${packs.length === 1 ? '' : 's'}`
            )}
          </div>
        )}

        {/* Projects section */}
        {showAny && projects.length > 0 && (
          <div className="mb-5">
            <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: 'var(--gold-500)' }}>Projects</div>
            <div className="grid gap-2">
              {projects.map(p => (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className="flex items-center gap-3"
                  style={{ ...sectionStyle, textDecoration: 'none' }}
                >
                  <div className="flex-shrink-0 overflow-hidden" style={{
                    width: 56, height: 36, background: 'var(--navy-800)',
                    border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px',
                  }}>
                    {p.thumbnail_url
                      ? <img src={p.thumbnail_url} alt="" loading="lazy" className="w-full h-full" style={{ objectFit: 'cover' }} />
                      : <div className="w-full h-full flex items-center justify-center font-mono text-[11px]" style={{ color: 'var(--text-faint)' }}>{p.project_name.slice(0, 1).toUpperCase()}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold truncate" style={{ color: 'var(--cream)' }}>{p.project_name}</div>
                    <div className="font-mono text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {p.creator_name && <>by {p.creator_name} · </>}
                      {p.description ?? 'no description'}
                    </div>
                  </div>
                  {p.score_total != null && (
                    <div className="font-display font-bold tabular-nums text-lg flex-shrink-0" style={{ color: 'var(--gold-500)' }}
                         title={(p.audit_count ?? 0) <= 1 ? 'Score hidden until creator re-audits.' : undefined}>
                      {(p.audit_count ?? 0) <= 1 ? '—' : p.score_total}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Creators section */}
        {showAny && members.length > 0 && (
          <div className="mb-5">
            <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: '#60A5FA' }}>Creators</div>
            <div className="grid gap-2">
              {members.map(m => (
                <Link
                  key={m.id}
                  to={`/creators/${m.id}`}
                  className="flex items-center gap-3"
                  style={{ ...sectionStyle, textDecoration: 'none' }}
                >
                  <div className="flex-shrink-0 overflow-hidden flex items-center justify-center" style={{
                    width: 36, height: 36,
                    background: m.avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
                    color: 'var(--navy-900)',
                    border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px',
                    fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 700,
                  }}>
                    {m.avatar_url
                      ? <img src={m.avatar_url} alt="" loading="lazy" className="w-full h-full" style={{ objectFit: 'cover' }} />
                      : (m.display_name ?? '·').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold truncate" style={{ color: 'var(--cream)' }}>{m.display_name ?? 'untitled member'}</div>
                    <div className="font-mono text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {m.x_handle && <>@{m.x_handle}</>}
                      {m.x_handle && m.github_handle && ' · '}
                      {m.github_handle && <>github.com/{m.github_handle}</>}
                      {!m.x_handle && !m.github_handle && '—'}
                    </div>
                  </div>
                  <div className="font-mono text-[10px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {m.tier}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Library section */}
        {showAny && packs.length > 0 && (
          <div className="mb-5">
            <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: '#A78BFA' }}>Library artifacts</div>
            <div className="grid gap-2">
              {packs.map(l => (
                <Link
                  key={l.id}
                  to={`/library/${l.id}`}
                  className="flex items-center gap-3"
                  style={{ ...sectionStyle, textDecoration: 'none' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold truncate" style={{ color: 'var(--cream)' }}>{l.title}</div>
                    <div className="font-mono text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {l.intent && <>{l.intent.replace('_', ' ')} · </>}
                      {l.target_format && <>{l.target_format.replace('_', ' ')} · </>}
                      {l.description?.slice(0, 80) ?? '—'}
                    </div>
                  </div>
                  <div className="font-mono text-[11px] flex-shrink-0" style={{
                    color: l.is_free ? '#00D4AA' : 'var(--gold-500)',
                  }}>
                    {l.is_free ? 'FREE' : 'PAID'}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {showAny && !loading && totalHits === 0 && (
          <div className="card-navy p-10 text-center" style={{ borderRadius: '2px' }}>
            <div className="font-display font-bold text-xl mb-2" style={{ color: 'var(--text-muted)' }}>
              Nothing matches "{debounced}"
            </div>
            <p className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>
              Try a project name, a creator's @ handle, or a tool name like "cursor".
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
