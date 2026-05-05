// Notification feed — powers the Nav bell.
//
// Delivery: DB triggers insert a row whenever someone applauds your content
// or casts a forecast on your project (see migration 20260425150000). The
// client subscribes via Supabase Realtime to get a live unread count, and
// fetches the feed on demand when the user opens the bell dropdown.

import { supabase } from './supabase'

export type NotificationKind = 'applaud' | 'forecast' | 'comment' | 'reaudit'

export interface NotificationRow {
  id:                    string
  recipient_id:          string
  actor_id:              string | null
  kind:                  NotificationKind
  target_type:           string | null
  target_id:             string | null
  project_id:            string | null
  metadata:              Record<string, unknown>
  read_at:               string | null
  created_at:            string
  actor_display_name:    string | null
  actor_avatar_url:      string | null
  actor_grade:           string | null
  project_name:          string | null
  community_post_title:  string | null
  community_post_type:   string | null
}

const FEED_COLS =
  'id,recipient_id,actor_id,kind,target_type,target_id,project_id,metadata,read_at,created_at,' +
  'actor_display_name,actor_avatar_url,actor_grade,project_name,community_post_title,community_post_type'

/** Latest N notifications for the current user, newest first. */
export async function fetchNotifications(limit = 25): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notification_feed')
    .select(FEED_COLS)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.warn('fetchNotifications failed', error.message)
    return []
  }
  return (data ?? []) as unknown as NotificationRow[]
}

/** Unread count only · cheap enough to poll when Realtime isn't wired. */
export async function fetchUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) return 0
  return count ?? 0
}

/** Mark a single notification read. Noop if already read. */
export async function markRead(id: string): Promise<void> {
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
}

/** Mark every notification for the current user as read. */
export async function markAllRead(recipientId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', recipientId)
    .is('read_at', null)
}

/** Where clicking a notification should land. Returns null for no-op. */
export function destinationFor(n: NotificationRow): string | null {
  if (n.project_id) return `/projects/${n.project_id}`
  if (n.target_type === 'comment' && n.project_id) return `/projects/${n.project_id}#activity`
  if (n.community_post_type && n.target_id) {
    const segment =
      n.community_post_type === 'build_log'    ? 'build-logs'
      : n.community_post_type === 'stack'      ? 'stacks'
      : n.community_post_type === 'ask'        ? 'asks'
      : n.community_post_type === 'office_hours' ? 'office-hours'
      : null
    if (segment) return `/community/${segment}/${n.target_id}`
  }
  return null
}

/** Human-readable one-liner for a notification row. */
export function titleFor(n: NotificationRow): string {
  const actor = n.actor_display_name ?? 'Someone'
  if (n.kind === 'applaud') {
    if (n.target_type === 'product' && n.project_name) {
      return `${actor} applauded ${n.project_name}`
    }
    if (n.community_post_title) {
      return `${actor} applauded "${truncate(n.community_post_title, 40)}"`
    }
    if (n.target_type === 'comment') {
      return `${actor} applauded your comment`
    }
    return `${actor} applauded you`
  }
  if (n.kind === 'forecast') {
    const count = (n.metadata as { vote_count?: number } | null)?.vote_count
    const castLabel = count && count > 1 ? `${count} forecasts` : 'a forecast'
    return `${actor} cast ${castLabel} on ${n.project_name ?? 'your project'}`
  }
  if (n.kind === 'comment') {
    const meta = (n.metadata as { is_reply?: boolean; preview?: string } | null) ?? {}
    const isReply = !!meta.is_reply
    const preview = meta.preview ? `: "${truncate(meta.preview, 60)}"` : ''
    if (isReply) return `${actor} replied to your comment${preview}`
    return `${actor} commented on ${n.project_name ?? 'your project'}${preview}`
  }
  if (n.kind === 'reaudit') {
    const meta = (n.metadata as { score_total?: number; score_delta?: number; trigger_type?: string } | null) ?? {}
    const score = meta.score_total
    const delta = meta.score_delta
    const project = n.project_name ?? 'a project you support'
    if (typeof score === 'number' && typeof delta === 'number' && delta !== 0) {
      const sign = delta > 0 ? '+' : ''
      return `${project} just re-audited · ${score}/100 (${sign}${delta})`
    }
    if (typeof score === 'number') {
      return `${project} just re-audited · ${score}/100`
    }
    return `${project} just re-audited`
  }
  return `${actor} interacted with your content`
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/**
 * Realtime subscription · fires for every INSERT/UPDATE scoped to `recipientId`.
 * Caller re-fetches the feed on callback. Returns an unsubscribe fn.
 *
 * Channel name carries a per-instance random suffix so a hot-reload or
 * StrictMode double-mount can't reuse a half-torn-down channel and trip
 * Supabase's "cannot add postgres_changes callbacks after subscribe()" guard.
 */
export function subscribeNotifications(recipientId: string, onChange: () => void): () => void {
  const tag = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  const channel = supabase
    .channel(`notifications:${recipientId}:${tag}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${recipientId}` },
      () => onChange(),
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}
