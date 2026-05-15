// Creator Community data layer (§13-B).
// Thin helpers over community_posts / post_tags / office_hours_events.
//
// Posting conventions:
//   type     = 'build_log' | 'stack' | 'ask' | 'office_hours'
//   subtype  = stack:  'recipe' | 'prompt' | 'review'
//              ask:    'looking_for' | 'available' | 'feedback'
//              office_hours: 'ama' | 'toolmaker' | 'pair_building'

import { supabase } from './supabase'
import type { CommunityPost, CommunityPostType, OfficeHoursEvent } from './supabase'

export type { CommunityPost, CommunityPostType, OfficeHoursEvent }

// Tag vocabulary · §13-B.10 V1 Day 1 default set.
// Free text tags allowed but these are the well-known ones the UI surfaces first.
export const DEFAULT_TAGS = [
  'frontend', 'backend', 'ai-tool', 'saas',
  'agents',   'rag',     'design',  'devops',
] as const
export type DefaultTag = typeof DEFAULT_TAGS[number]

// Subtype labels used across the UI.
export const STACK_SUBTYPES = {
  recipe: 'Stack Recipe',
  prompt: 'Prompt Card',
  review: 'Tool Review',
} as const

export const ASK_SUBTYPES = {
  looking_for: 'Looking for',
  available:   'Available',
  feedback:    'Feedback wanted',
} as const

export const OFFICE_HOURS_FORMATS = {
  ama:            'Alumni AMA',
  toolmaker:      'Tool Maker Session',
  pair_building:  'Pair Building',
} as const

// ── Read path ───────────────────────────────────────────────

export interface PostWithAuthor extends CommunityPost {
  author?: { id: string; display_name: string | null; avatar_url: string | null; creator_grade: string | null } | null
}

export interface ListPostsOpts {
  type?:   CommunityPostType
  tag?:    string
  limit?:  number
  offset?: number
  authorId?: string
}

export async function listPosts(opts: ListPostsOpts = {}): Promise<PostWithAuthor[]> {
  const { type, tag, limit = 30, offset = 0, authorId } = opts
  let q = supabase
    .from('community_posts')
    .select(`
      id, author_id, type, subtype, title, tldr, body, tags,
      linked_project_id, status, published_at, created_at,
      author:members!community_posts_author_id_fkey(id, display_name, avatar_url, creator_grade)
    `)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (type)     q = q.eq('type', type)
  if (authorId) q = q.eq('author_id', authorId)
  if (tag)      q = q.contains('tags', [tag])

  const { data, error } = await q
  if (error) {
    console.error('[listPosts]', error)
    return []
  }
  // Supabase returns `author` as array when FK target isn't 1:1 typed · flatten to single object.
  return ((data ?? []) as unknown[]).map(row => {
    const r = row as CommunityPost & { author?: unknown }
    const author = Array.isArray(r.author) ? (r.author[0] ?? null) : (r.author ?? null)
    return { ...r, author } as PostWithAuthor
  })
}

export async function getPost(id: string): Promise<PostWithAuthor | null> {
  const { data, error } = await supabase
    .from('community_posts')
    .select(`
      id, author_id, type, subtype, title, tldr, body, tags,
      linked_project_id, status, published_at, created_at,
      author:members!community_posts_author_id_fkey(id, display_name, avatar_url, creator_grade)
    `)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  const r = data as CommunityPost & { author?: unknown }
  const author = Array.isArray(r.author) ? (r.author[0] ?? null) : (r.author ?? null)
  return { ...r, author } as PostWithAuthor
}

export async function countPostsByType(): Promise<Record<CommunityPostType, number>> {
  const { data } = await supabase
    .from('community_posts')
    .select('type, status')
    .eq('status', 'published')
  const tally: Record<CommunityPostType, number> = {
    build_log: 0, stack: 0, ask: 0, office_hours: 0, open_mic: 0,
  }
  ;(data ?? []).forEach((r: unknown) => {
    const t = (r as { type: CommunityPostType }).type
    if (t in tally) tally[t]++
  })
  return tally
}

// ── Write path ──────────────────────────────────────────────

export interface CreatePostInput {
  type:              CommunityPostType
  subtype?:          string | null
  title:             string
  tldr?:             string | null
  body?:             string | null
  tags?:             string[]
  linked_project_id?: string | null
  status?:           'draft' | 'published'
}

