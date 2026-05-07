// Tiny client-side feature flag fetcher · reads app_feature_flags
// once on mount, keeps the value in a module-level cache so concurrent
// callers (e.g. Nav + Admin settings) share the same fetch.

import { useEffect, useState } from 'react'
import { supabase } from './supabase'

type FlagsCache = Record<string, boolean | undefined>

let cache: FlagsCache | null = null
let inflight: Promise<FlagsCache> | null = null
const subscribers = new Set<(cache: FlagsCache) => void>()

async function loadAll(): Promise<FlagsCache> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    const { data, error } = await supabase
      .from('app_feature_flags')
      .select('key, enabled')
    const next: FlagsCache = {}
    if (!error && data) {
      for (const row of data as Array<{ key: string; enabled: boolean }>) {
        next[row.key] = row.enabled
      }
    }
    cache = next
    inflight = null
    subscribers.forEach(fn => fn(next))
    return next
  })()
  return inflight
}

/** Force a refresh · used after the admin toggles a flag so the local
 *  cache catches up without a page reload. */
export async function refreshFeatureFlags(): Promise<void> {
  cache = null
  await loadAll()
}

export function useFeatureFlag(key: string, fallback = false): boolean {
  const [value, setValue] = useState<boolean>(() => cache?.[key] ?? fallback)
  useEffect(() => {
    let alive = true
    loadAll().then(c => { if (alive) setValue(c[key] ?? fallback) })
    const sub = (c: FlagsCache) => { if (alive) setValue(c[key] ?? fallback) }
    subscribers.add(sub)
    return () => { alive = false; subscribers.delete(sub) }
  }, [key, fallback])
  return value
}
