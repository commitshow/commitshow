import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { AuthModal } from './AuthModal'
import { AnalysisResultCard } from './AnalysisResultCard'
import { BriefExtraction } from './BriefExtraction'
import { ProjectImagesPicker } from './ProjectImagesPicker'
import type { ProjectImage } from '../lib/supabase'
import { probeGithubPublic } from '../lib/githubProbe'
import { AnalysisProgressModal, EDGE_TOTAL_MS } from './AnalysisProgressModal'
import { analyzeProject, triggerMDDiscovery, type AnalysisResult } from '../lib/analysis'
import type { ExtractedBrief } from '../lib/extractionPrompt'
import { integrityScore } from '../lib/extractionPrompt'
import {
  checkRegistrationEligibility,
  FREE_REGISTRATIONS_PER_MEMBER,
  type RegistrationEligibility,
} from '../lib/pricing'
import { resolvePreviewClaim } from '../lib/projectQueries'

type Step = 1 | 2 | 3 | 4

interface FormData {
  name: string; email: string; github: string; url: string; desc: string
}

interface SubmitFormProps {
  onComplete?: (projectId: string | null) => void
}

// Step 3 loader is rendered by AnalysisProgressModal — outer stepper + sub-
// phases + timer live there. SubmitForm only drives outer-step index (loaderIndex)
// and signals completion (edgeProgress >= 100).

