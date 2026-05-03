// _shared/github.ts — small GitHub API helpers used across Edge Functions.
//
// Currently just `fetchGithubHead` for cache + cooldown invalidation:
// when a repo has been pushed since the last snapshot, we want callers to
// know about it so they can drop the cache or skip the cooldown.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck — Deno runtime

/**
 * Resolve the current HEAD commit SHA of a public GitHub repo.
 * Returns null on any failure (rate-limit / private repo / network), so
 * the caller can fall back to a time-based throttle when the probe fails.
 *
 * @param slug "owner/repo"
 */
export async function fetchGithubHead(slug: string): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const headers: Record<string, string> = {
      'accept':     'application/vnd.github+json',
      'user-agent': 'commit.show-cache/1.0',
    }
    const ghToken = (globalThis as any).Deno?.env?.get('GITHUB_TOKEN')
    if (ghToken) headers['authorization'] = `Bearer ${ghToken}`

    const r = await fetch(`https://api.github.com/repos/${slug}/commits?per_page=1`, { headers, signal: ctrl.signal })
    clearTimeout(timer)
    if (!r.ok) return null
    const j = await r.json() as Array<{ sha?: string }>
    return j[0]?.sha ?? null
  } catch {
    return null
  }
}

/** Pull "owner/repo" out of any normalized github URL. */
export function slugFromGithubUrl(url: string): string | null {
  const m = url?.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i)
  if (!m) return null
  const owner = m[1]
  const repo  = m[2].replace(/\.git$/i, '')
  return `${owner}/${repo}`
}
