// /project/:slug · resolves a slug to a project_id then redirects to
// the canonical /projects/:id route. Slug-style URLs are nicer in
// tweets / share cards / agent memory; the underlying detail page
// stays at /projects/:id so URLs in inbound emails / old tweets keep
// working.

import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { projectSlug } from '../lib/projectSlug'

export function ProjectSlugRedirect() {
  const { slug } = useParams<{ slug: string }>()
  const [resolvedId, setResolvedId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    if (!slug) { setResolvedId(null); return }
    ;(async () => {
      // Pull a small candidate set (latest 200 active+graduated projects)
      // and slug-match client-side. Slug isn't a column · we don't want
      // to migrate just for this. The candidate set is small enough that
      // the round-trip is < 200ms.
      const { data } = await supabase
        .from('projects')
        .select('id, project_name, status, created_at')
        .in('status', ['active', 'graduated', 'valedictorian', 'preview'])
        .order('created_at', { ascending: false })
        .limit(200)
      if (!alive) return
      const target = (data ?? []) as Array<{ id: string; project_name: string }>
      const match = target.find(p => projectSlug(p.project_name) === slug)
      setResolvedId(match?.id ?? null)
    })()
    return () => { alive = false }
  }, [slug])

  if (resolvedId === undefined) {
    return <div className="pt-32 pb-20 px-6 text-center font-mono text-xs" style={{ color: 'var(--text-muted)' }}>resolving…</div>
  }
  if (resolvedId === null) {
    return <div className="pt-32 pb-20 px-6 text-center font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
      No project matches "{slug}" — try the search page or the full ladder.
    </div>
  }
  return <Navigate to={`/projects/${resolvedId}`} replace />
}