export async function createPost(input: CreatePostInput): Promise<{ id: string } | null> {
  // RLS insert policy on community_posts is `auth.uid() = author_id` ·
  // without explicit author_id the insert sends NULL, fails the WITH
  // CHECK, and surfaces to the user as "Publish failed". Stamp the
  // current member id here so the policy sees a match. Anonymous
  // sessions can't insert (no auth.uid), which matches design intent —
  // signed-in members only.
  // Read the current session FIRST so we get the JWT that Supabase will
  // actually send on the insert. After a signOut + signIn flip (account
  // swap test), the local cache can lag if the page didn't re-mount —
  // forcing getSession lets supabase-js refresh the token if needed
  // before getUser() validates against the server. Without this belt,
  // a user who just switched accounts can hit a window where author_id
  // = new uid but the JWT header is still the old session → RLS reject.
  const { data: { session } } = await supabase.auth.getSession()
  const { data: { user } }    = await supabase.auth.getUser()
  if (!user || !session) {
    console.error('[createPost] no auth session', { hasUser: !!user, hasSession: !!session })
    // Throw rather than return null so the page surfaces a specific
    // reason ("Sign in expired · refresh and try again") instead of
    // the catch-all "Publish failed" — that was the same blank wall
    // the original RLS bug produced and made the new failure mode
    // indistinguishable from the old one.
    throw new Error('Sign in expired · refresh the page and try again')
  }
  // Sanity assertion · the JWT's sub claim must match the user.id we're
  // about to stamp as author_id. If they don't, we're in the stale-token
  // race window — short-circuit with a clear message instead of letting
  // RLS reject with the generic policy-violation string.
  if (session.user.id !== user.id) {
    console.error('[createPost] session/user mismatch · refusing insert', {
      session_uid: session.user.id, user_uid: user.id,
    })
    throw new Error('Session is mid-switch · refresh the page and try again')
  }

  const { data, error } = await supabase
    .from('community_posts')
    .insert([{
      author_id:         user.id,
      type:              input.type,
      subtype:           input.subtype ?? null,
      title:             input.title,
      tldr:              input.tldr ?? null,
      body:              input.body ?? null,
      tags:              input.tags ?? [],
      linked_project_id: input.linked_project_id ?? null,
      status:            input.status ?? 'published',
    }])
    .select('id')
    .single()

  if (error || !data) {
    console.error('[createPost]', error)
    // Bubble the real Supabase error message instead of swallowing to
    // null · "Publish failed" with no detail was opaque and made every
    // failure indistinguishable (RLS · CHECK · network all looked the
    // same to the user). Page-level catch surfaces err.message.
    if (error) throw new Error(`Publish failed: ${error.message}`)
    return null
  }

  // Sync denormalized post_tags rows for tag-filter queries.
  if (input.tags && input.tags.length > 0) {
    const tagRows = input.tags.map(tag => ({ post_id: data.id, tag }))
    await supabase.from('post_tags').insert(tagRows)
  }

  return { id: data.id }
}

export async function updatePost(id: string, patch: Partial<CreatePostInput>): Promise<boolean> {
  const { error } = await supabase
    .from('community_posts')
    .update(patch)
    .eq('id', id)
  return !error
}

export async function deletePost(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('community_posts')
    .delete()
    .eq('id', id)
  return !error
}

// ── Post comments ───────────────────────────────────────────
//
// Open Mic / Build Logs / Stacks / Asks all support a comment thread on
// the detail page. Separate table from project `comments` so existing
// project-comment queries stay untouched (see migration
// 20260515_community_post_comments.sql for rationale).

export interface PostComment {
  id:        string
  post_id:   string
  author_id: string | null
  parent_id: string | null
  body:      string
  created_at: string
  updated_at: string
}

export interface PostCommentWithAuthor extends PostComment {
  author: {
    id:             string
    display_name:   string | null
    avatar_url:     string | null
    creator_grade?: string | null
  } | null
}

export async function listPostComments(postId: string): Promise<PostCommentWithAuthor[]> {
  const { data, error } = await supabase
    .from('community_post_comments')
    .select(`
      id, post_id, author_id, parent_id, body, created_at, updated_at,
      author:members!community_post_comments_author_id_fkey(id, display_name, avatar_url, creator_grade)
    `)
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[listPostComments]', error)
    return []
  }
  return ((data ?? []) as unknown[]).map(row => {
    const r = row as PostComment & { author?: unknown }
    const author = Array.isArray(r.author) ? (r.author[0] ?? null) : (r.author ?? null)
    return { ...r, author } as PostCommentWithAuthor
  })
}

