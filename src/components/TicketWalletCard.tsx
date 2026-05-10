// TicketWalletCard · /me · always-visible audition ticket wallet.
//
// Shows the member's ticket balance (free quota + paid credit) at all
// times so they understand what they have before they audition. The
// 'Buy more' CTA opens Stripe Checkout for an additional ticket.
//
// Buy gating mirrors create-checkout-session's server gate so we
// never surface a CTA that the Edge Function would 400 on:
//   · free_remaining > 0  → 'Use free first' (Buy disabled)
//   · paid_credit > 0     → 'Use existing first' (Buy disabled)
//   · both 0              → Buy enabled; click hits Stripe with no
//                            audition_target (standalone purchase)
//
// On Stripe return, success_url has no audition_target so the
// /submit page (or wherever they redirect to) just polls eligibility
// and lands on the form/portfolio without auto-promoting anything.
// Their paid_audits_credit becomes 1, ready to spend on whichever
// backstage project they want.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { fetchFounderStatus, REGISTRATION_PRICE_CENTS, FOUNDER_PRICE_FALLBACK_CENTS, type FounderStatus } from '../lib/pricing'

interface TicketBalance {
  free_remaining: number
  paid_credit:    number
  total_tickets:  number
  free_quota:     number
  prior_active:   number
}

const QUANTITY_PRESETS = [1, 3, 5, 10] as const

