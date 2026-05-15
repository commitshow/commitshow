// useViewer — current viewer's identity + permission flags · §1-A ⑥
// shame-mitigation gate · 2026-05-15.
//
// Surfaces a single hook for "what can this viewer see?". Today it carries
// member_id + is_admin + paid_patron (always false until the V1.5+ paid
// Scout SKU lands). Components that gate digit-vs-band display call this
// once and feed the result to `viewerCanSeeDigit(project, viewer)`.
//
// 2026-05-15b · flicker fix · the prior version made its own async
// getUser() call which caused a creator viewing their own project list
// to render band first, then flip to digit on resolve. We now read from
// the AuthProvider context which already has the session loaded
// synchronously from Supabase's local-storage cache — so on FIRST paint
// we already know whether the viewer is the creator. The member row's
// is_admin flag still loads async (rare admin case), but the common
// "creator on their own list" case is now zero-flicker.

import { useAuth } from './auth'
import type { ViewerScope } from './laneScore'

export interface ViewerState extends ViewerScope {
  loading:   boolean    // true only during the initial session restore (sub-100ms typically)
  signed_in: boolean
}

export function useViewer(): ViewerState {
  const { user, member, loading } = useAuth()
  return {
    loading,
    signed_in:   !!user,
    member_id:   user?.id ?? null,
    is_admin:    member?.is_admin === true,
    // Paid Patron tier hasn't shipped yet · placeholder false.
    // When the SKU lands, swap to `member?.scout_paid_tier === 'patron'`.
    paid_patron: false,
  }
}
