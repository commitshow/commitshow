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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    console.error('[createPost] no auth session')
    return null
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
