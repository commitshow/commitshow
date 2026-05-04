import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Nav } from './components/Nav'
import { ScrollToTop } from './components/ScrollToTop'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LandingPage } from './pages/LandingPage'  // eager — first paint target
import './index.css'

// Route-level code splitting. LandingPage stays eager because it's the
// LCP target; everything else loads on demand so the initial bundle
// doesn't drag all 16 pages on first visit.
// ProjectsPage merged into LadderPage · /projects route now redirects.
const ProjectDetailPage       = lazy(() => import('./pages/ProjectDetailPage').then(m => ({ default: m.ProjectDetailPage })))
const SubmitPage              = lazy(() => import('./pages/SubmitPage').then(m => ({ default: m.SubmitPage })))
const ProfilePage             = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })))
const LibraryPage             = lazy(() => import('./pages/LibraryPage').then(m => ({ default: m.LibraryPage })))
const LibraryDetailPage       = lazy(() => import('./pages/LibraryDetailPage').then(m => ({ default: m.LibraryDetailPage })))
const ScoutsPage              = lazy(() => import('./pages/ScoutsPage').then(m => ({ default: m.ScoutsPage })))
const RulebookPage            = lazy(() => import('./pages/RulebookPage').then(m => ({ default: m.RulebookPage })))
const TermsPage               = lazy(() => import('./pages/TermsPage').then(m => ({ default: m.TermsPage })))
const PrivacyPage             = lazy(() => import('./pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })))
const BackstagePage           = lazy(() => import('./pages/BackstagePage').then(m => ({ default: m.BackstagePage })))
const AuditPage               = lazy(() => import('./pages/AuditPage').then(m => ({ default: m.AuditPage })))
const AdminPage               = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })))
const CmoPreviewPage          = lazy(() => import('./pages/CmoPreviewPage').then(m => ({ default: m.CmoPreviewPage })))
const CliLinkPage             = lazy(() => import('./pages/CliLinkPage').then(m => ({ default: m.CliLinkPage })))
const BuildLogsPage           = lazy(() => import('./pages/BuildLogsPage').then(m => ({ default: m.BuildLogsPage })))
const StacksPage              = lazy(() => import('./pages/StacksPage').then(m => ({ default: m.StacksPage })))
const AsksPage                = lazy(() => import('./pages/AsksPage').then(m => ({ default: m.AsksPage })))
const OfficeHoursPage         = lazy(() => import('./pages/OfficeHoursPage').then(m => ({ default: m.OfficeHoursPage })))
const NewCommunityPostPage    = lazy(() => import('./pages/NewCommunityPostPage').then(m => ({ default: m.NewCommunityPostPage })))
const CommunityPostDetailPage = lazy(() => import('./pages/CommunityPostDetailPage').then(m => ({ default: m.CommunityPostDetailPage })))
const LeaderboardPage         = lazy(() => import('./pages/LeaderboardPage').then(m => ({ default: m.LeaderboardPage })))
const LadderPage              = lazy(() => import('./pages/LadderPage').then(m => ({ default: m.LadderPage })))
const SearchPage              = lazy(() => import('./pages/SearchPage').then(m => ({ default: m.SearchPage })))
const AdminEmailsPage         = lazy(() => import('./pages/AdminEmailsPage').then(m => ({ default: m.AdminEmailsPage })))

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

      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
          <Route path="/"                 element={<LandingPage />} />
          {/* /projects merged into /ladder (2026-04-30 · single-surface decision).
              Card view lives at /ladder?view=cards. Direct project URLs unchanged. */}
          <Route path="/projects"         element={<Navigate to="/ladder?view=cards" replace />} />
          <Route path="/projects/:id"     element={<ProjectDetailPage />} />
          <Route path="/submit"           element={<SubmitPage />} />
          <Route path="/me"               element={<ProfilePage />} />
          <Route path="/library"          element={<LibraryPage />} />
          <Route path="/library/:id"      element={<LibraryDetailPage />} />
          <Route path="/scouts"           element={<ScoutsPage />} />
          <Route path="/leaderboard"      element={<LeaderboardPage />} />
          {/* /products is canonical (2026-05-05 rebrand · was /ladder).
              Old /ladder URL preserved as redirect for links in the
              wild · keeps tweets, blog posts, AI agent memory working. */}
          <Route path="/products"         element={<LadderPage />} />
          <Route path="/ladder"           element={<Navigate to="/products" replace />} />
          <Route path="/search"           element={<SearchPage />} />
          <Route path="/rulebook"         element={<RulebookPage />} />
          <Route path="/terms"            element={<TermsPage />} />
          <Route path="/privacy"          element={<PrivacyPage />} />
          <Route path="/backstage"        element={<BackstagePage />} />
          <Route path="/audit"            element={<AuditPage />} />
          <Route path="/admin"            element={<AdminPage />} />
          <Route path="/admin/cmo"        element={<CmoPreviewPage />} />
          <Route path="/admin/emails"     element={<AdminEmailsPage />} />
          <Route path="/cli/link"         element={<CliLinkPage />} />

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
      </ErrorBoundary>

      <footer className="relative z-10 py-10 px-6 text-center" style={{ borderTop: '1px solid rgba(240,192,64,0.08)' }}>
        <div className="font-display font-bold text-lg mb-2" style={{ color: 'var(--gold-500)' }}>
          commit<span style={{ color: 'rgba(248,245,238,0.4)' }}>.show</span>
        </div>
        <div className="flex items-center justify-center gap-4 mb-3 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
          <a href="/ladder"    style={{ color: 'inherit', textDecoration: 'none' }}>Ladder</a>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
          <a href="/community" style={{ color: 'inherit', textDecoration: 'none' }}>Community</a>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
          <a href="/library"   style={{ color: 'inherit', textDecoration: 'none' }}>Library</a>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
          <a href="/scouts"    style={{ color: 'inherit', textDecoration: 'none' }}>Scouts</a>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
          <a href="/backstage" style={{ color: 'inherit', textDecoration: 'none' }}>Backstage</a>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
          <a href="/rulebook"  style={{ color: 'inherit', textDecoration: 'none' }}>Rulebook</a>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
          <a href="/terms"     style={{ color: 'inherit', textDecoration: 'none' }}>Terms</a>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
          <a href="/privacy"   style={{ color: 'inherit', textDecoration: 'none' }}>Privacy</a>
        </div>
        <p className="font-mono text-[11px]" style={{ color: 'var(--text-faint)' }}>
          Vibe Coding Ladder · US Launch 2026 · All scores algorithmically determined
        </p>
      </footer>
    </div>
  )
}