export function TicketWalletCard({ memberId }: { memberId: string }) {
  const [balance,  setBalance]  = useState<TicketBalance | null>(null)
  const [founder,  setFounder]  = useState<FounderStatus | null>(null)
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [giftOpen,   setGiftOpen]   = useState(false)
  const [quantity,   setQuantity]   = useState<number>(1)

  useEffect(() => {
    let alive = true
    const load = () => {
      void Promise.all([
        supabase.rpc('ticket_balance', { p_member_id: memberId }),
        fetchFounderStatus(),
      ]).then(([bal, fnd]) => {
        if (!alive) return
        if (!bal.error) setBalance(bal.data as TicketBalance)
        setFounder(fnd)
      })
    }
    load()
    // Refresh on the global tickets-updated event · dispatched after a
    // successful audition_project RPC anywhere in the app so this card
    // (and the Nav callout) stay in sync without prop-drilling.
    const onUpdate = () => load()
    window.addEventListener('commitshow:tickets-updated', onUpdate)
    return () => {
      alive = false
      window.removeEventListener('commitshow:tickets-updated', onUpdate)
    }
  }, [memberId])

  const handleBuy = async () => {
    setBusy(true)
    setError(null)
    try {
      const { data: sessionRes } = await supabase.auth.getSession()
      const token = sessionRes.session?.access_token
      if (!token) throw new Error('Sign in expired · refresh and try again')

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        // No audition_target · this is a standalone wallet top-up.
        // success_url falls back to /me so the user lands here after.
        body: JSON.stringify({
          kind: 'audit_fee',
          quantity,
          success_url: `${window.location.origin}/me?payment=success`,
          cancel_url:  `${window.location.origin}/me?payment=canceled`,
        }),
      })
      const body = await res.json()
      if (!res.ok || !body.url) throw new Error(body.error || `Checkout failed (${res.status})`)
      window.location.assign(body.url)
    } catch (err) {
      setBusy(false)
      setError((err as Error).message)
    }
  }

  if (!balance) return null

  const founderActive = !!(founder && founder.windowOpen && founder.remaining > 0)
  const priceCents    = founderActive ? founder.priceCents : REGISTRATION_PRICE_CENTS
  const priceDollars  = (priceCents / 100).toFixed(0)
  const standardDollars = (REGISTRATION_PRICE_CENTS / 100).toFixed(0)

  // Stockpiling allowed (2026-05-11) — buy any time, even with free
  // quota or paid credit remaining. audition_project RPC spends free
  // first then paid, so additional buys just stack.
  const canBuy = true

  return (
    <div className="card-navy p-5 mb-6" style={{ borderRadius: '2px', borderLeft: '3px solid var(--gold-500)' }}>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // AUDITION TICKETS
          </div>
          <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Spend one to put a backstage project on stage
          </div>
        </div>

        {/* Ticket count badge — big, easy to read */}
        <div className="flex items-baseline gap-2">
          <div className="font-display font-black tabular-nums" style={{
            fontSize: '2rem',
            color: balance.total_tickets > 0 ? 'var(--gold-500)' : 'var(--text-muted)',
            lineHeight: 1,
          }}>
            {balance.total_tickets}
          </div>
          <div className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            ticket{balance.total_tickets === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {/* Breakdown line */}
      <div className="font-mono text-[11px] mb-4" style={{ color: 'var(--text-secondary)' }}>
        {balance.free_remaining > 0 && (
          <span style={{ color: 'var(--cream)' }}>{balance.free_remaining} free</span>
        )}
        {balance.free_remaining > 0 && balance.paid_credit > 0 && <span> · </span>}
        {balance.paid_credit > 0 && (
          <span style={{ color: 'var(--cream)' }}>{balance.paid_credit} paid</span>
        )}
        {balance.total_tickets === 0 && (
          <span style={{ color: 'var(--text-muted)' }}>No tickets · audition fee applies on next purchase</span>
        )}
      </div>

      {/* Buy CTA + state-specific helper */}
      {error && (
        <div className="mb-3 px-3 py-2 font-mono text-[11px]" style={{
          background: 'rgba(200,16,46,0.08)',
          border: '1px solid rgba(200,16,46,0.4)',
          borderRadius: '2px',
          color: 'var(--scarlet)',
        }}>
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => { setQuantity(1); setError(null); setDialogOpen(true) }}
          disabled={!canBuy}
          className="px-4 py-2 text-xs font-medium tracking-wide transition-all inline-flex items-center gap-1.5"
          style={{
            background:   canBuy ? 'var(--gold-500)' : 'rgba(240,192,64,0.18)',
            color:        canBuy ? 'var(--navy-900)' : 'var(--text-muted)',
            border:       'none',
            borderRadius: '2px',
            cursor:       !canBuy ? 'not-allowed' : 'pointer',
            fontFamily:   'DM Mono, monospace',
          }}
        >
          {founderActive ? (
            <>
              <span>BUY TICKETS · from</span>
              <s style={{ opacity: 0.55, textDecorationThickness: '1.5px' }}>${standardDollars}</s>
              <strong>${priceDollars}</strong>
            </>
          ) : (
            <span>BUY TICKETS · from ${priceDollars}</span>
          )}
        </button>

        {/* Gift · only available when sender has paid credit. Free
            tickets are an account-bound intro grant and don't transfer. */}
        {balance.paid_credit > 0 && (
          <button
            type="button"
            onClick={() => { setError(null); setGiftOpen(true) }}
            className="px-4 py-2 text-xs font-medium tracking-wide transition-all inline-flex items-center gap-1.5"
            style={{
              background:   'transparent',
              color:        'var(--cream)',
              border:       '1px solid rgba(248,245,238,0.2)',
              borderRadius: '2px',
              cursor:       'pointer',
              fontFamily:   'DM Mono, monospace',
            }}
            title={`Gift up to ${balance.paid_credit} of your paid tickets to another member`}
          >
            🎁 GIFT
          </button>
        )}

        {founderActive && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--gold-500)' }}>
            {founder!.remaining} founder spots left
          </span>
        )}
      </div>

      <p className="font-mono text-[10px] mt-3" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Tickets don't expire · use any time on a backstage project. Payment goes through Stripe ·
        Encore credit recoupable when the project crosses score 85+.
      </p>

      {dialogOpen && createPortal(
        <BuyTicketsDialog
          quantity={quantity}
          setQuantity={setQuantity}
          unitDollars={parseInt(priceDollars)}
          standardUnitDollars={parseInt(standardDollars)}
          founderActive={founderActive}
          founderRemaining={founder?.remaining ?? null}
          busy={busy}
          error={error}
          onConfirm={handleBuy}
          onClose={() => { if (!busy) setDialogOpen(false) }}
        />,
        document.body,
      )}

      {giftOpen && createPortal(
        <GiftTicketsDialog
          maxQuantity={balance.paid_credit}
          onClose={() => setGiftOpen(false)}
          onSuccess={() => {
            // Re-fetch balance for this card · Nav callout listens via the
            // global event already wired in our useEffect.
            window.dispatchEvent(new CustomEvent('commitshow:tickets-updated'))
            setGiftOpen(false)
          }}
        />,
        document.body,
      )}
    </div>
  )
}

