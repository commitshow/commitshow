// /me/products · focused portfolio page for the creator's audited
// products. Was previously a section embedded in /me ProfilePage; the
// profile dropdown's 'My products' entry pointed at /me, which made
// it indistinguishable from 'My profile'. Splitting the surfaces lets
// each menu item lead somewhere distinct.
//
// /me           = account header · standing · stack · library
// /me/products  = THIS · audited product grid + audition CTA

import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase, type Project, PUBLIC_PROJECT_COLUMNS } from '../lib/supabase'
import { ApplicationRow } from './ProfilePage'

export function MyProductsPage() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [applications, setApplications] = useState<Project[]>([])
  const [loading, setLoading]           = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!user) { setLoading(false); return }
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('projects')
        .select(PUBLIC_PROJECT_COLUMNS)
        .eq('creator_id', user.id)
        .order('created_at', { ascending: false })
      setApplications((data ?? []) as unknown as Project[])
      setLoading(false)
    })().catch(err => { console.error('[MyProductsPage]', err); setLoading(false) })
  }, [authLoading, user])

  if (authLoading) return null
  if (!user) {
    return (
      <section className="pt-24 pb-16 px-6 text-center min-h-[60vh]">
        <h1 className="font-display font-bold text-2xl mb-2" style={{ color: 'var(--cream)' }}>Sign in to see your products</h1>
        <p className="font-mono text-xs mb-6" style={{ color: 'var(--text-muted)' }}>Your portfolio lives behind auth.</p>
        <button
          onClick={() => navigate('/')}
          className="px-5 py-2 font-mono text-xs tracking-wide"
          style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
        >
          BACK TO HOME
        </button>
      </section>
    )
  }

  return (
    <section className="pt-20 pb-16 px-6 md:px-10 lg:px-16 min-h-screen">
      <div className="max-w-5xl mx-auto">
        {/* Breadcrumb back to /me */}
        <Link
          to="/me"
          className="inline-block mb-3 font-mono text-xs tracking-wide"
          style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
        >
          ← MY PROFILE
        </Link>

        {/* Header + audition CTA */}
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3 mb-6">
          <div>
            <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>// MY PRODUCTS</div>
            <h1 className="font-display font-bold text-2xl md:text-3xl mt-1" style={{ color: 'var(--cream)' }}>
              Every product you've auditioned
            </h1>
            <p className="font-mono text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              {loading
                ? 'Loading…'
                : `${applications.length} product${applications.length === 1 ? '' : 's'} · click any card to open its dashboard`}
            </p>
          </div>
          <NavLink
            to="/submit"
            className="font-mono text-xs font-medium tracking-wide px-3 py-2 text-center whitespace-nowrap"
            style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', textDecoration: 'none' }}
          >
            AUDITION A NEW PROJECT →
          </NavLink>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="card-navy p-8 font-mono text-xs text-center" style={{ color: 'var(--text-muted)', borderRadius: '2px' }}>
            Loading your products…
          </div>
        ) : applications.length === 0 ? (
          <div className="card-navy p-12 text-center" style={{ borderRadius: '2px' }}>
            <div className="font-display text-2xl font-bold mb-2" style={{ color: 'var(--cream)' }}>No auditions yet</div>
            <p className="font-mono text-xs mb-6" style={{ color: 'var(--text-muted)' }}>
              Audition your first product to open its dashboard, get an Audit, and start climbing.
            </p>
            <NavLink
              to="/submit"
              className="inline-block font-mono text-xs tracking-wide px-5 py-2.5"
              style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', textDecoration: 'none' }}
            >
              AUDITION YOUR FIRST PRODUCT →
            </NavLink>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {applications.map(p => (
              <ApplicationRow
                key={p.id}
                project={p}
                onDeleted={() => setApplications(prev => prev.filter(x => x.id !== p.id))}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
