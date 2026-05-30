// AuditShowcase · proof section on the main landing page.
//
// 2026-05-30 rewrite: switched the bespoke score-led AuditCard for the
// same ProjectCardEditorial used by /products. CEO note — the old card
// (score in big numerals + lane badge + 1 strength/1 concern) leaked
// the polish digit on a surface where we'd rather lead with the score
// BAND, not the number. ProjectCardEditorial already implements that
// rule (viewerCanSeeDigitOnList gates the digit; anon visitors see a
// band tone only) and carries the thumbnail + project copy that the
// stripped-down landing surface was missing.
//
// Data: top 6 active projects ordered by last_analysis_at desc — the
// "most recently audited" rhythm matches the section's "Real members.
// Real audits." pitch better than the old top-score-only pool.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, PUBLIC_PROJECT_COLUMNS, type Project } from '../lib/supabase'
import { fetchCreatorsByIds, fetchApplaudCounts, type CreatorIdentity } from '../lib/projectQueries'
import { ProjectCardEditorial } from './ProjectCardEditorial'

const SHOWCASE_LIMIT = 6

export function AuditShowcase() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [creators, setCreators] = useState<Record<string, CreatorIdentity>>({})
  const [applauds, setApplauds] = useState<Record<string, number>>({})

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data } = await supabase
        .from('projects')
        .select(PUBLIC_PROJECT_COLUMNS)
        .eq('status', 'active')
        .not('thumbnail_url', 'is', null)
        .order('last_analysis_at', { ascending: false, nullsFirst: false })
        .limit(SHOWCASE_LIMIT)
      if (!live) return
      const rows = (data ?? []) as unknown as Project[]
      setProjects(rows)

      // Hydrate creator chips + applaud counts so the editorial card
      // renders complete on first paint instead of a half-empty footer.
      const creatorIds = rows.map(p => p.creator_id).filter((x): x is string => !!x)
      const projectIds = rows.map(p => p.id)
      const [creatorMap, applaudMap] = await Promise.all([
        fetchCreatorsByIds(creatorIds),
        fetchApplaudCounts(projectIds),
      ])
      if (!live) return
      setCreators(creatorMap)
      setApplauds(applaudMap)
    })().catch(() => { /* silent · empty pool falls through to no-render */ })
    return () => { live = false }
  }, [])

  if (!projects || projects.length === 0) return null

  return (
    <section
      className="relative z-10 py-20 px-6 md:px-10 lg:px-24 xl:px-32 2xl:px-40"
      style={{ borderTop: '1px solid rgba(240,192,64,0.08)' }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
          // RECENT AUDITS · ON COMMIT.SHOW
        </div>
        <h2 className="font-display font-black text-3xl sm:text-4xl md:text-5xl mb-4 leading-tight" style={{ color: 'var(--cream)' }}>
          Real members. Real audits.
        </h2>
        <p className="font-light max-w-2xl mb-12" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
          Every card below is a member who shipped on commit.show — product +
          Build Brief audited end-to-end. Click through to the report.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
          {projects.map(p => (
            <ProjectCardEditorial
              key={p.id}
              project={p}
              creator={p.creator_id ? creators[p.creator_id] : undefined}
              applaudCount={applauds[p.id] ?? 0}
            />
          ))}
        </div>

        {/* Footer CTA · bottom-right, mirrors the FeaturedLanes lane footer
            treatment (mono uppercase, gold). Hands the visitor off to the
            full ladder for the rest of the ranked projects. */}
        <div className="mt-8 flex justify-end">
          <Link
            to="/products"
            className="font-mono text-xs tracking-widest transition-colors"
            style={{ color: 'var(--gold-500)', textDecoration: 'none', opacity: 0.8 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.8')}
          >
            ALL PRODUCTS →
          </Link>
        </div>
      </div>
    </section>
  )
}
