import { SubmitForm } from '../components/SubmitForm'

export function SubmitPage() {
  // onComplete intentionally does NOT navigate — the user needs to see the
  // final result card rendered by SubmitForm step 4 in place. From there they
  // can choose to re-audit, audition with another product, or visit the full
  // project page. Auto-redirecting away was hiding the result.
  return (
    <section className="relative z-10 py-20 px-4 md:px-6" style={{ background: 'rgba(10,22,40,0.6)', minHeight: '100vh' }}>
      <div className="max-w-2xl mx-auto pt-8">
        <div className="text-center mb-12">
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>
            // AUDIT YOUR BUILD
          </div>
          <h2 className="font-display font-black text-3xl sm:text-4xl md:text-5xl mb-3">
            Get on the ladder
          </h2>
          <p className="font-light" style={{ color: 'rgba(248,245,238,0.4)' }}>
            Four steps · engine-extracted brief · multi-axis audit in ~90s · ranked the moment it finishes
          </p>
        </div>

        <SubmitForm />
      </div>
    </section>
  )
}
