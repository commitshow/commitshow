import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Nav } from './components/Nav'
import { ScrollToTop } from './components/ScrollToTop'
import { LandingPage } from './pages/LandingPage'  // eager — first paint target
import './index.css'

// Route-level code splitting. LandingPage stays eager because it's the
// LCP target; everything else loads on demand so the initial bundle
// doesn't drag all 16 pages on first visit.
const ProjectsPage            = lazy(() => import('./pages/ProjectsPage').then(m => ({ default: m.ProjectsPage })))
const ProjectDetailPage       = lazy(() => import('./pages/ProjectDetailPage').then(m => ({ default: m.ProjectDetailPage })))
const SubmitPage              = lazy(() => import('./pages/SubmitPage').then(m => ({ default: m.SubmitPage })))
const ProfilePage             = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })))
const LibraryPage             = lazy(() => import('./pages/LibraryPage').then(m => ({ default: m.LibraryPage })))
const LibraryDetailPage       = lazy(() => import('./pages/LibraryDetailPage').then(m => ({ default: m.LibraryDetailPage })))
const ScoutsPage              = lazy(() => import('./pages/ScoutsPage').then(m => ({ default: m.ScoutsPage })))
const RulebookPage            = lazy(() => import('./pages/RulebookPage').then(m => ({ default: m.RulebookPage })))
const BuildLogsPage           = lazy(() => import('./pages/BuildLogsPage').then(m => ({ default: m.BuildLogsPage })))
const StacksPage              = lazy(() => import('./pages/StacksPage').then(m => ({ default: m.StacksPage })))
const AsksPage                = lazy(() => import('./pages/AsksPage').then(m => ({ default: m.AsksPage })))
const OfficeHoursPage         = lazy(() => import('./pages/OfficeHoursPage').then(m => ({ default: m.OfficeHoursPage })))
const NewCommunityPostPage    = lazy(() => import('./pages/NewCommunityPostPage').then(m => ({ default: m.NewCommunityPostPage })))
const CommunityPostDetailPage = lazy(() => import('./pages/CommunityPostDetailPage').then(m => ({ default: m.CommunityPostDetailPage })))
const LeaderboardPage         = lazy(() => import('./pages/LeaderboardPage').then(m => ({ default: m.LeaderboardPage })))

// Suspense fallback — faint monospace ping that stays out of the way while
// a chunk downloads. No spinner · matches the Ivy League restraint.
function RouteFallback() {
  return (
    <div className="pt-32 pb-20 px-6 text-center font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
      loading …
    </div>
  )
}

export default function App() {
  return (
    <div className="relative min-h-screen">
      <ScrollToTop />
      <Nav />

      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/"                 element={<LandingPage />} />
          <Route path="/projects"         element={<ProjectsPage />} />
          <Route path="/projects/:id"     element={<ProjectDetailPage />} />
          <Route path="/submit"           element={<SubmitPage />} />
          <Route path="/me"               element={<ProfilePage />} />
          <Route path="/library"          element={<LibraryPage />} />
          <Route path="/library/:id"      element={<LibraryDetailPage />} />
          <Route path="/scouts"           element={<ScoutsPage />} />
          <Route path="/leaderboard"      element={<LeaderboardPage />} />
          <Route path="/rulebook"         element={<RulebookPage />} />

          {/* Creator Community (§13-B) */}
          <Route path="/community"                     element={<Navigate to="/community/build-logs" replace />} />
          <Route path="/community/build-logs"          element={<BuildLogsPage />} />
          <Route path="/community/stacks"              element={<StacksPage />} />
          <Route path="/community/asks"                element={<AsksPage />} />
          <Route path="/community/office-hours"        element={<OfficeHoursPage />} />
          {/* `typeSegment` is read by the editor to pick build_log / stack / ask */}
          <Route path="/community/:typeSegment/new"    element={<NewCommunityPostPage />} />
          <Route path="/community/:typeSegment/:id"    element={<CommunityPostDetailPage />} />
          <Route path="*"                 element={<LandingPage />} />
        </Routes>
      </Suspense>

      <footer className="relative z-10 py-10 px-6 text-center" style={{ borderTop: '1px solid rgba(240,192,64,0.08)' }}>
        <div className="font-display font-bold text-lg mb-2" style={{ color: 'var(--gold-500)' }}>
          commit<span style={{ color: 'rgba(248,245,238,0.4)' }}>.show</span>
        </div>
        <div className="flex items-center justify-center gap-4 mb-3 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
          <a href="/projects"  style={{ color: 'inherit', textDecoration: 'none' }}>Projects</a>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
          <a href="/community" style={{ color: 'inherit', textDecoration: 'none' }}>Community</a>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
          <a href="/library"   style={{ color: 'inherit', textDecoration: 'none' }}>Library</a>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
          <a href="/scouts"    style={{ color: 'inherit', textDecoration: 'none' }}>Scouts</a>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
          <a href="/rulebook"  style={{ color: 'inherit', textDecoration: 'none' }}>Rulebook</a>
        </div>
        <p className="font-mono text-[11px]" style={{ color: 'var(--text-faint)' }}>
          Vibe Coding League · Season Zero · US Launch 2026 · All scores algorithmically determined
        </p>
      </footer>
    </div>
  )
}
