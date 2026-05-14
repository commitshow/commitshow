// useViewer — current viewer's identity + permission flags · §1-A ⑥
// shame-mitigation gate · 2026-05-15.
//
// Surfaces a single hook for "what can this viewer see?". Today it carries
// member_id + is_admin + paid_patron (always false until the V1.5+ paid
// Scout SKU lands). Components that gate digit-vs-band display call this
// once and feed the result to `viewerCanSeeDigit(project, viewer)`.
//
// Subscribes to supabase.auth.onAuthStateChange so sign-in / sign-out
// updates propagate without forcing a page reload. Returns `loading: true`
// during the initial session+row fetch so consumers can defer rendering
// digit-vs-band until the answer is stable (otherwise creator-on-own-page
// would briefly see band, then flip to digit — jarring).

import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { ViewerScope } from './laneScore'

export interface ViewerState extends ViewerScope {
  loading: boolean
  signed_in: boolean
}

const INITIAL: ViewerState = {
  loading:     true,
  signed_in:   false,
  member_id:   null,
  is_admin:    false,
  paid_patron: false,
}

export function useViewer(): ViewerState {
  const [state, setState] = useState<ViewerState>(INITIAL)

  useEffect(() => {
    let alive = true
    async function resolve() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!alive) return
      if (!user) {
        setState({ loading: false, signed_in: false, member_id: null, is_admin: false, paid_patron: false })
        return
      }
      // Pull just the gate-relevant columns · cheap one-row read.
      const { data: row } = await supabase
        .from('members')
        .select('id, is_admin')
        .eq('id', user.id)
        .maybeSingle()
      if (!alive) return
      setState({
        loading:     false,
        signed_in:   true,
        member_id:   row?.id ?? user.id,
        is_admin:    row?.is_admin === true,
        // Paid Patron tier hasn't shipped yet · placeholder false.
        // When the SKU lands, swap to `row?.scout_paid_tier === 'patron'`.
        paid_patron: false,
      })
    }
    resolve()
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!alive) return
      if (!session?.user) {
        setState({ loading: false, signed_in: false, member_id: null, is_admin: false, paid_patron: false })
        return
      }
      // Re-fetch on auth change · permissions may have changed.
      resolve()
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  return state
}
