// ErrorBoundary — last-line defence so a single render bug or a failed
// lazy-chunk import doesn't leave the user with a blank page. React doesn't
// surface render-time exceptions through Suspense boundaries, so we wrap
// the routes ourselves.
//
// On error we show a quiet recovery card with: the error message (helps
// debugging), a "reload" button that hard-refreshes (clears stale chunks),
// and a "home" link.

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message:  string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message ?? 'Unknown error' }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // Log so we can grep server-side / extension errors later.
    console.error('[commit.show] route error', err, info)
  }

  reload = () => {
    // Force a fresh HTML fetch so a stale bundle hash gets replaced.
    window.location.reload()
  }

  goHome = () => {
    window.location.href = '/'
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <section className="relative z-10 pt-32 pb-16 px-6 min-h-screen flex flex-col items-center justify-center text-center">
        <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>
          // SOMETHING SLIPPED
        </div>
        <h1 className="font-display font-black text-3xl mb-3" style={{ color: 'var(--cream)' }}>
          This page hit a snag
        </h1>
        <p className="font-light text-sm max-w-md mb-6" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          We probably shipped a fresh bundle while you were here, or your browser
          held onto an older version. A reload almost always fixes it.
        </p>
        <div className="flex gap-3 flex-wrap justify-center mb-6">
          <button
            onClick={this.reload}
            className="px-5 py-2 font-mono text-xs tracking-wide"
            style={{
              background: 'var(--gold-500)', color: 'var(--navy-900)',
              border: 'none', borderRadius: '2px', cursor: 'pointer',
            }}
          >
            RELOAD
          </button>
          <button
            onClick={this.goHome}
            className="px-5 py-2 font-mono text-xs tracking-wide"
            style={{
              background: 'transparent', color: 'var(--cream)',
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: '2px', cursor: 'pointer',
            }}
          >
            HOME
          </button>
        </div>
        <pre
          className="font-mono text-[11px] px-3 py-2 max-w-md overflow-x-auto whitespace-pre-wrap text-left"
          style={{
            background: 'rgba(6,12,26,0.6)',
            color: 'var(--text-muted)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '2px',
            lineHeight: 1.5,
          }}
        >
          {this.state.message}
        </pre>
      </section>
    )
  }
}
