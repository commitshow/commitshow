import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
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
  priceBreakdown,
  type RegistrationEligibility,
} from '../lib/pricing'
import { resolvePreviewClaim } from '../lib/projectQueries'
import { PaymentResultModal } from './PaymentResultModal'

type Step = 1 | 2 | 3 | 4

interface FormData {
  name: string; email: string; github: string; url: string; desc: string
  category: import('../lib/supabase').LadderCategory | ''
}

interface SubmitFormProps {
  onComplete?: (projectId: string | null) => void
}

// Step 3 loader is rendered by AnalysisProgressModal — outer stepper + sub-
// phases + timer live there. SubmitForm only drives outer-step index (loaderIndex)
// and signals completion (edgeProgress >= 100).

// Normalize various GitHub URL shapes (with/without scheme, with .git suffix,
// owner/repo bare, github.com/owner/repo) to the canonical https://github.com/<o>/<r>
// form so the submit form's GitHub input is prefilled correctly when arriving
// from a CLI deep-link like /submit?repo=github.com/owner/repo.
function canonicalGithubUrl(raw: string): string {
  if (!raw) return ''
  let s = raw.trim().replace(/\.git\/?$/, '').replace(/^https?:\/\//, '').replace(/^www\./, '')
  if (s.startsWith('github.com/')) s = s.slice('github.com/'.length)
  if (s.startsWith('github.com:')) s = s.slice('github.com:'.length)
  // accept owner/repo bare
  const m = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\/.*)?$/)
  if (!m) return ''
  return `https://github.com/${m[1]}/${m[2]}`
}

