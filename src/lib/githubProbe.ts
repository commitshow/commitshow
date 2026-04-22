// Lightweight GitHub reachability probe used as a hard gate before
// accepting a project submission. Blocks private/404 repos so Scouts
// always get transparent evaluation (CLAUDE.md §4).

export type GithubProbeResult =
  | { ok: true;  owner: string; repo: string }
  | { ok: false; reason: 'invalid_url' | 'not_found' | 'private' | 'rate_limited' | 'network'; message: string }

export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim()
  const m = trimmed.match(/github\.com\/([^/\s?#]+)\/([^/\s?#]+)/i)
  if (!m) return null
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') }
}

export async function probeGithubPublic(url: string): Promise<GithubProbeResult> {
  const parsed = parseGithubRepo(url)
  if (!parsed) {
    return { ok: false, reason: 'invalid_url', message: 'Enter a GitHub URL like https://github.com/owner/repo' }
  }
  const { owner, repo } = parsed
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (res.ok) {
      const data = await res.json() as { private?: boolean }
      if (data.private) {
        return { ok: false, reason: 'private', message: `${owner}/${repo} is private. commit.show analyzes only public repos — transparency is core to how Scouts evaluate projects.` }
      }
      return { ok: true, owner, repo }
    }
    if (res.status === 404) {
      // Private repos also return 404 for unauthenticated requests — treat
      // both the same, message points creators to change visibility.
      return { ok: false, reason: 'private', message: `${owner}/${repo} is either private or doesn't exist. Make it public in Settings → General → Change visibility.` }
    }
    if (res.status === 403) {
      return { ok: false, reason: 'rate_limited', message: 'GitHub rate limit hit. Wait a minute and try again.' }
    }
    return { ok: false, reason: 'not_found', message: `GitHub returned ${res.status} for ${owner}/${repo}.` }
  } catch (e) {
    return { ok: false, reason: 'network', message: `Network error reaching GitHub: ${(e as Error).message}` }
  }
}
