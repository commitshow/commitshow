// Notification bell — sits in Nav between the Audition CTA and the profile
// button. Only mounts when signed in.
//
// Behavior:
//   · Unread count polled on mount + kept live via Supabase Realtime
//   · Dropdown fetches the latest 25 when opened
//   · Clicking a row marks it read and navigates if we know the destination
//   · "Mark all read" zeroes the badge without needing to visit each row

import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconBell, IconApplaud, IconForecast, IconComment } from './icons'
import {
  fetchNotifications, fetchUnreadCount, markRead, markAllRead,
  subscribeNotifications, destinationFor, titleFor,
  type NotificationRow,
} from '../lib/notifications'

interface Props {
  recipientId: string
}

export function NotificationBell({ recipientId }: Props) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [rows, setRows] = useState<NotificationRow[] | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Capture latest `open` for the subscribe callback without making the
  // effect depend on it · re-running the effect would create a duplicate
  // channel and Supabase rejects `.on()` on an already-subscribed channel.
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open }, [open])

  // Stable refresh helper — used by the subscription callback.
  const refreshAll = useCallback(() => {
    fetchUnreadCount().then(setUnread)
    if (openRef.current) fetchNotifications(25).then(setRows)
  }, [])

  // Initial count + realtime subscription · runs once per recipient.
  useEffect(() => {
    if (!recipientId) return
    fetchUnreadCount().then(setUnread)
    const unsub = subscribeNotifications(recipientId, refreshAll)
    return unsub
  }, [recipientId, refreshAll])

  // Load feed when panel opens.
  useEffect(() => {
    if (open && rows === null) fetchNotifications(25).then(setRows)
  }, [open, rows])

  // Click-outside to dismiss.
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const onRowClick = async (n: NotificationRow) => {
    setOpen(false)
    // Ticket gifts have their own celebration modal (TicketGiftCelebration
    // mounted in App.tsx). If we mark-read here, the modal sees zero
    // unread gifts on the next render and never fires — recipient gets
    // no celebratory moment. Skip the auto-mark and let the modal own
    // the read state (its handleDismiss calls markRead). Then dispatch
    // a window event so the modal re-fetches and surfaces this gift
    // even if it was already mounted (same /me route, no remount).
    if (n.kind !== 'ticket_gift' && !n.read_at) {
      await markRead(n.id)
      setUnread(c => Math.max(0, c - 1))
      setRows(prev => prev?.map(r => r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r) ?? prev)
    }
    const dest = destinationFor(n)
    if (dest) navigate(dest)
    if (n.kind === 'ticket_gift') {
      window.dispatchEvent(new CustomEvent('commitshow:check-gifts'))
    }
  }

  const onMarkAll = async () => {
    await markAllRead(recipientId)
    setUnread(0)
    setRows(prev => prev?.map(r => r.read_at ? r : { ...r, read_at: new Date().toISOString() }) ?? prev)
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        className="relative flex items-center justify-center transition-colors"
        style={{
          width: 34, height: 34,
          background: 'transparent',
          color: unread > 0 ? 'var(--gold-500)' : 'rgba(248,245,238,0.6)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '2px',
          cursor: 'pointer',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(240,192,64,0.4)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
      >
        <IconBell size={16} />
        {unread > 0 && (
          <span
            className="absolute font-mono text-[9px] font-bold tabular-nums flex items-center justify-center"
            style={{
              top: -4, right: -4,
              minWidth: 16, height: 16, padding: '0 4px',
              background: 'var(--scarlet)',
              color: 'var(--cream)',
              borderRadius: '8px',
              border: '1px solid var(--navy-900)',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 max-h-[70vh] overflow-y-auto"
          style={{
            background: 'rgba(6,12,26,0.98)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(240,192,64,0.2)',
            borderRadius: '2px',
          }}
        >
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--gold-500)' }}>
              // NOTIFICATIONS
            </span>
            {unread > 0 && (
              <button
                onClick={onMarkAll}
                className="font-mono text-[10px] tracking-wide transition-colors"
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              >
                Mark all read
              </button>
            )}
          </div>

          {rows === null ? (
            <div className="px-4 py-6 font-mono text-xs text-center" style={{ color: 'var(--text-muted)' }}>
              loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
                NOTHING YET
              </div>
              <div className="font-light text-xs" style={{ color: 'var(--text-secondary)' }}>
                When someone applauds your work or forecasts on your project,
                you'll see it here.
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              {rows.map(n => <NotificationRowView key={n.id} n={n} onClick={() => onRowClick(n)} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NotificationRowView({ n, onClick }: { n: NotificationRow; onClick: () => void }) {
  const unread = !n.read_at
  const KindIcon = n.kind === 'applaud'           ? IconApplaud
                 : n.kind === 'comment'           ? IconComment
                 : n.kind === 'reaudit'           ? IconForecast   // re-uses target icon · close enough
                 : n.kind === 'ticket_gift'       ? IconApplaud    // celebratory tone matches a gift moment
                 : n.kind === 'ticket_gift_sent'  ? IconApplaud
                 : IconForecast
  const tone     = n.kind === 'applaud'           ? 'var(--gold-500)'
                 : n.kind === 'comment'           ? 'var(--cream)'
                 : n.kind === 'reaudit'           ? 'var(--gold-500)'
                 : n.kind === 'ticket_gift'       ? 'var(--gold-500)'
                 : n.kind === 'ticket_gift_sent'  ? '#A78BFA'      // violet · sender-side · different from celebratory gold
                 : '#00D4AA'
  const initial = (n.actor_display_name ?? '?').slice(0, 1).toUpperCase()

  return (
    <button
      onClick={onClick}
      className="text-left px-4 py-3 transition-colors"
      style={{
        background: unread ? 'rgba(240,192,64,0.04)' : 'transparent',
        border: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        cursor: 'pointer',
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = unread ? 'rgba(240,192,64,0.08)' : 'rgba(255,255,255,0.03)')}
      onMouseLeave={e => (e.currentTarget.style.background = unread ? 'rgba(240,192,64,0.04)' : 'transparent')}
    >
      {/* Actor avatar · tone dot · unified indicator */}
      <div className="flex-shrink-0 relative">
        <span
          className="flex items-center justify-center font-mono text-[10px] font-bold overflow-hidden"
          style={{
            width: 28, height: 28,
            background: n.actor_avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
            color: 'var(--navy-900)',
            borderRadius: '2px',
          }}
        >
          {n.actor_avatar_url
            ? <img src={n.actor_avatar_url} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
            : initial}
        </span>
        <span
          aria-hidden="true"
          className="absolute flex items-center justify-center"
          style={{
            bottom: -3, right: -3,
            width: 16, height: 16,
            background: 'var(--navy-900)',
            color: tone,
            border: `1px solid ${tone}55`,
            borderRadius: '2px',
          }}
        >
          <KindIcon size={10} />
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-light text-xs" style={{ color: 'var(--cream)', lineHeight: 1.5 }}>
          {titleFor(n)}
        </div>
        <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {timeAgo(n.created_at)}
        </div>
      </div>

      {unread && (
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, background: 'var(--gold-500)', borderRadius: '50%', marginTop: 8, flexShrink: 0 }}
        />
      )}
    </button>
  )
}

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60)    return 'just now'
  if (s < 3600)  return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  const d = Math.floor(s / 86400)
  if (d < 30)    return `${d}d`
  return `${Math.floor(d / 30)}mo`
}
