// PaymentResultModal — celebrates a successful Stripe Checkout return,
// or acknowledges a canceled one. Mounted by SubmitForm when it sees
// ?payment=success / ?payment=canceled in the URL after the Stripe
// redirect. Self-dismisses on backdrop click / Escape / "Start audit".
//
// On dismiss it strips the ?payment query params from the URL with
// history.replaceState so a refresh doesn't re-trigger the modal.

import { createPortal } from 'react-dom'
import { useEffect } from 'react'

type Variant = 'success' | 'canceled'

interface Props {
  open:    boolean
  variant: Variant
  onClose: () => void
  /** Updated paid_audits_credit count after the webhook ran · for the
   *  success copy. Falls back to "1" while the count is still loading. */
  paidCredit?: number | null
}

export function PaymentResultModal({ open, variant, onClose, paidCredit }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const accent = variant === 'success' ? 'rgba(0,212,170,0.4)' : 'rgba(240,192,64,0.4)'

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(6,12,26,0.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card-navy"
        style={{
          maxWidth: '480px', width: '100%',
          border: `1px solid ${accent}`,
          borderRadius: '2px',
          padding: '28px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {variant === 'success' ? <SuccessBody paidCredit={paidCredit} onClose={onClose} />
                                : <CanceledBody onClose={onClose} />}
      </div>
    </div>,
    document.body,
  )
}

function SuccessBody({ paidCredit, onClose }: { paidCredit?: number | null; onClose: () => void }) {
  // Inline checkmark · matches icons.tsx convention (currentColor stroke).
  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div
          className="flex items-center justify-center"
          style={{
            width: 36, height: 36,
            background: 'rgba(0,212,170,0.12)',
            border: '1px solid rgba(0,212,170,0.4)',
            borderRadius: '2px',
            color: '#00D4AA',
          }}
        >
          <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </div>
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: '#00D4AA' }}>
            // PAYMENT CONFIRMED
          </div>
          <div className="font-display font-bold text-xl mt-0.5" style={{ color: 'var(--cream)' }}>
            Audit credit unlocked
          </div>
        </div>
      </div>

      <p className="font-light text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
        Thank you · your audit credit landed. You now have{' '}
        <strong style={{ color: 'var(--gold-500)' }}>
          {(paidCredit ?? 1).toLocaleString()} paid audit{(paidCredit ?? 1) === 1 ? '' : 's'}
        </strong>{' '}
        ready to spend on a project. The Encore credit portion is recoupable
        when the product earns Encore (see Rulebook).
      </p>

      <div className="mb-5 px-4 py-3 font-mono text-[11px]" style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '2px',
        color: 'var(--text-secondary)',
        lineHeight: 1.7,
      }}>
        <div style={{ color: 'var(--gold-500)' }} className="tracking-widest mb-1">// WHAT'S NEXT</div>
        <div><strong style={{ color: 'var(--cream)' }}>1.</strong> Step 1 · paste your GitHub repo + live URL.</div>
        <div><strong style={{ color: 'var(--cream)' }}>2.</strong> Step 2 · your AI tool generates a Build Brief from the repo.</div>
        <div><strong style={{ color: 'var(--cream)' }}>3.</strong> Step 3 · audit engine runs (60–90s) · score lands on the ladder.</div>
      </div>

      <p className="font-mono text-[11px] mb-5" style={{ color: 'var(--text-muted)' }}>
        Stripe receipt sent to your email. Project, brief, audit history are
        all linkable from your profile.
      </p>

      <button
        onClick={onClose}
        className="w-full py-3 font-mono text-sm tracking-wide"
        style={{
          background:   'var(--gold-500)',
          color:        'var(--navy-900)',
          border:       'none',
          borderRadius: '2px',
          cursor:       'pointer',
          fontWeight:   600,
        }}
      >
        Start your audit →
      </button>
    </>
  )
}

function CanceledBody({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
        // CHECKOUT CANCELED
      </div>
      <div className="font-display font-bold text-xl mb-3" style={{ color: 'var(--cream)' }}>
        No charge made
      </div>
      <p className="font-light text-sm mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
        You backed out before completing payment — your card was not charged.
        Your audit slot is still available whenever you're ready.
      </p>
      <button
        onClick={onClose}
        className="w-full py-3 font-mono text-sm tracking-wide"
        style={{
          background:   'transparent',
          color:        'var(--cream)',
          border:       '1px solid rgba(255,255,255,0.2)',
          borderRadius: '2px',
          cursor:       'pointer',
        }}
      >
        Got it
      </button>
    </>
  )
}
