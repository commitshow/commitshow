import { SubmitForm } from '../components/SubmitForm'

export function SubmitPage() {
  // /submit is the full audit lane (Repo + Brief → backstage → audition).
  // The two-lane chooser was removed 2026-05-11 — users arriving here
  // already chose 'audit my project' on Hero, so showing them a 'Just
  // paste a URL' alternative is redundant friction. The homepage URL
  // fast lane (HeroUrlHook) is its own discoverable surface for
  // closed-source / 'just trying' visitors.
  return (
    <section className="relative z-10 py-20 px-4 md:px-6" style={{ background: 'rgba(10,22,40,0.6)', minHeight: '100vh' }}>
      <div className="max-w-2xl mx-auto pt-8">
        <div className="text-center mb-12">
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>
            // AUDIT YOUR PROJECT
          </div>
          <h2 className="font-display font-black text-3xl sm:text-4xl md:text-5xl mb-3">
            Free analyze first, audition when you're ready
          </h2>
          <p className="font-light" style={{ color: 'rgba(248,245,238,0.4)' }}>
            Engine-extracted brief · multi-axis audit in ~90s · sits backstage until you put it on the league
          </p>
        </div>

        <SubmitForm />
      </div>
    </section>
  )
}
