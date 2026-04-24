import { Routes, Route } from 'react-router-dom'
import { Nav } from './components/Nav'
import { ScrollToTop } from './components/ScrollToTop'
import { LandingPage } from './pages/LandingPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { SubmitPage } from './pages/SubmitPage'
import { ProfilePage } from './pages/ProfilePage'
import { LibraryPage } from './pages/LibraryPage'
import { LibraryDetailPage } from './pages/LibraryDetailPage'
import { ScoutsPage } from './pages/ScoutsPage'
import { RulebookPage } from './pages/RulebookPage'
import { BuildLogsPage } from './pages/BuildLogsPage'
import { StacksPage } from './pages/StacksPage'
import { AsksPage } from './pages/AsksPage'
import { OfficeHoursPage } from './pages/OfficeHoursPage'
import { NewCommunityPostPage } from './pages/NewCommunityPostPage'
import { CommunityPostDetailPage } from './pages/CommunityPostDetailPage'
import { Navigate } from 'react-router-dom'
import './index.css'

export default function App() {
  return (
    <div className="relative min-h-screen">
      <ScrollToTop />
      <Nav />

      <Routes>
        <Route path="/"                 element={<LandingPage />} />
        <Route path="/projects"         element={<ProjectsPage />} />
        <Route path="/projects/:id"     element={<ProjectDetailPage />} />
        <Route path="/submit"           element={<SubmitPage />} />
        <Route path="/me"               element={<ProfilePage />} />
        <Route path="/library"          element={<LibraryPage />} />
        <Route path="/library/:id"      element={<LibraryDetailPage />} />
        <Route path="/scouts"           element={<ScoutsPage />} />
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
