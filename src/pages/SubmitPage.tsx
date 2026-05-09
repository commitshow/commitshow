import { useNavigate } from 'react-router-dom'
import { SubmitForm } from '../components/SubmitForm'

export function SubmitPage() {
  // §15-E two-lane entry · the page is the FULL lane (Repo + Brief →
  // ladder · graduation track · auto-tweet eligible). The Fast lane
  // banner above the form points users without a public repo to the
  // homepage URL hook (HeroUrlHook). We do NOT inline the URL flow
  // here — duplicate UX risk + the homepage hook already handles
  // anonymous walk-ons cleanly.
  //
  // onComplete intentionally does NOT navigate — the user needs to see the
  // final result card rendered by SubmitForm step 4 in place. From there they
  // can choose to re-audit, audition with another product, or visit the full
  // project page. Auto-redirecting away was hiding the result.
  const navigate = useNavigate()

  return (
    <section className="relative z-10 py-20 px-4 md:px-6" style={{ background: 'rgba(10,22,40,0.6)', minHeight: '100vh' }}>
      <div className="max-w-2xl mx-auto pt-8">
        <div className="text-center mb-12">
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>
            // AUDITION YOUR PROJECT
          </div>
          <h2 className="font-display font-black text-3xl sm:text-4xl md:text-5xl mb-3">
            Get on the ladder
          </h2>
          <p className="font-light" style={{ color: 'rgba(248,245,238,0.4)' }}>
            Four steps · engine-extracted brief · multi-axis audit in ~90s · ranked the moment it finishes
          </p>
        </div>

        {/* ── Two-lane chooser · §15-E ──
            Active card = "Full audit" (this page). Fast lane is a soft
            link to the homepage hook so closed-source / "just trying" users
            never feel cornered into a repo gate. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-10">
          <div
            className="p-4 cursor-default"
            style={{
              background: 'rgba(240,192,64,0.08)',
              border: '1px solid rgba(240,192,64,0.4)',
              borderRadius: '2px',
            }}
          >
            <div className="font-mono text-xs tracking-widest mb-1.5" style={{ color: 'var(--gold-500)' }}>
              FULL AUDIT · ACTIVE
            </div>
            <div className="font-display font-bold text-lg mb-1" style={{ color: 'var(--cream)' }}>
              Repo + Brief → ladder
            </div>
            <p className="font-mono text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Full audit · graduation track · auto-share at score ≥ 85
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              // Land on the URL hook section · scroll-mt-20 on the section
              // gives breathing room under the fixed Nav. The hash also lets
              // users back-button into the form's previous state.
              navigate('/#url-hook')
              // Defer the scroll to next tick so navigate finishes mounting
              // the section before we try to align it.
              setTimeout(() => {
                const el = document.getElementById('url-hook')
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }, 50)
            }}
            className="p-4 text-left transition-all"
            style={{
              background: 'transparent',
              border: '1px solid rgba(248,245,238,0.15)',
              borderRadius: '2px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.4)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(248,245,238,0.15)')}
          >
            <div className="font-mono text-xs tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              FAST AUDIT · URL ONLY →
            </div>
            <div className="font-display font-bold text-lg mb-1" style={{ color: 'var(--cream)' }}>
              Just paste a URL
            </div>
            <p className="font-mono text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Partial audit · closed-source friendly · upgrade with your repo later
            </p>
          </button>
        </div>

        <SubmitForm />
      </div>
    </section>
  )
}
