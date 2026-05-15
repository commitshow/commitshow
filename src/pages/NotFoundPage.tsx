// Real 404 surrogate · replaces the previous catch-all that rendered
// LandingPage for unknown URLs. Google was flagging those routes as
// "Soft 404" — page returns 200 but content reads as missing — and
// dropping them from the index. Now we serve unique 404 copy + a
// noindex meta so the crawler recognizes this as a non-canonical
// page and stops trying to surface it in search.
//
// The page is also linked from ProjectDetailPage / scouts / etc.
// when their resource lookup returns null, so the same component
// covers both unknown routes and missing entities.

import { useEffect } from 'react'
import { Link } from 'react-router-dom'

interface Props {
  /** Override the headline · e.g. "Project not found" for a missing
   *  resource within an otherwise valid route. Defaults to a plain
   *  "Page not found." */
  title?:    string
  /** Override the body copy. */
  message?:  string
  /** Where the primary CTA goes. Defaults to /. */
  homeHref?: string
}

export function NotFoundPage({
  title    = 'Page not found',
  message  = "We couldn't find what you were looking for. The link may be old, or the product may have been removed.",
  homeHref = '/',
}: Props) {
  // Inject noindex while this page is mounted · cleaned up on unmount
  // so a soft-routing transition doesn't leak the directive into the
  // next page's HTML. Google honors meta robots updates from JS for
  // pages it re-renders.
  useEffect(() => {
    const tag = document.createElement('meta')
    tag.name = 'robots'
    tag.content = 'noindex,follow'
    document.head.appendChild(tag)
    const prevTitle = document.title
    document.title = `${title} · commit.show`
    return () => {
      document.head.removeChild(tag)
      document.title = prevTitle
    }
  }, [title])

  return (
    <section
      className="relative z-10 px-6 md:px-10 lg:px-24 py-32 min-h-screen flex items-center justify-center"
      style={{ background: 'var(--navy-950)' }}
    >
      <div className="max-w-xl w-full text-center">
        <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>
          // 404
        </div>
        <h1
          className="font-display font-black text-5xl md:text-7xl mb-6 leading-none"
          style={{ color: 'var(--cream)' }}
        >
          {title}
        </h1>
        <p className="font-light mb-10" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          {message}
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link
            to={homeHref}
            className="font-mono text-xs tracking-wide px-5 py-2.5"
            style={{
              background:   'var(--gold-500)',
              color:        'var(--navy-900)',
              border:       'none',
              borderRadius: '2px',
              textDecoration: 'none',
              fontWeight:   600,
            }}
          >
            Back to commit.show →
          </Link>
          <Link
            to="/products"
            className="font-mono text-xs tracking-wide px-5 py-2.5"
            style={{
              background:     'transparent',
              color:          'var(--gold-500)',
              border:         '1px solid rgba(240,192,64,0.4)',
              borderRadius:   '2px',
              textDecoration: 'none',
            }}
          >
            Browse the ladder
          </Link>
        </div>
      </div>
    </section>
  )
}