// ── BuyTicketsDialog ────────────────────────────────────────────────────────
// Modal triggered by the wallet's BUY TICKETS button. Lets the user pick
// quantity (1 / 3 / 5 / 10) and confirm. Shows the running total with the
// founder strikethrough preserved · clicking confirm opens Stripe Checkout
// (handled by parent's handleBuy).
function BuyTicketsDialog({
  quantity, setQuantity, unitDollars, standardUnitDollars, founderActive, founderRemaining,
  busy, error, onConfirm, onClose,
}: {
  quantity: number
  setQuantity: (q: number) => void
  unitDollars: number
  standardUnitDollars: number
  founderActive: boolean
  founderRemaining: number | null
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const total         = unitDollars * quantity
  const standardTotal = standardUnitDollars * quantity
  const ticketWord    = quantity === 1 ? 'ticket' : 'tickets'

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(6,12,26,0.85)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card-navy w-full max-w-md p-6"
        style={{ borderRadius: '2px', borderLeft: '3px solid var(--gold-500)' }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // BUY AUDITION TICKETS
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="font-mono text-xs"
            style={{
              background:   'transparent',
              border:       'none',
              color:        'var(--text-muted)',
              cursor:       busy ? 'wait' : 'pointer',
            }}
            aria-label="Close"
          >
            ESC ✕
          </button>
        </div>

        <p className="font-light text-sm mb-5" style={{ color: 'rgba(248,245,238,0.65)', lineHeight: 1.6 }}>
          Each ticket auditions one backstage project onto the live ladder. Tickets don't expire.
          {founderActive && (
            <> <span style={{ color: 'var(--gold-500)' }}>Founder pricing — locked in for as long as the window stays open.</span></>
          )}
        </p>

        {/* Quantity selector */}
        <div className="mb-5">
          <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-label)' }}>
            HOW MANY?
          </div>
          <div className="grid grid-cols-4 gap-2">
            {QUANTITY_PRESETS.map(q => {
              const active = quantity === q
              return (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuantity(q)}
                  disabled={busy}
                  className="py-3 font-display font-bold tabular-nums transition-all"
                  style={{
                    fontSize:     '1.25rem',
                    background:   active ? 'var(--gold-500)' : 'transparent',
                    color:        active ? 'var(--navy-900)' : 'var(--cream)',
                    border:       `1px solid ${active ? 'var(--gold-500)' : 'rgba(248,245,238,0.18)'}`,
                    borderRadius: '2px',
                    cursor:       busy ? 'wait' : 'pointer',
                  }}
                >
                  {q}
                </button>
              )
            })}
          </div>
          <div className="font-mono text-[10px] mt-1.5 text-center" style={{ color: 'var(--text-muted)' }}>
            {quantity === 1
              ? 'a single audition'
              : `${quantity} auditions in one go`}
          </div>
        </div>

        {/* Total breakdown */}
        <div className="mb-5 px-4 py-3" style={{
          background: 'rgba(240,192,64,0.06)',
          border: '1px solid rgba(240,192,64,0.22)',
          borderRadius: '2px',
        }}>
          <div className="grid grid-cols-[1fr_auto] gap-y-1 font-mono text-[12px]">
            <span style={{ color: 'var(--text-secondary)' }}>
              {quantity} × {founderActive ? `founder $${unitDollars}` : `$${unitDollars}`} per ticket
            </span>
            <span className="tabular-nums" style={{ color: 'var(--cream)' }}>
              ${total}
            </span>
            {founderActive && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>regular</span>
                <span className="tabular-nums">
                  <s style={{ opacity: 0.5, color: 'var(--text-muted)' }}>${standardTotal}</s>
                </span>
              </>
            )}
            <span style={{ borderTop: '1px solid rgba(240,192,64,0.25)', paddingTop: 4, color: 'var(--gold-500)' }}>Total</span>
            <span className="tabular-nums" style={{ borderTop: '1px solid rgba(240,192,64,0.25)', paddingTop: 4, color: 'var(--gold-500)', fontWeight: 700 }}>
              ${total}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 font-mono text-[11px]" style={{
            background: 'rgba(200,16,46,0.08)',
            border: '1px solid rgba(200,16,46,0.4)',
            borderRadius: '2px',
            color: 'var(--scarlet)',
          }}>
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-4 py-2.5 text-xs font-medium tracking-wide"
            style={{
              background:   'transparent',
              color:        'var(--cream)',
              border:       '1px solid rgba(248,245,238,0.2)',
              borderRadius: '2px',
              cursor:       busy ? 'wait' : 'pointer',
              fontFamily:   'DM Mono, monospace',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-[2] px-4 py-2.5 text-xs font-medium tracking-wide"
            style={{
              background:   'var(--gold-500)',
              color:        'var(--navy-900)',
              border:       'none',
              borderRadius: '2px',
              cursor:       busy ? 'wait' : 'pointer',
              fontFamily:   'DM Mono, monospace',
              opacity:      busy ? 0.6 : 1,
            }}
          >
            {busy ? 'OPENING STRIPE…' : `Pay $${total} → ${quantity} ${ticketWord}`}
          </button>
        </div>

        {founderActive && founderRemaining != null && (
          <p className="font-mono text-[10px] mt-4 text-center" style={{ color: 'var(--gold-500)' }}>
            {founderRemaining} founder spots left
          </p>
        )}
        <p className="font-mono text-[10px] mt-2 text-center" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Card · Apple Pay · Google Pay · processed by Stripe
        </p>
      </div>
    </div>
  )
}