export async function createPostComment(input: {
  post_id:   string
  body:      string
  parent_id?: string | null
}): Promise<{ id: string } | null> {
  // Same author_id-stamping defense as createPost · RLS WITH CHECK
  // requires `auth.uid() = author_id`; without the explicit stamp the
  // insert sends NULL and fails opaquely.
  const { data: { session } } = await supabase.auth.getSession()
  const { data: { user } }    = await supabase.auth.getUser()
  if (!user || !session) {
    throw new Error('Sign in expired · refresh the page and try again')
  }
  if (session.user.id !== user.id) {
    throw new Error('Session is mid-switch · refresh the page and try again')
  }

  const trimmed = input.body.trim()
  if (trimmed.length === 0) {
    throw new Error('Comment is empty')
  }

  const { data, error } = await supabase
    .from('community_post_comments')
    .insert([{
      post_id:   input.post_id,
      author_id: user.id,
      parent_id: input.parent_id ?? null,
      body:      trimmed,
    }])
    .select('id')
    .single()

  if (error || !data) {
    console.error('[createPostComment]', error)
    if (error) throw new Error(`Comment failed: ${error.message}`)
    return null
  }
  return { id: data.id }
}

export async function updatePostComment(id: string, body: string): Promise<boolean> {
  const trimmed = body.trim()
  if (trimmed.length === 0) return false
  const { error } = await supabase
    .from('community_post_comments')
    .update({ body: trimmed })
    .eq('id', id)
  if (error) console.error('[updatePostComment]', error)
  return !error
}

export async function deletePostComment(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('community_post_comments')
    .delete()
    .eq('id', id)
  if (error) console.error('[deletePostComment]', error)
  return !error
}

// ── Bulk counts · for list rows ─────────────────────────────
//
// fetchPostCommentCounts(postIds) → { [post_id]: count }
//   single query into community_post_comments · group client-side ·
//   keeps cost O(1) request even for big post lists.
//
// fetchPostApplaudCounts(post_id+type pairs) → { [post_id]: count }
//   applauds is polymorphic so we have to filter by BOTH target_id and
//   target_type pairs. PostgREST `or=` supports the compound filter.

export async function fetchPostCommentCounts(postIds: string[]): Promise<Record<string, number>> {
  const ids = Array.from(new Set(postIds.filter(Boolean)))
  if (ids.length === 0) return {}
  const { data } = await supabase
    .from('community_post_comments')
    .select('post_id')
    .in('post_id', ids)
  const out: Record<string, number> = {}
  ;(data ?? []).forEach(r => {
    const pid = (r as { post_id: string }).post_id
    out[pid] = (out[pid] ?? 0) + 1
  })
  return out
}

const POST_TYPE_TO_APPLAUD_TARGET: Record<CommunityPostType, string> = {
  build_log:    'build_log',
  stack:        'stack',
  ask:          'ask',
  office_hours: 'office_hours',
  open_mic:     'open_mic',
}

export async function fetchPostApplaudCounts(
  posts: Array<{ id: string; type: CommunityPostType }>,
): Promise<Record<string, number>> {
  if (posts.length === 0) return {}
  // Group target_ids by their matching applaud target_type so each
  // request stays scoped (RLS + index uses target_type, target_id).
  const byType = new Map<string, string[]>()
  for (const p of posts) {
    const t = POST_TYPE_TO_APPLAUD_TARGET[p.type]
    if (!t) continue
    const arr = byType.get(t) ?? []
    arr.push(p.id)
    byType.set(t, arr)
  }
  const out: Record<string, number> = {}
  await Promise.all([...byType.entries()].map(async ([targetType, ids]) => {
    const { data } = await supabase
      .from('applauds')
      .select('target_id')
      .eq('target_type', targetType)
      .in('target_id', ids)
    ;(data ?? []).forEach(r => {
      const pid = (r as { target_id: string }).target_id
      out[pid] = (out[pid] ?? 0) + 1
    })
  }))
  return out
}

export async function fetchPostCommentApplaudCounts(commentIds: string[]): Promise<Record<string, number>> {
  const ids = Array.from(new Set(commentIds.filter(Boolean)))
  if (ids.length === 0) return {}
  const { data } = await supabase
    .from('applauds')
    .select('target_id')
    .eq('target_type', 'post_comment')
    .in('target_id', ids)
  const out: Record<string, number> = {}
  ;(data ?? []).forEach(r => {
    const pid = (r as { target_id: string }).target_id
    out[pid] = (out[pid] ?? 0) + 1
  })
  return out
}

// ── Office hours ────────────────────────────────────────────

export async function listUpcomingOfficeHours(limit = 10): Promise<OfficeHoursEvent[]> {
  const { data } = await supabase
    .from('office_hours_events')
    .select('*')
    .gte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit)
  return (data ?? []) as OfficeHoursEvent[]
}

export async function listPastOfficeHours(limit = 10): Promise<OfficeHoursEvent[]> {
  const { data } = await supabase
    .from('office_hours_events')
    .select('*')
    .lt('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as OfficeHoursEvent[]
}
