import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import App from './App.tsx'
import { AuthProvider } from './lib/auth'
import './index.css'

// Sentry · only initializes when VITE_SENTRY_DSN is set, so local dev /
// preview builds without the env var stay silent. The SDK stays in the
// bundle either way so a deploy that adds the env var works with no
// code change — Sentry.init is a no-op without a DSN.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // 10% trace sample in prod, 100% in dev. Errors are always captured.
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
