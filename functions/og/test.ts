// Sanity-check Function · returns plain text. If this responds with
// "ok" instead of SPA HTML, Pages Functions infra is wired correctly
// and the failure is somewhere in satori/resvg/HTMLRewriter code. If
// THIS also returns SPA HTML, the deploy isn't compiling functions/
// at all (likely the wrangler.jsonc Workers config is winning over
// Pages routing).

export const onRequestGet: PagesFunction = async () => {
  return new Response('ok · pages function alive', {
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  })
}