// ── GiftTicketsDialog ─────────────────────────────────────────────────────
// Modal: search a member by display_name → select → confirm gift.
// Calls gift_tickets RPC on confirm. Recipient gets a notification.
//
// Daily limits enforced server-side (5 transactions, 20 tickets).
// Free tickets are not transferable; only paid_audits_credit ships.
interface MemberSearchResult {
  id:            string
  display_name:  string | null
  avatar_url:    string | null
  creator_grade: string | null
  tier:          string | null
}

function GiftTicketsDialog({
  maxQuantity, onClose, onSuccess,
}: {
  maxQuantity: number
  onClose:     () => void
  onSuccess:   () => void
}) {
  const [step,      setStep]      = useState<'search' | 'compose' | 'done'>('search')
  const [query,     setQuery]     = useState('')
  const [results,   setResults]   = useState<MemberSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [recipient, setRecipient] = useState<MemberSearchResult | null>(null)
  const [quantity,  setQuantity]  = useState<number>(1)
  const [message,   setMessage]   = useState('')
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [sent,      setSent]      = useState<{ qty: number; recipientName: string } | null>(null)

  // Debounced search
  useEffect(() => {
    if (step !== 'search') return
    if (query.trim().length < 2) { setResults(null); return }
    setSearching(true)
    const handle = setTimeout(async () => {
      const { data, error: e } = await supabase.rpc('search_members', { p_query: query, p_limit: 8 })
      setSearching(false)
      if (e) { setError(e.message); return }
      setResults((data ?? []) as MemberSearchResult[])
    }, 250)
    return () => clearTimeout(handle)
  }, [query, step])

  const handleSelect = (m: MemberSearchResult) => {
    setRecipient(m)
    setQuantity(1)
    setStep('compose')
  }

  const handleConfirm = async () => {
    if (!recipient) return
    setBusy(true)
    setError(null)
    try {
      const { data, error: e } = await supabase.rpc('gift_tickets', {
        p_recipient_id: recipient.id,
        p_quantity:     quantity,
        p_message:      message || null,
      })
      if (e) throw new Error(e.message)
      const result = data as { ok: boolean; reason?: string; sent?: number; available?: number; limit?: number; used?: number }
      if (!result.ok) {
        const msg = result.reason === 'insufficient_credit' ? `Not enough paid tickets · you have ${result.available ?? 0}`
                  : result.reason === 'daily_tx_limit'      ? `Daily transaction limit hit (${result.used}/${result.limit}) · try again tomorrow`
                  : result.reason === 'daily_qty_limit'     ? `Daily ticket limit hit (${result.used}/${result.limit}) · try again tomorrow`
                  : result.reason === 'recipient_not_found' ? 'Recipient not found'
                  : result.reason === 'invalid_recipient'   ? "You can't gift tickets to yourself"
                  : `Gift failed (${result.reason ?? 'unknown'})`
        throw new Error(msg)
      }
      setSent({ qty: result.sent ?? quantity, recipientName: recipient.display_name ?? 'them' })
      setStep('done')
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(6,12,26,0.85)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card-navy w-full max-w-md p-6"
        style={{ borderRadius: '2px', borderLeft: '3px solid var(--gold-500)' }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // {step === 'done' ? 'GIFT SENT' : '🎁 GIFT TICKETS'}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="font-mono text-xs"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: busy ? 'wait' : 'pointer' }}
            aria-label="Close"
          >
            ESC ✕
          </button>
        </div>

        {step === 'search' && (
          <>
            <p className="font-light text-sm mb-4" style={{ color: 'rgba(248,245,238,0.65)', lineHeight: 1.6 }}>
              Find a member to gift your audition tickets to. They get a notification and the tickets land
              in their wallet right away.
            </p>
            <input
              type="text"
              placeholder="Search by display name…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full px-3 py-2.5 mb-3 font-mono text-sm"
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(240,192,64,0.25)',
                color: 'var(--cream)',
                borderRadius: '2px',
                outline: 'none',
              }}
              autoFocus
            />
            {query.trim().length > 0 && query.trim().length < 2 && (
              <p className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Type at least 2 characters
              </p>
            )}
            {searching && (
              <p className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Searching…
              </p>
            )}
            {results !== null && results.length === 0 && !searching && (
              <p className="font-mono text-[11px] py-3 text-center" style={{ color: 'var(--text-muted)' }}>
                No members found · check the spelling of their display name
              </p>
            )}
            {results !== null && results.length > 0 && (
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {results.map(m => {
                  const initial = (m.display_name ?? '?').slice(0, 1).toUpperCase()
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSelect(m)}
                      className="flex items-center gap-3 w-full text-left px-3 py-2 transition-colors"
                      style={{
                        background:   'transparent',
                        border:       '1px solid rgba(248,245,238,0.08)',
                        borderRadius: '2px',
                        cursor:       'pointer',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.5)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(248,245,238,0.08)')}
                    >
                      <span
                        className="flex items-center justify-center font-mono text-xs font-bold overflow-hidden flex-shrink-0"
                        style={{
                          width: 32, height: 32,
                          background: m.avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
                          color: 'var(--navy-900)',
                          borderRadius: '2px',
                        }}
                      >
                        {m.avatar_url
                          ? <img src={m.avatar_url} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
                          : initial}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-bold text-sm truncate" style={{ color: 'var(--cream)' }}>
                          {m.display_name}
                        </div>
                        <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {m.creator_grade ?? 'Rookie'} · {m.tier ?? 'Bronze'} Scout
                        </div>
                      </div>
                      <span className="font-mono text-[10px]" style={{ color: 'var(--gold-500)' }}>SELECT →</span>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}

        {step === 'compose' && recipient && (
          <>
            {/* Selected recipient pill */}
            <div className="flex items-center gap-3 mb-5 px-3 py-2.5" style={{
              background: 'rgba(240,192,64,0.06)',
              border:     '1px solid rgba(240,192,64,0.25)',
              borderRadius: '2px',
            }}>
              <span
                className="flex items-center justify-center font-mono text-xs font-bold overflow-hidden flex-shrink-0"
                style={{
                  width: 32, height: 32,
                  background: recipient.avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
                  color: 'var(--navy-900)',
                  borderRadius: '2px',
                }}
              >
                {recipient.avatar_url
                  ? <img src={recipient.avatar_url} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
                  : (recipient.display_name ?? '?').slice(0, 1).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-sm truncate" style={{ color: 'var(--cream)' }}>
                  Gifting to {recipient.display_name}
                </div>
                <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {recipient.creator_grade ?? 'Rookie'} · {recipient.tier ?? 'Bronze'} Scout
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setRecipient(null); setStep('search') }}
                disabled={busy}
                className="font-mono text-[10px]"
                style={{ background: 'transparent', border: 'none', color: 'var(--gold-500)', cursor: busy ? 'wait' : 'pointer' }}
              >
                CHANGE
              </button>
            </div>

            {/* Quantity stepper */}
            <div className="mb-4">
              <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-label)' }}>
                HOW MANY?  <span style={{ color: 'var(--text-muted)' }}>(you have {maxQuantity})</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[1, 3, 5, 10].filter(q => q <= maxQuantity).map(q => {
                  const active = quantity === q
                  return (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setQuantity(q)}
                      disabled={busy}
                      className="py-3 font-display font-bold tabular-nums transition-all"
                      style={{
                        fontSize:     '1.25rem',
                        background:   active ? 'var(--gold-500)' : 'transparent',
                        color:        active ? 'var(--navy-900)' : 'var(--cream)',
                        border:       `1px solid ${active ? 'var(--gold-500)' : 'rgba(248,245,238,0.18)'}`,
                        borderRadius: '2px',
                        cursor:       busy ? 'wait' : 'pointer',
                      }}
                    >
                      {q}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Optional message */}
            <div className="mb-5">
              <div className="font-mono text-[10px] tracking-widest mb-1.5" style={{ color: 'var(--text-label)' }}>
                MESSAGE  <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
              </div>
              <input
                type="text"
                value={message}
                onChange={e => setMessage(e.target.value.slice(0, 140))}
                placeholder="Hey, ship that thing already 🎯"
                className="w-full px-3 py-2 font-mono text-xs"
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(248,245,238,0.18)',
                  color: 'var(--cream)',
                  borderRadius: '2px',
                  outline: 'none',
                }}
                disabled={busy}
              />
              <div className="font-mono text-[10px] mt-1 text-right" style={{ color: 'var(--text-faint)' }}>
                {message.length} / 140
              </div>
            </div>

            {error && (
              <div className="mb-4 px-3 py-2 font-mono text-[11px]" style={{
                background: 'rgba(200,16,46,0.08)',
                border: '1px solid rgba(200,16,46,0.4)',
                borderRadius: '2px',
                color: 'var(--scarlet)',
              }}>
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setRecipient(null); setStep('search') }}
                disabled={busy}
                className="flex-1 px-4 py-2.5 text-xs font-medium tracking-wide"
                style={{
                  background:   'transparent',
                  color:        'var(--cream)',
                  border:       '1px solid rgba(248,245,238,0.2)',
                  borderRadius: '2px',
                  cursor:       busy ? 'wait' : 'pointer',
                  fontFamily:   'DM Mono, monospace',
                }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy || quantity > maxQuantity}
                className="flex-[2] px-4 py-2.5 text-xs font-medium tracking-wide"
                style={{
                  background:   'var(--gold-500)',
                  color:        'var(--navy-900)',
                  border:       'none',
                  borderRadius: '2px',
                  cursor:       busy ? 'wait' : 'pointer',
                  fontFamily:   'DM Mono, monospace',
                  opacity:      busy || quantity > maxQuantity ? 0.6 : 1,
                }}
              >
                {busy ? 'SENDING…' : `🎁 GIFT ${quantity} TICKET${quantity === 1 ? '' : 'S'}`}
              </button>
            </div>
          </>
        )}

        {step === 'done' && sent && (
          <div className="text-center py-4">
            <div className="font-display font-bold text-2xl mb-2" style={{ color: 'var(--gold-500)' }}>
              🎁 Sent!
            </div>
            <p className="font-light text-sm mb-5" style={{ color: 'rgba(248,245,238,0.65)' }}>
              {sent.qty} audition ticket{sent.qty === 1 ? '' : 's'} on the way to {sent.recipientName}.
              They've been notified.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 text-xs font-medium tracking-wide"
              style={{
                background:   'var(--gold-500)',
                color:        'var(--navy-900)',
                border:       'none',
                borderRadius: '2px',
                cursor:       'pointer',
                fontFamily:   'DM Mono, monospace',
              }}
            >
              Done
            </button>
          </div>
        )}

        <p className="font-mono text-[10px] mt-5 text-center" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Free tickets stay on your account · only paid tickets transfer · 5 gifts / 20 tickets per day max
        </p>
      </div>
    </div>
  )
}
