# OAuth Provider Setup (P7)

commit.show authenticates through Supabase Auth using four OAuth providers plus email/password. The app code (AuthModal, `signInWithOAuth`, `VerifiedIdentities`) is fully wired — what's left is one-time dashboard configuration for each provider.

Redirect URL (used by every provider):
```
https://tekemubwihsjdzittoqf.supabase.co/auth/v1/callback
```

After linking a provider, set also the **Site URL** and **Additional Redirect URLs** in Supabase:

- Supabase Dashboard → Authentication → URL Configuration
  - **Site URL**: `https://commit.show`
  - **Additional Redirect URLs**: `https://commit.show`, `http://localhost:5173`, `https://vibe.hans1329.workers.dev`

---

## 1. Google

1. Google Cloud Console → **APIs & Services → OAuth consent screen**
   - User Type: External · App name: `commit.show`
   - Support email: your address · Developer contact: your address
   - Scopes: add `openid`, `email`, `profile`
2. **Credentials → Create OAuth Client ID**
   - Application type: Web application
   - Authorized redirect URIs: paste the callback URL above
3. Copy **Client ID** and **Client Secret**
4. Supabase Dashboard → **Authentication → Providers → Google** → Enable → paste both

Testing: Sign in with Google button on commit.show. After login, the user's
`user.identities` array will contain `{ provider: 'google' }`.

---

## 2. GitHub

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   - Application name: `commit.show`
   - Homepage URL: `https://commit.show`
   - Authorization callback URL: the callback URL above
2. Click **Register**, then **Generate a new client secret**
3. Supabase Dashboard → **Authentication → Providers → GitHub** → Enable
   - Client ID / Client Secret: paste
   - **Scopes**: `public_repo` (required for Apply-to-my-repo in §15.5)

Testing: Sign in with GitHub. `user.identities` includes `{ provider: 'github' }`.
The provider_token is needed for repo listing — check `getGithubToken()` in
`src/lib/github.ts`.

---

## 3. X (Twitter)

1. X Developer Portal → **Projects & Apps → Create App** (or reuse existing)
2. Under **User authentication settings**:
   - Enable **OAuth 2.0**
   - Type of App: **Web App**
   - Callback URI: the Supabase callback URL above
   - Website URL: `https://commit.show`
3. Save. Copy **Client ID** and **Client Secret** (shown once — store safely)
4. Supabase Dashboard → **Authentication → Providers → Twitter** → Enable → paste both
   - Note: Supabase calls the provider `twitter` even though it's now X

Testing: Sign in with X button. `user.identities` includes `{ provider: 'twitter' }`.
This is the §18.2 "Verified by X" signal.

---

## 4. LinkedIn (optional, V1.5+ recruiting)

1. LinkedIn → **https://www.linkedin.com/developers/apps → Create app**
   - App name: `commit.show` · LinkedIn Page: your company page
   - Logo: upload brand mark
2. Under **Auth** tab:
   - Authorized redirect URLs: paste the Supabase callback URL
3. Under **Products** tab:
   - Request access to **Sign In with LinkedIn using OpenID Connect**
4. Copy **Client ID** and **Client Secret**
5. Supabase Dashboard → **Authentication → Providers → LinkedIn (OIDC)** → Enable

Testing: Sign in with LinkedIn. `user.identities` includes `{ provider: 'linkedin_oidc' }`.

---

## What the app does after linking

- `AuthModal` (`src/components/AuthModal.tsx`) calls `signInWithOAuth(provider)` for
  sign-in — this creates the auth session and, for new users, runs the
  `handle_new_user()` trigger to insert a `members` row and backfill
  `display_name` from the email prefix (see migration `20260425130000_display_name_privacy.sql`).
- `VerifiedIdentities` (`src/components/VerifiedIdentities.tsx`) reads
  `user.identities` on the profile page and renders "Verified by X / GitHub / LinkedIn"
  chips plus a Trust Boost label (§18.2).
- `linkGithub()` in `src/lib/github.ts` uses `supabase.auth.linkIdentity({ provider: 'github', scopes: 'public_repo' })`
  to add GitHub to an existing session (for Apply-to-my-repo).

## Troubleshooting

- **Sign-in succeeds but user stays on provider page**: callback URL mismatch.
  It must be the Supabase `.supabase.co/auth/v1/callback` URL exactly.
- **"Email not confirmed" loop**: Supabase → Auth → Providers → Email → toggle
  off "Confirm email" for staging, or verify the template is configured.
- **X OAuth 1.0a vs 2.0**: use 2.0. Supabase supports both but 2.0 is the current path.
- **LinkedIn "unauthorized_scope_error"**: the app must have the OIDC product
  approved under LinkedIn Developer → Products tab.
