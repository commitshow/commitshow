// TicketGiftCelebration · centered modal that fires when a member logs
// in (or is already online) and has unread 'ticket_gift' notifications.
//
// One modal at a time, oldest unread first. Dismissing marks the
// notification read so it doesn't pop again on next page load.
//
// Mounted once in App.tsx · visible only when there's something to
// celebrate. Subscribes to realtime so a gift sent while the user is
// online still surfaces immediately.

import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { markRead, type NotificationRow } from '../lib/notifications'

const FEED_COLS =
  'id,recipient_id,actor_id,kind,target_type,target_id,project_id,metadata,read_at,created_at,' +
  'actor_display_name,actor_avatar_url,actor_grade,project_name,community_post_title,community_post_type'

export function TicketGiftCelebration() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState<NotificationRow[]>([])
  const [dismissing, setDismissing] = useState(false)

  const fetchUnreadGifts = useCallback(async (memberId: string) => {
    const { data } = await supabase
      .from('notification_feed')
      .select(FEED_COLS)
      .eq('recipient_id', memberId)
      .eq('kind', 'ticket_gift')
      .is('read_at', null)
      .order('created_at', { ascending: true })  // oldest first · we pop one at a time
      .limit(10)
    setPending((data ?? []) as unknown as NotificationRow[])
  }, [])

  // On login (or user change) fetch pending unread gifts.
  useEffect(() => {
    if (!user?.id) { setPending([]); return }
    void fetchUnreadGifts(user.id)
  }, [user?.id, fetchUnreadGifts])

  // Realtime · push a new gift into the queue when it arrives.
  useEffect(() => {
    if (!user?.id) return
    const memberId = user.id
    const channel = supabase
      .channel(`ticket-gift-celebration:${memberId}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'notifications',
        filter: `recipient_id=eq.${memberId}`,
      }, payload => {
        const row = payload.new as { kind?: string; id?: string }
        if (row.kind !== 'ticket_gift' || !row.id) return
        // Refetch to get the joined feed columns (actor display_name, avatar).
        void fetchUnreadGifts(memberId)
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [user?.id, fetchUnreadGifts])

  if (pending.length === 0) return null
  const current = pending[0]
  const meta = (current.metadata as { quantity?: number; message?: string } | null) ?? {}
  const qty = meta.quantity ?? 1
  const message = meta.message ?? null
  const actor = current.actor_display_name ?? 'A fellow builder'
  const initial = actor.slice(0, 1).toUpperCase()

  const handleDismiss = async () => {
    if (dismissing) return
    setDismissing(true)
    try { await markRead(current.id) } catch {}
    // Pop this one · the next unread (if any) becomes current.
    setPending(p => p.slice(1))
    setDismissing(false)
    // Refresh the wallet card too so the new ticket count is visible
    // immediately when they land on /me.
    window.dispatchEvent(new CustomEvent('commitshow:tickets-updated'))
  }

  const handleGoToWallet = async () => {
    await handleDismiss()
    navigate('/me')
  }

  return createPortal(
    <div
      onClick={dismissing ? undefined : handleDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(6,12,26,0.92)',
        backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem',
        animation: 'celebFadeIn 200ms ease-out',
      }}
    >
      {/* Soft radial glow behind the card · gold halo */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(circle at center, rgba(240,192,64,0.18) 0%, transparent 50%)',
      }} />

      <div
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-md"
        style={{
          background: 'linear-gradient(180deg, rgba(15,32,64,0.98) 0%, rgba(6,12,26,0.98) 100%)',
          border: '1px solid rgba(240,192,64,0.5)',
          borderRadius: '2px',
          boxShadow: '0 0 80px rgba(240,192,64,0.25)',
          padding: '2.5rem 2rem',
          textAlign: 'center',
          animation: 'celebPop 320ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Big gift icon */}
        <div style={{
          fontSize: '4rem',
          lineHeight: 1,
          marginBottom: '0.5rem',
          animation: 'celebSpin 600ms ease-out',
        }}>
          🎁
        </div>

        <div className="font-mono text-[10px] tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
          // SURPRISE!
        </div>

        <h2 className="font-display font-black mb-3" style={{
          color: 'var(--cream)',
          fontSize: 'clamp(1.5rem, 4vw, 2rem)',
          lineHeight: 1.2,
        }}>
          You got {qty === 1 ? 'an audition ticket' : `${qty} audition tickets`}!
        </h2>

        {/* Sender pill */}
        <div className="flex items-center justify-center gap-2 mb-5">
          <span
            className="flex items-center justify-center font-mono text-xs font-bold overflow-hidden"
            style={{
              width: 28, height: 28,
              background: current.actor_avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
              color: 'var(--navy-900)',
              borderRadius: '2px',
              flexShrink: 0,
            }}
          >
            {current.actor_avatar_url
              ? <img src={current.actor_avatar_url} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
              : initial}
          </span>
          <span className="font-light text-sm" style={{ color: 'rgba(248,245,238,0.8)' }}>
            from <strong style={{ color: 'var(--gold-500)' }}>{actor}</strong>
          </span>
        </div>

        {message && (
          <div className="px-4 py-3 mb-5 font-light text-sm italic" style={{
            background:   'rgba(240,192,64,0.06)',
            border:       '1px solid rgba(240,192,64,0.25)',
            borderRadius: '2px',
            color:        'var(--cream)',
            lineHeight:   1.6,
          }}>
            "{message}"
          </div>
        )}

        <p className="font-mono text-[11px] mb-6" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Spend any time on a backstage project · puts it on the live ladder.
        </p>

        <div className="flex gap-2 justify-center flex-wrap">
          <button
            type="button"
            onClick={handleGoToWallet}
            disabled={dismissing}
            className="px-5 py-2.5 text-xs font-medium tracking-wide"
            style={{
              background: 'var(--gold-500)',
              color: 'var(--navy-900)',
              border: 'none',
              borderRadius: '2px',
              cursor: dismissing ? 'wait' : 'pointer',
              fontFamily: 'DM Mono, monospace',
              fontWeight: 700,
            }}
          >
            GO TO MY WALLET →
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={dismissing}
            className="px-5 py-2.5 text-xs font-medium tracking-wide"
            style={{
              background: 'transparent',
              color: 'var(--cream)',
              border: '1px solid rgba(248,245,238,0.2)',
              borderRadius: '2px',
              cursor: dismissing ? 'wait' : 'pointer',
              fontFamily: 'DM Mono, monospace',
            }}
          >
            Maybe later
          </button>
        </div>

        {pending.length > 1 && (
          <p className="font-mono text-[10px] mt-4" style={{ color: 'var(--text-muted)' }}>
            +{pending.length - 1} more gift{pending.length - 1 === 1 ? '' : 's'} waiting
          </p>
        )}
      </div>

      <style>{`
        @keyframes celebFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes celebPop {
          0%   { opacity: 0; transform: scale(0.85); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes celebSpin {
          0%   { transform: rotate(-15deg) scale(0.5); opacity: 0; }
          60%  { transform: rotate(8deg)  scale(1.2);  opacity: 1; }
          100% { transform: rotate(0deg)  scale(1); }
        }
      `}</style>
    </div>,
    document.body,
  )
}