export function SubmitForm({ onComplete }: SubmitFormProps) {
  const { user, member } = useAuth()
  const [authOpen, setAuthOpen] = useState(false)
  const [step, setStep] = useState<Step>(1)
  const [form, setForm] = useState<FormData>({
    name: '', email: user?.email ?? '', github: '', url: '', desc: '',
  })
  const [brief, setBrief] = useState<ExtractedBrief | null>(null)
  const [briefRaw, setBriefRaw] = useState('')
  const [images, setImages] = useState<ProjectImage[]>([])
  const [lastProjectId, setLastProjectId] = useState<string | null>(null)
  const [loaderIndex, setLoaderIndex] = useState(-1)
  const [edgeStartedAt, setEdgeStartedAt] = useState<number | null>(null)
  const [edgeProgress, setEdgeProgress] = useState(0)  // 0–100
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')
  const [eligibility, setEligibility] = useState<RegistrationEligibility | null>(null)

  useEffect(() => {
    if (!user?.id) { setEligibility(null); return }
    checkRegistrationEligibility(user.id).then(setEligibility)
  }, [user?.id])

  // Scroll to top whenever the step changes. Deferred to the next paint so
  // the new step's DOM has committed first; instant behavior because smooth
  // scrolling on tall pages can be unreliable across mobile browsers.
  useEffect(() => {
    const id = window.setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'auto' })
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    }, 0)
    return () => window.clearTimeout(id)
  }, [step])

  // Drive the Edge Function progress bar from elapsed time while the server runs.
  // Caps at 95 % until the fetch resolves, then handleSubmit snaps it to 100.
  useEffect(() => {
    if (edgeStartedAt === null) return
    const tick = () => {
      const elapsed = Date.now() - edgeStartedAt
      const pct = Math.min(95, (elapsed / EDGE_TOTAL_MS) * 100)
      setEdgeProgress(p => (p >= 100 ? 100 : pct))
    }
    tick()
    const id = window.setInterval(tick, 400)
    return () => window.clearInterval(id)
  }, [edgeStartedAt])

  const set = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const [gateBusy, setGateBusy] = useState(false)

  // Async Step-1 gate: field sanity + hard GitHub reachability check.
  // Private / 404 repos are rejected outright — transparency gate.
  const validateStep1 = async (): Promise<boolean> => {
    if (!form.name || !form.email || !form.github || !form.url || !form.desc) {
      setError('Please fill in all fields.'); return false
    }
    if (!form.github.includes('github.com')) {
      setError('Please enter a valid GitHub URL.'); return false
    }
    if (images.length === 0) {
      setError('At least one project image is required before you can continue.'); return false
    }
    // Hard GitHub gate — no submission if the repo is private or unreachable
    setGateBusy(true)
    try {
      const probe = await probeGithubPublic(form.github)
      if (!probe.ok) {
        setError(probe.message)
        return false
      }
    } finally {
      setGateBusy(false)
    }
    setError(''); return true
  }

  async function handleSubmit(finalBrief: ExtractedBrief) {
    // Re-check gate at submit time (someone may have opened two tabs).
    if (user?.id) {
      const recheck = await checkRegistrationEligibility(user.id)
      if (!recheck.ok) {
        setEligibility(recheck)
        return
      }
    }

    setStep(3)

    // Step 1 — Resolve claim: this URL might already exist as a CLI preview.
    // If so, we UPDATE that row (preserving snapshot history) instead of
    // INSERTing a duplicate.
    setLoaderIndex(0)
    const verdict = await resolvePreviewClaim(form.github, user?.id ?? null)

    if (verdict.kind === 'lookup_failed') {
      setError(verdict.message); setStep(2); return
    }
    if (verdict.kind === 'taken_by_other') {
      setError('This GitHub repo is already auditioning under another creator. If this is your repo, contact support.')
      setStep(2); return
    }
    if (verdict.kind === 'already_yours') {
      setError(`You're already auditioning this repo. View it at /projects/${verdict.projectId}.`)
      setStep(2); return
    }

    const projectFields = {
      project_name: form.name,
      creator_id:   user?.id ?? null,
      creator_name: member?.display_name ?? null,
      creator_email: form.email,
      github_url:   form.github,
      live_url:     form.url,
      description:  form.desc,
      images,
      status:       'active' as const,
      season:       'season_zero' as const,
    }

    let insertedId: string
    if (verdict.kind === 'claim') {
      // CLAIM — upgrade the CLI preview row. Snapshot history stays intact.
      const { data: updated, error: updErr } = await supabase
        .from('projects').update(projectFields).eq('id', verdict.projectId)
        .select('id').single()
      if (updErr || !updated?.id) {
        setError(`Failed to claim preview project: ${updErr?.message ?? 'unknown'}`)
        setStep(2); return
      }
      insertedId = updated.id
    } else {
      // FRESH — no prior row for this URL.
      const { data: inserted, error: projectErr } = await supabase
        .from('projects').insert([projectFields]).select('id').single()
      if (projectErr || !inserted?.id) {
        setError(`Failed to save project: ${projectErr?.message ?? 'unknown'}`)
        setStep(2); return
      }
      insertedId = inserted.id
    }
    const inserted = { id: insertedId }

    // Step 2 — Persist full brief (Phase 1 + Phase 2). Use upsert so a
    // claim flow doesn't collide with whatever brief the CLI/preview path
    // wrote earlier (and a fresh insert still works).
    setLoaderIndex(1)
    await supabase.from('build_briefs').upsert([{
      project_id: inserted.id,
      problem:     finalBrief.core_intent.problem,
      features:    finalBrief.core_intent.features,
      target_user: finalBrief.core_intent.target_user,
      stack_fingerprint:    finalBrief.stack_fingerprint,
      failure_log:          finalBrief.failure_log,
      decision_archaeology: finalBrief.decision_archaeology,
      ai_delegation_map:    finalBrief.ai_delegation_map,
      live_proof:           finalBrief.live_proof,
      next_blocker:         `${finalBrief.next_blocker.current_blocker}\n\nFirst AI task: ${finalBrief.next_blocker.first_ai_task}`,
      integrity_score:      integrityScore(finalBrief),
    }], { onConflict: 'project_id' })

    // Step 3 — Edge Function deep analysis (initial snapshot)
    setLoaderIndex(2)
    setLastProjectId(inserted.id)
    setEdgeStartedAt(Date.now())
    setEdgeProgress(0)
    let final: AnalysisResult
    try {
      final = await analyzeProject(inserted.id, 'initial')
    } catch (e) {
      setEdgeStartedAt(null)
      setError(`Analysis failed: ${(e as Error).message}`)
      setStep(2); return
    }

    // Step 4 — settle
    setEdgeProgress(100)
    setLoaderIndex(3)
    await new Promise(r => setTimeout(r, 400))

    setResult(final)
    setStep(4)
    // Scroll handled by the step-watch useEffect at the top of this component.

    // Fire MD Discovery off to its own Edge Function. Runs 30-60s async;
    // DiscoveryPanel picks up inserted rows via its own fetch/realtime.
    triggerMDDiscovery(inserted.id)

    onComplete?.(inserted.id)
  }

  // ── AUTH GATE ──
  if (!user) {
    return (
      <>
        <div className="max-w-xl mx-auto text-center card-navy p-10" style={{ borderRadius: '2px' }}>
          <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// AUTH REQUIRED</div>
          <h3 className="font-display font-bold text-2xl mb-3" style={{ color: 'var(--cream)' }}>Sign in to apply</h3>
          <p className="font-light mb-6" style={{ color: 'rgba(248,245,238,0.5)' }}>
            Every project is linked to a member account — that's how we track Build Briefs, scores, and Scout activity.
          </p>
          <button
            onClick={() => setAuthOpen(true)}
            className="px-6 py-2.5 font-mono text-sm font-medium tracking-wide transition-all"
            style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--gold-400)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--gold-500)')}
          >
            SIGN IN / CREATE ACCOUNT
          </button>
        </div>
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} initialMode="signup" />
      </>
    )
  }

  // ── PAYMENT GATE (permanent policy: first 3 free per member, 4th+ = $99) ──
  if (eligibility && !eligibility.ok) {
    const priceDollars = (eligibility.priceCents / 100).toFixed(0)
    return (
      <div className="max-w-xl mx-auto text-center card-navy p-10" style={{ borderRadius: '2px' }}>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
          // PAYMENT REQUIRED — ${priceDollars}
        </div>
        <h3 className="font-display font-bold text-2xl mb-3" style={{ color: 'var(--cream)' }}>
          Free quota used.
        </h3>
        <p className="font-light mb-2" style={{ color: 'rgba(248,245,238,0.6)' }}>
          You've already auditioned {eligibility.priorCount} products. The first {FREE_REGISTRATIONS_PER_MEMBER} per
          member are free — your next audition needs the $${priceDollars} discovery · exposure · fandom fee
          (conditional refund on graduation).
        </p>
        <div className="mt-6 mb-4 px-4 py-3 font-mono text-xs tracking-wide" style={{
          background: 'rgba(240,192,64,0.06)', border: '1px solid rgba(240,192,64,0.2)',
          color: 'var(--gold-500)', borderRadius: '2px',
        }}>
          STRIPE CHECKOUT · COMING SOON
        </div>
        <p className="font-mono text-xs" style={{ color: 'rgba(248,245,238,0.4)' }}>
          Payment integration is the final piece of V0.5. Until Stripe is live, additional auditions
          are paused for accounts past the free quota.
        </p>
      </div>
    )
  }

  // ── STEP LABELS ──
  const steps = ['Project', 'Build Brief', 'Analyze', 'Result']

  return (
    <div className="max-w-2xl mx-auto px-4">

      {/* Progress — clickable for previously-visited steps */}
      <div className="flex mb-8">
        {steps.map((label, i) => {
          const n = (i + 1) as Step
          const active = step === n
          const done = step > n
          // Only allow jumping back to an earlier step, and never back into an in-flight analysis (step 3)
          const canJump = n < step && n !== 3 && step !== 3
          return (
            <div key={label} className="flex-1 text-center relative">
              <button
                type="button"
                disabled={!canJump}
                onClick={() => { if (canJump) { setError(''); setStep(n) } }}
                className="w-full font-mono text-xs tracking-widest py-2.5"
                style={{
                  color: active ? 'var(--gold-500)' : done ? 'var(--accent3)' : 'rgba(248,245,238,0.25)',
                  borderBottom: `2px solid ${active ? 'var(--gold-500)' : done ? '#00D4AA' : 'rgba(255,255,255,0.06)'}`,
                  background: 'transparent',
                  transition: 'all 0.3s',
                  cursor: canJump ? 'pointer' : 'default',
                }}
                title={canJump ? `Go back to: ${label}` : undefined}
              >
                {done ? '✓' : `0${n}`} {label}
              </button>
            </div>
          )
        })}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 text-sm font-mono" style={{ background: 'rgba(200,16,46,0.1)', border: '1px solid rgba(200,16,46,0.3)', color: '#F87171', borderRadius: '2px' }}>
          {error}
        </div>
      )}

      {eligibility?.ok && step < 3 && (
        <div className="mb-5 px-4 py-2.5 font-mono text-xs tracking-wide" style={{
          background: 'rgba(0,212,170,0.06)',
          border: '1px solid rgba(0,212,170,0.22)',
          color: '#00D4AA',
          borderRadius: '2px',
        }}>
          FREE AUDITION · {eligibility.remainingFree} of {FREE_REGISTRATIONS_PER_MEMBER} remaining
        </div>
      )}

      {/* ── STEP 1: PROJECT BASICS ── */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>// STEP 1 · THE BASICS</div>
            <h3 className="font-display font-bold text-2xl mb-2" style={{ color: 'var(--cream)' }}>
              Tell us about your project.
            </h3>
            <p className="text-sm font-light" style={{ color: 'rgba(248,245,238,0.55)', lineHeight: 1.7 }}>
              5 fields. Step 2 auto-generates your Build Brief from your AI tool — no typing required.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block font-mono text-xs tracking-widest mb-1.5" style={{ color: 'var(--gold-500)' }}>PROJECT NAME *</span>
              <input className="w-full px-3 py-2.5" value={form.name} onChange={set('name')} placeholder="My Vibe App" />
            </label>
            <label className="block">
              <span className="block font-mono text-xs tracking-widest mb-1.5" style={{ color: 'var(--gold-500)' }}>YOUR EMAIL *</span>
              <input className="w-full px-3 py-2.5" type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block font-mono text-xs tracking-widest mb-1.5" style={{ color: 'var(--gold-500)' }}>GITHUB URL *</span>
              <input className="w-full px-3 py-2.5" value={form.github} onChange={set('github')} placeholder="https://github.com/user/repo" />
            </label>
            <label className="block">
              <span className="block font-mono text-xs tracking-widest mb-1.5" style={{ color: 'var(--gold-500)' }}>LIVE URL *</span>
              <input className="w-full px-3 py-2.5" value={form.url} onChange={set('url')} placeholder="https://myapp.com" />
            </label>
          </div>
          <label className="block">
            <span className="block font-mono text-xs tracking-widest mb-1.5" style={{ color: 'var(--gold-500)' }}>ONE-LINE DESCRIPTION *</span>
            <input className="w-full px-3 py-2.5" value={form.desc} onChange={set('desc')} placeholder="What does your app do?" />
          </label>

          <div>
            <span className="block font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
              PROJECT IMAGES * · UP TO 3
            </span>
            <ProjectImagesPicker
              value={images}
              onChange={setImages}
              max={3}
              required
            />
          </div>

          <button
            onClick={async () => { if (await validateStep1()) setStep(2) }}
            disabled={gateBusy}
            className="w-full py-3.5 font-mono text-sm tracking-wide transition-all mt-2"
            style={{
              background: gateBusy ? 'rgba(240,192,64,0.4)' : 'var(--gold-500)',
              color: 'var(--navy-900)',
              border: 'none',
              borderRadius: '2px',
              cursor: gateBusy ? 'wait' : 'pointer',
            }}
          >
            {gateBusy ? 'Verifying GitHub repo…' : 'Continue to Build Brief →'}
          </button>
        </div>
      )}

      {/* ── STEP 2: BUILD BRIEF VIA EXTRACTION ── */}
      {step === 2 && (
        <BriefExtraction
          githubUrl={form.github}
          onBack={() => setStep(1)}
          onBriefReady={(extracted, raw, _source) => {
            setBrief(extracted)
            setBriefRaw(raw)
            handleSubmit(extracted)
          }}
        />
      )}

      {/* Step 3 is presented as a full-screen modal overlay · see below */}
      <AnalysisProgressModal
        open={step === 3}
        variant="initial"
        outerStep={loaderIndex >= 0 ? loaderIndex : 0}
        completed={edgeProgress >= 100}
      />

      {/* ── STEP 4: RESULT (rich multi-axis analysis) ── */}
      {step === 4 && result && (
        <AnalysisResultCard
          result={result}
          projectId={lastProjectId ?? undefined}
          onReanalyzed={(next) => { setResult(next); onComplete?.(lastProjectId) }}
          onReset={() => {
            setStep(1)
            setResult(null)
            setForm({ name: '', email: user?.email ?? '', github: '', url: '', desc: '' })
            setBrief(null)
            setBriefRaw('')
            setLastProjectId(null)
            setImages([])
          }}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
      `}</style>
    </div>
  )
}
