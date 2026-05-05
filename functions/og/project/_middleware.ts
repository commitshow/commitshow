// Sentinel · just confirms /og/project/* hits this middleware.
// Once verified we re-add the satori/resvg pipeline (last attempt
// likely failed in the Pages bundler when importing satori from
// esm.sh — keeping that code separate until the routing path is
// proven).

export const onRequest: PagesFunction = async (ctx) => {
  const url = new URL(ctx.request.url)
  return new Response(`og/project middleware alive · path=${url.pathname}`, {
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  })
}
