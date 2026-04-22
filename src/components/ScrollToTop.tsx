import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Resets scroll position to the top on every pathname change. Browsers preserve
 * scroll across SPA route transitions by default, which makes entering a
 * Project detail from mid-list feel jumpy. Mount once near the top of the app.
 */
export function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    // `instant` avoids smooth-scroll on every navigation which feels sluggish.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])
  return null
}
