// GitHub OAuth linking + REST helpers (v1.5 §15.5 Apply-to-my-repo).
//
// Auth model: we rely on Supabase's GitHub provider (Dashboard → Auth →
// Providers → GitHub, scopes: `public_repo`). Once the user links GitHub,
// the access token lives on the Supabase session (`provider_token`).
//
// Admin setup (one-time):
//   1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
//      Authorization callback URL:
//      https://tekemubwihsjdzittoqf.supabase.co/auth/v1/callback
//   2. Supabase Dashboard → Authentication → Providers → GitHub → enable,
//      paste Client ID + Secret, scopes = `public_repo`.

import { supabase } from './supabase'

export interface GithubRepoSummary {
  id: number
  full_name: string          // "owner/repo"
  name: string
  default_branch: string
  private: boolean
  html_url: string
  updated_at: string
}

export async function getGithubToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.provider_token ?? null
}

export async function isGithubLinked(): Promise<boolean> {
  // Two-prong check: identities array includes github, OR we have a provider_token.
  // Provider token is session-scoped; identities are durable.
  const [{ data: userData }, { data: sessionData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ])
  const idents = userData.user?.identities ?? []
  const hasGithubIdentity = idents.some(i => i.provider === 'github')
  const hasProviderToken  = !!sessionData.session?.provider_token
  return hasGithubIdentity || hasProviderToken
}

export async function linkGithub(returnTo?: string): Promise<{ error: string | null }> {
  // Supabase's linkIdentity kicks off OAuth and returns the user to returnTo.
  // If the user isn't signed in yet, fall back to signInWithOAuth.
  const { data: sess } = await supabase.auth.getSession()
  const redirectTo = returnTo ?? window.location.href

  if (!sess.session) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { scopes: 'public_repo', redirectTo },
    })
    return { error: error?.message ?? null }
  }

  // Linking requires the account to exist already.
  const { error } = await supabase.auth.linkIdentity({
    provider: 'github',
    options: { scopes: 'public_repo', redirectTo },
  })
  return { error: error?.message ?? null }
}

export async function listPublicRepos(): Promise<GithubRepoSummary[]> {
  const token = await getGithubToken()
  if (!token) return []
  const res = await fetch(
    'https://api.github.com/user/repos?visibility=public&affiliation=owner&per_page=100&sort=updated',
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
  )
  if (!res.ok) return []
  const rows = await res.json() as Array<{
    id: number; full_name: string; name: string; default_branch: string;
    private: boolean; html_url: string; updated_at: string;
  }>
  return rows.map(r => ({
    id: r.id, full_name: r.full_name, name: r.name,
    default_branch: r.default_branch, private: r.private,
    html_url: r.html_url, updated_at: r.updated_at,
  }))
}

// Suggest a canonical target path inside the buyer's repo based on artifact
// format + tools. Buyer can override in the modal.
export function suggestTargetPath(format: string | null, tools: string[], sourcePath: string): string {
  if (!format) return sourcePath
  switch (format) {
    case 'ide_rules':
      if (tools.includes('cursor'))   return '.cursorrules'
      if (tools.includes('windsurf')) return '.windsurfrules'
      if (tools.includes('continue')) return '.continuerules'
      return sourcePath
    case 'project_rules':
      // Preserve base filename at repo root (CLAUDE.md, AGENTS.md, RULES.md).
      return (sourcePath.split('/').pop() ?? 'CLAUDE.md').toUpperCase().startsWith('CLAUDE')
        ? 'CLAUDE.md'
        : (sourcePath.split('/').pop() ?? sourcePath)
    case 'mcp_config':
      return sourcePath.endsWith('.json') ? (sourcePath.split('/').pop() ?? 'mcp.json') : 'mcp.json'
    case 'agent_skill':
      // Preserve the full .claude/skills/<name>/SKILL.md path if present.
      return sourcePath
    case 'prompt_pack':
    case 'patch_recipe':
    default:
      return sourcePath
  }
}
