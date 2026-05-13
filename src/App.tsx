import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Nav } from './components/Nav'
import { ScrollToTop } from './components/ScrollToTop'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TicketGiftCelebration } from './components/TicketGiftCelebration'
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
const OpenMicPage             = lazy(() => import('./pages/OpenMicPage').then(m => ({ default: m.OpenMicPage })))
const NewCommunityPostPage    = lazy(() => import('./pages/NewCommunityPostPage').then(m => ({ default: m.NewCommunityPostPage })))
const CommunityPostDetailPage = lazy(() => import('./pages/CommunityPostDetailPage').then(m => ({ default: m.CommunityPostDetailPage })))
const LeaderboardPage         = lazy(() => import('./pages/LeaderboardPage').then(m => ({ default: m.LeaderboardPage })))
const LadderPage              = lazy(() => import('./pages/LadderPage').then(m => ({ default: m.LadderPage })))
const SearchPage              = lazy(() => import('./pages/SearchPage').then(m => ({ default: m.SearchPage })))
const AdminEmailsPage         = lazy(() => import('./pages/AdminEmailsPage').then(m => ({ default: m.AdminEmailsPage })))
const ScoutDetailPage         = lazy(() => import('./pages/ScoutDetailPage').then(m => ({ default: m.ScoutDetailPage })))
const CreatorsPage            = lazy(() => import('./pages/CreatorsPage').then(m => ({ default: m.CreatorsPage })))
const CreatorDetailPage       = lazy(() => import('./pages/CreatorDetailPage').then(m => ({ default: m.CreatorDetailPage })))
const CommunityFeedPage       = lazy(() => import('./pages/CommunityFeedPage').then(m => ({ default: m.CommunityFeedPage })))
const ProjectSlugRedirect     = lazy(() => import('./pages/ProjectSlugRedirect').then(m => ({ default: m.ProjectSlugRedirect })))
const NotFoundPage            = lazy(() => import('./pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })))
const MyProductsPage          = lazy(() => import('./pages/MyProductsPage').then(m => ({ default: m.MyProductsPage })))
const TokenLeaderboardPage    = lazy(() => import('./pages/TokenLeaderboardPage').then(m => ({ default: m.TokenLeaderboardPage })))
const PitchPage               = lazy(() => import('./pages/PitchPage').then(m => ({ default: m.PitchPage })))
const PitchKPage              = lazy(() => import('./pages/PitchKPage').then(m => ({ default: m.PitchKPage })))

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
    // 2026-05-05 · primary nav moved to a 200px left sidebar on md+.
    // md:pl-[200px] reserves the space without changing any page-level
    // padding (sections still set their own px-4/px-6 etc.).
    <div className="relative min-h-screen md:pl-[200px]">
      <ScrollToTop />
      <Nav />
      {/* Center-screen celebration · fires when the recipient logs in
          (or is already online) and has an unread 'ticket_gift'
          notification. No-op for everyone else. */}
      <TicketGiftCelebration />

      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
          <Route path="/"                 element={<LandingPage />} />
          {/* /projects merged into /ladder (2026-04-30 · single-surface decision).
              Card view lives at /ladder?view=cards. Direct project URLs unchanged. */}
          <Route path="/projects"         element={<Navigate to="/ladder?view=cards" replace />} />
          <Route path="/projects/:id"     element={<ProjectDetailPage />} />
          {/* Slug-friendly URL · 2026-05-05 · resolves to canonical
              /projects/:id. Used by user-share templates so tweet
              cards display "/project/<name>" instead of a uuid. */}
          <Route path="/project/:slug"    element={<ProjectSlugRedirect />} />
          <Route path="/submit"           element={<SubmitPage />} />
          <Route path="/me"               element={<ProfilePage />} />
          <Route path="/me/products"      element={<MyProductsPage />} />
          <Route path="/library"          element={<LibraryPage />} />
          <Route path="/library/:id"      element={<LibraryDetailPage />} />
          <Route path="/scouts"           element={<ScoutsPage />} />
          {/* Canonical · /map = Products' 2D Audit×Scout scatter sub-view ·
              /tokens = the primary token leaderboard surface. Old
              /leaderboard URLs kept as in-app redirects for any cached
              links · Pages _redirects also serves 301 for SEO. */}
          <Route path="/map"                element={<LeaderboardPage />} />
          <Route path="/tokens"             element={<TokenLeaderboardPage />} />
          <Route path="/leaderboard"        element={<Navigate to="/map" replace />} />
          <Route path="/leaderboard/tokens" element={<Navigate to="/tokens" replace />} />
          {/* /products is canonical (2026-05-05 rebrand · was /ladder).
              Old /ladder URL preserved as redirect for links in the
              wild · keeps tweets, blog posts, AI agent memory working. */}
          <Route path="/products"         element={<LadderPage />} />
          <Route path="/ladder"           element={<Navigate to="/products" replace />} />
          <Route path="/search"           element={<SearchPage />} />
          {/* Member-detail page · same component for both /scouts/:id and
              /creators/:id since the data is one member's activity
              (forecasts, applauds, builds). The two list surfaces
              (/scouts, /creators) are the only thing that differs. */}
          <Route path="/scouts/:id"       element={<ScoutDetailPage />} />
          <Route path="/creators"         element={<CreatorsPage />} />
          <Route path="/creators/:id"     element={<CreatorDetailPage />} />
          <Route path="/rulebook"         element={<RulebookPage />} />
          <Route path="/terms"            element={<TermsPage />} />
          <Route path="/privacy"          element={<PrivacyPage />} />
          <Route path="/backstage"        element={<BackstagePage />} />
          <Route path="/audit"            element={<AuditPage />} />
          <Route path="/pitch"            element={<PitchPage />} />
          <Route path="/pitch-k"          element={<PitchKPage />} />
          <Route path="/admin"            element={<AdminPage />} />
          <Route path="/admin/cmo"        element={<CmoPreviewPage />} />
          <Route path="/admin/emails"     element={<AdminEmailsPage />} />
          <Route path="/cli/link"         element={<CliLinkPage />} />

          {/* Creator Community (§13-B) */}
          {/* /community lands on the unified feed (cold-start fix · 2026-05-05).
              Was: redirect to /community/build-logs which displayed an
              empty bucket on first visit. The feed aggregates posts AND
              project comments so the page feels alive even when posts
              are sparse. Category sub-pages still work directly. */}
          <Route path="/community"                     element={<CommunityFeedPage />} />
          <Route path="/community/open-mic"            element={<OpenMicPage />} />
          <Route path="/community/build-logs"          element={<BuildLogsPage />} />
          <Route path="/community/stacks"              element={<StacksPage />} />
          <Route path="/community/asks"                element={<AsksPage />} />
          <Route path="/community/office-hours"        element={<OfficeHoursPage />} />
          {/* `typeSegment` is read by the editor to pick build_log / stack / ask */}
          <Route path="/community/:typeSegment/new"    element={<NewCommunityPostPage />} />
          <Route path="/community/:typeSegment/:id"    element={<CommunityPostDetailPage />} />
          {/* Real 404 catch-all · was rendering LandingPage which made
              Google's crawler flag every unknown URL as a Soft 404 (200
              status with content reading like "wrong page"). NotFoundPage
              injects <meta name="robots" content="noindex"> so the bot
              recognizes this as a non-canonical surrogate. */}
          <Route path="*"                 element={<NotFoundPage />} />
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