export function SubmitForm({ onComplete }: SubmitFormProps) {
  const { user, member } = useAuth()
  const [searchParams] = useSearchParams()
  const prefilledGithub = canonicalGithubUrl(searchParams.get('repo') ?? searchParams.get('github_url') ?? '')
  const [authOpen, setAuthOpen] = useState(false)
  const [step, setStep] = useState<Step>(1)
  const [form, setForm] = useState<FormData>({
    name: '', email: user?.email ?? '', github: prefilledGithub, url: '', desc: '',
    category: '',
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

  // Stripe checkout return · ?payment=success / ?payment=canceled. We
  // capture the value once on mount, surface the celebrate-or-acknowledge
  // modal, and strip the query string so a refresh doesn't re-fire.
  const [paymentResult, setPaymentResult] = useState<'success' | 'canceled' | null>(() => {
    const v = searchParams.get('payment')
    return v === 'success' || v === 'canceled' ? v : null
  })

  useEffect(() => {
    if (!paymentResult) return
    // Drop the query params from the URL so a hard refresh doesn't relaunch
    // the modal. Using replaceState (not navigate) keeps history clean.
    const url = new URL(window.location.href)
    url.searchParams.delete('payment')
    url.searchParams.delete('session_id')
    window.history.replaceState({}, '', url.toString())
  }, [paymentResult])

  useEffect(() => {
    if (!user?.id) { setEligibility(null); return }
    checkRegistrationEligibility(user.id).then(setEligibility)
  }, [user?.id, paymentResult])

  // After a successful payment, the webhook is asynchronous — observed end-to-end
  // latency is 20-40s for Stripe to fire and PostgREST to see the credit. Poll
  // every 2s for up to 90s so we don't give up while the webhook is still in flight.
  // `paymentPolling` suppresses the PaymentGate UI during this window — without it,
  // the gate flashes "Pay $99" again right after a successful payment. Wrapped in
  // try/catch because an uncaught fetch error inside the tick used to kill polling
  // silently, leaving the user stuck on the finalizing panel forever.
  const [paymentPolling, setPaymentPolling] = useState(false)
  const [paymentPollAttempt, setPaymentPollAttempt] = useState(0)
  useEffect(() => {
    if (paymentResult !== 'success' || !user?.id) return
    let cancelled = false
    let attempts = 0
    setPaymentPolling(true)
    setPaymentPollAttempt(0)
    const tick = async () => {
      if (cancelled) return
      if (attempts >= 45) { setPaymentPolling(false); return }
      attempts++
      setPaymentPollAttempt(attempts)
      try {
        const res = await checkRegistrationEligibility(user.id)
        if (cancelled) return
        setEligibility(res)
        if ((res.paidCredit ?? 0) > 0) { setPaymentPolling(false); return }
      } catch (err) {
        if (cancelled) return
        console.warn('[submit] eligibility poll failed', err)
        // fall through · keep polling
      }
      setTimeout(tick, 2000)
    }
    tick()
    return () => { cancelled = true; setPaymentPolling(false) }
  }, [paymentResult, user?.id])

  // Manual override · user clicks the "I've already paid" button on the
  // finalizing panel to force a fresh eligibility check. We refresh the JWT
  // first (a stale session was silently 401-ing reads of paid_audits_credit
  // even though RLS allows anon reads — observed in testing 2026-05-03) and
  // then surface a tiny status so the user sees that the click did something.
  const [recheckStatus, setRecheckStatus] = useState<'idle' | 'busy' | 'no-credit' | 'error'>('idle')
  const recheckEligibility = async () => {
    if (!user?.id) return
    setRecheckStatus('busy')
    try {
      // Force refresh the auth token — observed cases where a long-lived tab
      // had an expired JWT and the supabase client silently returned 401 on
      // members reads, masking the credit even when it was set in DB.
      try { await supabase.auth.refreshSession() } catch {}
      const res = await checkRegistrationEligibility(user.id)
      setEligibility(res)
      if (res.ok) {
        setPaymentPolling(false)
        setRecheckStatus('idle')
      } else {
        setRecheckStatus('no-credit')
      }
    } catch (err) {
      console.warn('[submit] manual eligibility recheck failed', err)
      setRecheckStatus('error')
    }
  }

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
    // Clear any leftover banner from a prior failed attempt — otherwise a
    // first-attempt failure (e.g. 42501) leaves the error banner visible
    // even when a retry succeeds and lands on step 4.
    setError('')

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
      setError('This GitHub repo is already audited under another creator. If this is your repo, contact support.')
      setStep(2); return
    }
    if (verdict.kind === 'already_yours') {
      setError(`You've already audited this repo. View it at /projects/${verdict.projectId}.`)
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
      // 7-cat ladder placement (§11-NEW.1.1) · empty = let auto-detector
      // suggest at audit time, user can confirm/override on the project page.
      ...(form.category ? { business_category: form.category } : {}),
    }

    let insertedId: string
    if (verdict.kind === 'claim') {
      // CLAIM — upgrade the CLI preview row. Snapshot history stays intact.
      //
      // Session sanity-check before the UPDATE: useAuth() returns the React
      // copy of `user`, which can desync from supabase-js's active JWT
      // (e.g. token expired in the background, OAuth handoff incomplete).
      // The RLS WITH CHECK clause `auth.uid() = creator_id` is evaluated
      // against the JWT, NOT against the React state, so a desync surfaces
      // as 42501 ("new row violates row-level security policy") with no
      // user-visible auth error. Force a fresh session read here so we
      // can either reuse the JWT user id (guaranteed to match auth.uid())
      // or surface a clear "sign in again" message.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) {
        setError('Your sign-in session expired. Refresh and sign in again.')
        setStep(2); return
      }
      // Use the JWT-bound id so server-side auth.uid() always matches.
      const claimFields = { ...projectFields, creator_id: session.user.id }
      const { error: updErr } = await supabase
        .from('projects').update(claimFields).eq('id', verdict.projectId)
      if (updErr) {
        // Surface raw error to console so dev tools shows code + message.
        console.error('[claim preview] update failed', {
          code: (updErr as { code?: string }).code,
          message: updErr.message,
          projectId: verdict.projectId,
          jwtUserId: session.user.id,
          reactUserId: user?.id,
        })
        setError(`Failed to claim preview project: ${updErr.message} (code ${(updErr as { code?: string }).code ?? '?'})`)
        setStep(2); return
      }
      insertedId = verdict.projectId
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

    // Redeem the paid audit credit if the eligibility we checked at modal-
    // open time landed on the paid_credit branch. Free-quota auditions skip
    // this entirely (the RPC is a no-op anyway when paid_audits_credit is 0,
    // but skipping saves a round-trip). Failure here is non-fatal — the
    // audit itself still runs; credit just doesn't decrement and the next
    // checkout will be blocked by the same gate, which is a recoverable
    // state, not a lost audit.
    if (user?.id && eligibility?.ok && eligibility.reason === 'paid_credit') {
      const { error: redeemErr } = await supabase.rpc('redeem_audit_credit', {
        p_member_id:  user.id,
        p_project_id: insertedId,
      })
      if (redeemErr) {
        console.warn('[submit] redeem_audit_credit failed', redeemErr.message)
      }
    }

    // Step 2 — Persist full brief (Phase 1 + Phase 2). Use upsert so a
    // claim flow doesn't collide with whatever brief the CLI/preview path
    // wrote earlier (and a fresh insert still works).
    setLoaderIndex(1)
    const { error: briefErr } = await supabase.from('build_briefs').upsert([{
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
    if (briefErr) {
      // Persist failure was a silent black hole before · audit reads brief_id
      // off this row, so missing it tanks Brief Integrity scoring.
      setError(`Failed to save brief: ${briefErr.message}`)
      setStep(2); return
    }

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

    // Drop ladder cache so the user's new audit shows up next time they
    // hit /ladder — instead of waiting for the 30s TTL to expire.
    void import('../lib/ladder').then(m => m.invalidateLadderCache())

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
  // While we're still polling for the post-checkout webhook, render a confirming
  // panel instead of PaymentGate — otherwise the user paid and immediately sees
  // "Pay $99" again because the credit hasn't landed yet (webhook is async,
  // typically 20-40s end-to-end). We also enter this state when paymentResult
  // is 'success' before the first eligibility fetch resolves, so the form never
  // flashes between mount and the first poll tick.
  const inPostCheckoutWait =
    paymentPolling || (paymentResult === 'success' && eligibility === null)
  if (inPostCheckoutWait || (eligibility && !eligibility.ok && paymentResult === 'success')) {
    return (
      <div className="max-w-xl mx-auto text-center card-navy p-10" style={{ borderRadius: '2px' }}>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
          // CONFIRMING PAYMENT
        </div>
        <h3 className="font-display font-bold text-2xl mb-3" style={{ color: 'var(--cream)' }}>
          Payment received · finalizing
        </h3>
        <p className="font-light mb-6" style={{ color: 'rgba(248,245,238,0.55)' }}>
          Stripe is sending the receipt to our server (usually 20-40 seconds).
          This page will switch to the audition form automatically.
        </p>
        <div className="inline-block w-6 h-6 mb-6" style={{
          border: '2px solid rgba(240,192,64,0.3)',
          borderTopColor: 'var(--gold-500)',
          borderRadius: '50%',
          animation: 'spin 0.9s linear infinite',
        }} />
        {paymentPollAttempt >= 4 && (
          <div className="mt-4">
            <button
              onClick={recheckEligibility}
              disabled={recheckStatus === 'busy'}
              className="px-5 py-2 font-mono text-xs font-medium tracking-wide transition-all"
              style={{
                background: 'transparent',
                color: 'var(--gold-500)',
                border: '1px solid rgba(240,192,64,0.5)',
                borderRadius: '2px',
                cursor: recheckStatus === 'busy' ? 'wait' : 'pointer',
                opacity: recheckStatus === 'busy' ? 0.55 : 1,
              }}
            >
              {recheckStatus === 'busy' ? 'CHECKING…' : "I'VE ALREADY PAID · CHECK NOW"}
            </button>
            <p className="font-mono text-[11px] mt-2" style={{ color: 'rgba(248,245,238,0.35)' }}>
              attempt {paymentPollAttempt} / 45
            </p>
            {recheckStatus === 'no-credit' && (
              <p className="font-mono text-[11px] mt-2" style={{ color: 'rgba(248,245,238,0.55)' }}>
                webhook hasn't landed yet · keep waiting or refresh in 30s
              </p>
            )}
            {recheckStatus === 'error' && (
              <p className="font-mono text-[11px] mt-2" style={{ color: 'var(--scarlet)' }}>
                connection error · hard refresh (⌘⇧R) and try again
              </p>
            )}
          </div>
        )}
        {!paymentPolling && (
          <p className="font-light mt-4 text-sm" style={{ color: 'rgba(248,245,238,0.45)' }}>
            Webhook took longer than expected. Click above to refresh — your
            payment is safe and the receipt is in your email.
          </p>
        )}
      </div>
    )
  }
  if (eligibility && !eligibility.ok) {
    return <PaymentGate eligibility={eligibility} />
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

      {error && createPortal(
        <div
          onClick={() => setError('')}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(6,12,26,0.78)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="card-navy"
            style={{
              maxWidth: '480px', width: '100%',
              border: '1px solid rgba(200,16,46,0.4)',
              borderRadius: '2px',
              padding: '24px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div className="font-mono text-xs tracking-widest mb-3" style={{ color: '#F87171' }}>
              // SUBMISSION BLOCKED
            </div>
            <div className="font-mono text-sm mb-5" style={{ color: 'var(--cream)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {error}
            </div>
            <button
              onClick={() => setError('')}
              className="w-full py-2.5 font-mono text-xs tracking-wide transition-colors"
              style={{
                background: 'var(--gold-500)',
                color: 'var(--navy-900)',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer',
              }}
            >
              GOT IT
            </button>
          </div>
        </div>,
        document.body,
      )}

      {eligibility?.ok && step < 3 && (
        <div className="mb-5 px-4 py-2.5 font-mono text-xs tracking-wide" style={{
          background: 'rgba(0,212,170,0.06)',
          border: '1px solid rgba(0,212,170,0.22)',
          color: '#00D4AA',
          borderRadius: '2px',
        }}>
          FREE AUDITION · {eligibility.remainingFree} of {eligibility.freeQuota} remaining
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

          {/* 7-cat ladder placement · optional · auto-detector fills if blank */}
          <div>
            <label className="block">
              <span className="block font-mono text-[11px] tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
                CATEGORY · LADDER PLACEMENT (OPTIONAL)
              </span>
              <p className="font-mono text-[11px] mb-2" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Pick the use-case that best describes your project. Leave blank and we'll suggest one
                from the audit · you can change it anytime.
              </p>
              <select
                value={form.category}
                onChange={(e) => setForm(f => ({ ...f, category: e.target.value as FormData['category'] }))}
                className="w-full px-3 py-2.5 font-mono text-xs"
                style={{
                  background: 'rgba(6,12,26,0.6)',
                  color: form.category ? 'var(--cream)' : 'var(--text-muted)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '2px',
                }}
              >
                <option value="">— Auto-detect (suggest after audit) —</option>
                {(['productivity_personal','niche_saas','creator_media','dev_tools','ai_agents_chat','consumer_lifestyle','games_playful'] as const).map(c => (
                  <option key={c} value={c}>
                    {({
                      productivity_personal: 'Productivity & Personal',
                      niche_saas:            'Niche SaaS',
                      creator_media:         'Creator & Media',
                      dev_tools:             'Dev Tools',
                      ai_agents_chat:        'AI Agents & Chat',
                      consumer_lifestyle:    'Consumer & Lifestyle',
                      games_playful:         'Games & Playful',
                    } as const)[c]}
                  </option>
                ))}
              </select>
            </label>
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
            setForm({ name: '', email: user?.email ?? '', github: '', url: '', desc: '', category: '' })
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

      <PaymentResultModal
        open={paymentResult !== null}
        variant={paymentResult ?? 'success'}
        paidCredit={eligibility && 'paidCredit' in eligibility ? eligibility.paidCredit : null}
        onClose={() => setPaymentResult(null)}
      />
    </div>
  )
}

// ── PaymentGate ────────────────────────────────────────────────────────────
// Shown when checkRegistrationEligibility returns ok=false (free quota gone +
// no paid credit). Calls the create-checkout-session Edge Function and
// redirects to the Stripe Checkout URL.
function PaymentGate({ eligibility }: { eligibility: Extract<RegistrationEligibility, { ok: false }> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const priceDollars = (eligibility.priceCents / 100).toFixed(0)
  const breakdown = priceBreakdown(eligibility.priceCents)
  const costDollars    = (breakdown.cost    / 100).toFixed(0)
  const depositDollars = (breakdown.deposit / 100).toFixed(0)
  // Founder pricing surfaces both the discount AND the scarcity ("947
  // founder spots left"). When the window is closed, all three values
  // collapse and we fall back to the standard narrative.
  const founder = eligibility.founder
  const founderActive = !!(founder && founder.windowOpen && founder.remaining > 0)

  const handleCheckout = async () => {
    setBusy(true)
    setError(null)
    try {
      const { data: sessionRes } = await supabase.auth.getSession()
      const token = sessionRes.session?.access_token
      if (!token) throw new Error('Sign in expired · refresh and try again')

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ kind: 'audit_fee' }),
      })
      const body = await res.json()
      if (!res.ok || !body.url) {
        throw new Error(body.error || `Checkout failed (${res.status})`)
      }
      // Hand off to Stripe — full-page redirect, the user comes back via
      // success_url / cancel_url after Stripe finishes.
      window.location.assign(body.url)
    } catch (e) {
      setBusy(false)
      setError((e as Error).message || 'Checkout failed')
    }
  }

  return (
    <div className="max-w-xl mx-auto text-center card-navy p-10" style={{ borderRadius: '2px' }}>
      <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
        // {founderActive ? `FOUNDER PRICING — $${priceDollars}` : `PAYMENT REQUIRED — $${priceDollars}`}
      </div>
      <h3 className="font-display font-bold text-2xl mb-3" style={{ color: 'var(--cream)' }}>
        {eligibility.freeQuota > 0 ? 'Free quota used' : 'Audition fee'}
      </h3>
      <p className="font-light mb-4" style={{ color: 'rgba(248,245,238,0.6)' }}>
        {eligibility.freeQuota > 0 ? (
          <>You've already auditioned {eligibility.priorCount} products. The first {eligibility.freeQuota} per
          member are free — your next audition needs the audit fee.</>
        ) : (
          <>Each audition has a one-time fee. Pay once per product · no subscription.</>
        )}
      </p>

      {/* Narrative breakdown · strategy doc §7.6: never lead with "$99
          audition fee" naked — decompose into cost + refundable deposit
          on every price surface so the gut "too high" reaction lands on
          the actual non-refundable amount ($20 at full / $10 at founder). */}
      <div className="mb-5 px-4 py-3" style={{
        background: 'rgba(240,192,64,0.04)',
        border: '1px solid rgba(240,192,64,0.18)',
        borderRadius: '2px',
        textAlign: 'left',
      }}>
        <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
          WHAT YOU'RE ACTUALLY PAYING
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-y-1 font-mono text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          <span>Audit & operations cost <span style={{ color: 'var(--text-muted)' }}>· non-refundable</span></span>
          <span className="tabular-nums" style={{ color: 'var(--cream)' }}>${costDollars}</span>
          <span>Graduation deposit <span style={{ color: 'var(--text-muted)' }}>· refunded on Diploma</span></span>
          <span className="tabular-nums" style={{ color: 'var(--cream)' }}>${depositDollars}</span>
          <span style={{ borderTop: '1px solid rgba(240,192,64,0.2)', paddingTop: 4, color: 'var(--gold-500)' }}>Total</span>
          <span className="tabular-nums" style={{ borderTop: '1px solid rgba(240,192,64,0.2)', paddingTop: 4, color: 'var(--gold-500)', fontWeight: 700 }}>${priceDollars}</span>
        </div>
        <div className="font-mono text-[10px] mt-2" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Net cost if your product graduates: <span style={{ color: 'var(--cream)' }}>${costDollars}</span>.{' '}
          If it doesn't: ${priceDollars} (full audit · Encore eligibility · community access · permanent record).
        </div>
      </div>

      {/* Founder pricing scarcity strip · only shown while window is
          open. Surfaces the live remaining count so the urgency is real,
          not theatrical. */}
      {founderActive && founder && (
        <div className="mb-5 px-4 py-2.5" style={{
          background: 'rgba(167,139,250,0.06)',
          border: '1px solid rgba(167,139,250,0.3)',
          borderRadius: '2px',
        }}>
          <div className="font-mono text-[10px] tracking-widest mb-1" style={{ color: '#A78BFA' }}>
            FOUNDER PRICING ACTIVE
          </div>
          <div className="font-mono text-[11px]" style={{ color: 'var(--cream)', lineHeight: 1.5 }}>
            <strong style={{ color: '#A78BFA' }}>{founder.remaining.toLocaleString()}</strong> of {founder.cap.toLocaleString()} founder spots remaining.{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              Locks in at $99 once filled — the first {founder.cap.toLocaleString()} paying creators carry the discount forever.
            </span>
          </div>
        </div>
      )}

      <button
        onClick={handleCheckout}
        disabled={busy}
        className="w-full py-3.5 font-mono text-sm tracking-wide transition-all"
        style={{
          background:   busy ? 'rgba(240,192,64,0.4)' : 'var(--gold-500)',
          color:        'var(--navy-900)',
          border:       'none',
          borderRadius: '2px',
          cursor:       busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'Opening Stripe Checkout…' : `Pay $${priceDollars} · proceed to audit →`}
      </button>

      {error && (
        <div className="mt-3 px-3 py-2 font-mono text-[11px]" style={{
          background: 'rgba(200,16,46,0.08)',
          border: '1px solid rgba(200,16,46,0.25)',
          color: '#F87171',
          borderRadius: '2px',
        }}>
          {error}
        </div>
      )}

      <p className="mt-4 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Card · Apple Pay · Google Pay · processed by Stripe.
      </p>
    </div>
  )
}
