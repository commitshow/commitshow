// useCommunityListEnriched — list-page helper that pulls comment +
// applaud counts for a freshly-fetched community post list · 2026-05-15.
//
// Reduces the boilerplate that every list page (BuildLogs · Stacks ·
// Asks · Office Hours · Open Mic) would otherwise repeat: take a list
// of posts, kick off two parallel bulk-count fetches, and surface the
// `{ [post_id]: count }` maps the card needs to render counts.
//
// Pattern:
//   const [posts, setPosts] = useState<PostWithAuthor[] | null>(null)
//   useEffect(() => { listPosts(...).then(setPosts) }, [...deps])
//   const { commentCounts, applaudCounts } = useCommunityListEnriched(posts)
//   ...
//   <CommunityPostCard post={p}
//     commentCount={commentCounts[p.id]}
//     applaudCount={applaudCounts[p.id]} />
//
// Counts refresh whenever the post list identity changes (new fetch).
// We deliberately don't invalidate on every server tick — counts on a
// list page are eventual-consistent · the detail page is the
// authoritative surface.

import { useEffect, useState } from 'react'
import type { PostWithAuthor } from './community'
import { fetchPostCommentCounts, fetchPostApplaudCounts } from './community'

interface Enrichment {
  commentCounts: Record<string, number>
  applaudCounts: Record<string, number>
  loaded:        boolean
}

const EMPTY: Enrichment = { commentCounts: {}, applaudCounts: {}, loaded: false }

export function useCommunityListEnriched(posts: PostWithAuthor[] | null): Enrichment {
  const [state, setState] = useState<Enrichment>(EMPTY)

  useEffect(() => {
    if (!posts || posts.length === 0) {
      setState(EMPTY)
      return
    }
    let alive = true
    const postIds   = posts.map(p => p.id)
    const postPairs = posts.map(p => ({ id: p.id, type: p.type }))
    Promise.all([
      fetchPostCommentCounts(postIds),
      fetchPostApplaudCounts(postPairs),
    ]).then(([commentCounts, applaudCounts]) => {
      if (!alive) return
      setState({ commentCounts, applaudCounts, loaded: true })
    })
    return () => { alive = false }
  }, [posts])

  return state
}
