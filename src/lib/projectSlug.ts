// Project slug helpers · 2026-05-05.
//
// Switched share-card URLs from /projects/<uuid> to /project/<slug>
// for cleaner display in tweets and bookmarks. Slug = project_name
// lower-cased, non-alnum collapsed to '-'. Collisions are resolved at
// resolve time by picking the most-recent project (uuid still works
// as a fallback path).

export function projectSlug(name: string | null | undefined): string {
  if (!name) return ''
  return String(name)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function projectShareUrl(name: string | null | undefined, fallbackId?: string): string {
  const slug = projectSlug(name)
  if (slug) return `https://commit.show/project/${slug}`
  if (fallbackId) return `https://commit.show/projects/${fallbackId}`
  return 'https://commit.show'
}
